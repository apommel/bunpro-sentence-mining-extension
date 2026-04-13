import { BUNPRO_BASE, BUNPRO_COOKIE_URL, BUNPRO_COOKIE_NAME, DEFAULT_SYSTEM_PROMPT, DEFAULT_TEMPERATURE } from './constants.js';

// Firefox exposes `browser`, Chrome exposes `chrome`. Normalise to `api`.
const api = typeof browser !== "undefined" ? browser : chrome;

// ── Debug flag — set to true to see extracted word/sentence without calling APIs
const DEBUG_EXTRACTION = false;

// ── Message handler (from options page) ─────────────────────────────────────

api.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.action === "testBunpro") {
    getBunproTokenFromCookie()
      .then((token) =>
        fetch(`${BUNPRO_BASE}/user`, {
          method: "GET",
          headers: { Authorization: `Token token=${token}`, "Content-Type": "application/json" },
        })
      )
      .then((res) => {
        if (res.ok) sendResponse({ ok: true });
        else sendResponse({ ok: false, error: `HTTP ${res.status}` });
      })
      .catch((err) => sendResponse({ ok: false, error: err.message }));
    return true; // keep channel open for async response
  }
});

// ── Context Menu Setup ──────────────────────────────────────────────────────

api.runtime.onInstalled.addListener(() => {
  api.contextMenus.create({
    id: "bunpro-study",
    title: "Study in Bunpro: \"%s\"",
    contexts: ["selection"],
  });
});

// ── Context Menu Click ──────────────────────────────────────────────────────

api.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== "bunpro-study") return;
  if (!info.selectionText?.trim()) return;

  let extracted;
  try {
    const results = await api.scripting.executeScript({
      target: { tabId: tab.id },
      func: extractFromDOMSelection,
    });
    extracted = results?.[0]?.result;
  } catch (err) {
    notifyTab(tab.id, "error", `Could not read page content: ${err.message}`);
    return;
  }

  const selectedWord = extracted?.word;
  const sentence     = extracted?.sentence || selectedWord;
  if (!selectedWord) return;

  if (DEBUG_EXTRACTION) {
    notifyTab(tab.id, "debug", `Word: 「${selectedWord}」\nSentence: ${sentence}`);
    return;
  }

  notifyTab(tab.id, "loading", `Processing「${selectedWord}」…`);

  try {
    const settings = await getSettings();
    validateSettings(settings);
    const bunproToken = await getBunproTokenFromCookie();
    await createSelfStudyCard(selectedWord, sentence, settings, bunproToken, tab.id);
  } catch (err) {
    notifyTab(tab.id, "error", err.message || "Unknown error occurred.");
  }
});

// ── Bunpro Token via Cookie ──────────────────────────────────────────────────

async function getBunproTokenFromCookie() {
  return new Promise((resolve, reject) => {
    api.cookies.get({ url: BUNPRO_COOKIE_URL, name: BUNPRO_COOKIE_NAME }, (cookie) => {
      if (api.runtime.lastError) {
        reject(new Error(`Cookie error: ${api.runtime.lastError.message}`));
      } else if (!cookie?.value) {
        reject(new Error("Not logged in to Bunpro. Please log in at bunpro.jp and try again."));
      } else {
        resolve(cookie.value);
      }
    });
  });
}

// ── Settings ────────────────────────────────────────────────────────────────

async function getSettings() {
  return new Promise((resolve) => {
    api.storage.sync.get(["llmBaseUrl", "llmApiKey", "llmModel", "openVocabTab", "llmSystemPrompt", "llmTemperature"], resolve);
  });
}

function validateSettings(settings) {
  const missing = [];
  if (!settings.llmBaseUrl) missing.push("LLM Base URL");
  if (!settings.llmApiKey)  missing.push("LLM API Key");
  if (!settings.llmModel)   missing.push("LLM Model");
  if (missing.length > 0) {
    throw new Error(`Missing settings: ${missing.join(", ")}. Please open the extension options.`);
  }
}

// ── Core Pipeline ────────────────────────────────────────────────────────────

async function createSelfStudyCard(selectedWord, sentence, settings, bunproToken, tabId) {
  const headers = {
    Authorization: `Token token=${bunproToken}`,
    "Content-Type": "application/json",
  };

  notifyTab(tabId, "loading", `Processing with LLM…`);
  const llmData = await llmProcessSentence(selectedWord, sentence, settings);
  const dictForm = llmData.dictionary_form || selectedWord;

  const reviewId = await getReviewId(dictForm, headers);
  if (reviewId === -1) {
    throw new Error(`「${dictForm}」was not found in Bunpro's vocabulary database.`);
  }

  const cardRes = await fetch(`${BUNPRO_BASE}/user_study_questions`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      reviewable_id: reviewId,
      reviewable_type: "Vocab",
      content: llmData.content,
      answer: llmData.answer,
      translation: llmData.translation,
      alternate_grammar: [],
    }),
  });

  if (!cardRes.ok) {
    const errText = await cardRes.text();
    throw new Error(`Bunpro card creation failed (${cardRes.status}): ${errText}`);
  }

  await addToReviews(reviewId, headers);

  notifyTab(tabId, "success", `「${dictForm}」added to self-study!`);

  if (settings.openVocabTab !== false) {
    api.tabs.create({ url: `https://bunpro.jp/vocabs/${encodeURIComponent(dictForm)}`, active: false });
  }
}

// ── Bunpro API ────────────────────────────────────────────────────────────────

async function getReviewId(query, headers) {
  const res = await fetch(`${BUNPRO_BASE}/search/reviewables_v1_1`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      query,
      options: { include_reviews: false, include_bookmarks: false, include_notes: false, only_bookmarks: false },
      is_searching_grammar: false,
      is_searching_vocab: true,
    }),
  });
  if (!res.ok) throw new Error(`Bunpro search failed (${res.status})`);
  const data = await res.json();
  const best = (data?.vocabs?.data || []).find((v) => v.attributes?.title === query);
  return best ? parseInt(best.id) : -1;
}

async function addToReviews(id, headers) {
  await fetch(`${BUNPRO_BASE}/reviews/update_via_action_type`, {
    method: "PATCH",
    headers,
    body: JSON.stringify({ action_type: "add", deck_id: null, reviewables: [["Vocab", id]] }),
  }).catch((e) => console.warn("addToReviews:", e));
}

// ── LLM Processing ────────────────────────────────────────────────────────────

async function llmProcessSentence(selectedWord, fullSentence, settings) {
  const systemPrompt = settings.llmSystemPrompt?.trim() || DEFAULT_SYSTEM_PROMPT;
  const temperature  = settings.llmTemperature != null ? settings.llmTemperature : DEFAULT_TEMPERATURE;

  const messages = [
    { role: "system", content: systemPrompt },
    { role: "user",   content: `Selected word: ${selectedWord}\nFull sentence: ${fullSentence}` },
  ];

  const baseUrl = settings.llmBaseUrl.replace(/\/$/, "");
  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${settings.llmApiKey}` },
    body: JSON.stringify({
      model: settings.llmModel,
      messages: messages,
      response_format: { type: "json_object" },
      temperature,
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`LLM request failed (${res.status}): ${errText}`);
  }

  const data = await res.json();
  const raw = data?.choices?.[0]?.message?.content;
  if (!raw) throw new Error("LLM returned an empty response.");

  try {
    return JSON.parse(raw.replace(/```json|```/g, "").trim());
  } catch {
    throw new Error(`LLM returned invalid JSON: ${raw.slice(0, 200)}`);
  }
}

// ── In-Page Notification ─────────────────────────────────────────────────────

function notifyTab(tabId, type, message) {
  api.scripting
    .executeScript({ target: { tabId }, func: showBunproNotification, args: [type, message] })
    .catch(() => {});
}

// ── Content Script: extract clean word + sentence from DOM selection ──────────

function extractFromDOMSelection() {
  const SKIP_TAGS  = new Set(["RT", "RP", "STYLE", "SCRIPT", "NOSCRIPT"]);
  const ROOT_TAGS  = new Set(["ARTICLE", "MAIN", "SECTION", "BODY"]);
  const SENTENCE_END = /[。！？!?\n]/;

  function walk(root, range) {
    const filter = {
      acceptNode(node) {
        let anc = node.parentElement;
        while (anc && anc !== root) {
          if (SKIP_TAGS.has(anc.tagName?.toUpperCase())) return NodeFilter.FILTER_REJECT;
          anc = anc.parentElement;
        }
        return NodeFilter.FILTER_ACCEPT;
      },
    };
    const iter = document.createNodeIterator(root, NodeFilter.SHOW_TEXT, filter);
    let text = "", offset = null, node;
    while ((node = iter.nextNode())) {
      const val = node.nodeValue.replace(/\u200b/g, "");
      if (offset === null && node === range.startContainer) {
        offset = text.length + range.startOffset;
      }
      text += val;
    }
    return { text, offset: offset ?? 0 };
  }

  // Extract the selected word by iterating only within the range, skipping furigana.
  function wordFromRange(range) {
    const root = range.commonAncestorContainer.nodeType === Node.TEXT_NODE
      ? range.commonAncestorContainer.parentNode
      : range.commonAncestorContainer;
    const filter = {
      acceptNode(node) {
        let anc = node.parentElement;
        while (anc) {
          if (SKIP_TAGS.has(anc.tagName?.toUpperCase())) return NodeFilter.FILTER_REJECT;
          anc = anc.parentElement;
        }
        return NodeFilter.FILTER_ACCEPT;
      },
    };
    const iter = document.createNodeIterator(root, NodeFilter.SHOW_TEXT, filter);
    let result = "", node;
    while ((node = iter.nextNode())) {
      if (!range.intersectsNode(node)) continue;
      const start = node === range.startContainer ? range.startOffset : 0;
      const end   = node === range.endContainer   ? range.endOffset   : node.nodeValue.length;
      result += node.nodeValue.slice(start, end);
    }
    return result.replace(/\u200b/g, "").trim();
  }

  // ── Main ─────────────────────────────────────────────────────────────────

  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return null;

  const range = sel.getRangeAt(0);
  const word  = wordFromRange(range);
  if (!word) return null;

  let node = range.commonAncestorContainer;
  if (node.nodeType === Node.TEXT_NODE) node = node.parentElement;

  for (let el = node; el; el = el.parentElement) {
    const { text, offset } = walk(el, range);
    const hasBefore = offset > 0 && SENTENCE_END.test(text.slice(0, offset));
    const hasAfter  = SENTENCE_END.test(text.slice(offset + word.length));

    if (hasBefore && hasAfter || ROOT_TAGS.has(el.tagName?.toUpperCase()) || !el.parentElement) {
      // Slice from the nearest sentence boundary on each side
      let start = offset;
      while (start > 0 && !SENTENCE_END.test(text[start - 1])) start--;
      let end = offset + word.length;
      while (end < text.length && !SENTENCE_END.test(text[end])) end++;
      if (end < text.length) end++;
      return { word, sentence: text.slice(start, end).trim() };
    }
  }

  return { word, sentence: word };
}

// ── Content Script: toast notification ───────────────────────────────────────

function showBunproNotification(type, message) {
  const ID = "__bunpro_toast__";

  if (!document.getElementById("__bunpro_styles__")) {
    const s = document.createElement("style");
    s.id = "__bunpro_styles__";
    s.textContent = `
      #${ID} {
        all: initial;
        position: fixed;
        bottom: 20px;
        right: 20px;
        z-index: 2147483647;
        min-width: 260px;
        max-width: 380px;
        padding: 12px 16px;
        border-radius: 6px;
        font-family: system-ui, -apple-system, sans-serif;
        font-size: 13px;
        line-height: 1.5;
        color: #fff;
        display: flex;
        align-items: flex-start;
        gap: 10px;
        box-shadow: 0 2px 12px rgba(0,0,0,0.2);
        opacity: 0;
        transform: translateY(8px);
        transition: opacity 0.2s ease, transform 0.2s ease;
        pointer-events: none;
      }
      #${ID}.visible { opacity: 1; transform: translateY(0); }
      #${ID}.bp-success { background: #2d6a4f; }
      #${ID}.bp-error   { background: #9b2335; }
      #${ID}.bp-loading { background: #1a3a5c; }
      #${ID}.bp-debug   { background: #5a3e8a; }
      #${ID} .__bp-icon { font-size: 15px; flex-shrink: 0; margin-top: 1px; }
      #${ID} .__bp-body {}
      #${ID} .__bp-title { font-size: 11px; font-weight: 600; opacity: 0.75; text-transform: uppercase; letter-spacing: 0.06em; margin-bottom: 1px; }
      @keyframes __bp-spin { to { transform: rotate(360deg); } }
      #${ID} .__bp-spinner {
        width: 14px; height: 14px; flex-shrink: 0; margin-top: 2px;
        border: 2px solid rgba(255,255,255,0.3); border-top-color: #fff;
        border-radius: 50%; animation: __bp-spin 0.7s linear infinite;
      }
    `;
    document.head.appendChild(s);
  }

  const existing = document.getElementById(ID);
  if (existing) { clearTimeout(existing.__timer); existing.remove(); }

  const toast = document.createElement("div");
  toast.id = ID;
  toast.className = `bp-${type}`;

  const name = "Bunpro Sentence Mining";
  const labels = { success: name, error: "Error", loading: name, debug: "Debug · Extraction" };
  const icons  = { success: "✓", error: "✕", debug: "🔍" };

  toast.innerHTML = `
    ${type === "loading"
      ? `<div class="__bp-spinner"></div>`
      : `<div class="__bp-icon">${icons[type]}</div>`}
    <div class="__bp-body">
      <div class="__bp-title">${labels[type]}</div>
      <div>${message.replace(/\n/g, "<br>")}</div>
    </div>`;

  document.body.appendChild(toast);
  requestAnimationFrame(() => requestAnimationFrame(() => toast.classList.add("visible")));

  if (type !== "loading") {
    toast.__timer = setTimeout(() => {
      toast.classList.remove("visible");
      setTimeout(() => toast.remove(), 250);
    }, type === "error" ? 7000 : type === "debug" ? 15000 : 4000);
  }
}
