// options.js

const BUNPRO_BASE = "https://api.bunpro.jp/api/frontend";

// ── Load saved settings ──────────────────────────────────────────────────────

document.addEventListener("DOMContentLoaded", () => {
  const api = typeof browser !== "undefined" ? browser : chrome;

  api.storage.sync.get(
    ["llmBaseUrl", "llmApiKey", "llmModel", "openVocabTab"],
    (data) => {
      if (data.llmBaseUrl)  document.getElementById("llmBaseUrl").value  = data.llmBaseUrl;
      if (data.llmApiKey)   document.getElementById("llmApiKey").value   = data.llmApiKey;
      if (data.llmModel)    document.getElementById("llmModel").value    = data.llmModel;
      // Default openVocabTab to true if not set
      document.getElementById("openVocabTab").checked = data.openVocabTab !== false;
    }
  );
});

// ── Show/hide API key ────────────────────────────────────────────────────────

document.querySelectorAll(".toggle-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    const input = document.getElementById(btn.dataset.target);
    const isHidden = input.type === "password";
    input.type = isHidden ? "text" : "password";
    btn.textContent = isHidden ? "Hide" : "Show";
  });
});

// ── Save ─────────────────────────────────────────────────────────────────────

document.getElementById("saveBtn").addEventListener("click", () => {
  const api = typeof browser !== "undefined" ? browser : chrome;

  const data = {
    llmBaseUrl:   document.getElementById("llmBaseUrl").value.trim(),
    llmApiKey:    document.getElementById("llmApiKey").value.trim(),
    llmModel:     document.getElementById("llmModel").value.trim(),
    openVocabTab: document.getElementById("openVocabTab").checked,
  };

  api.storage.sync.set(data, () => {
    const msg = document.getElementById("saveMsg");
    msg.classList.add("visible");
    setTimeout(() => msg.classList.remove("visible"), 2500);
  });
});

// ── Test Bunpro (via background message to use cookie) ───────────────────────

document.getElementById("testBunpro").addEventListener("click", async () => {
  const statusEl = document.getElementById("bunproStatus");
  statusEl.className = "test-result";
  statusEl.textContent = "Testing…";

  try {
    // Ask the background script to test the connection (it has cookie access)
    const api = typeof browser !== "undefined" ? browser : chrome;
    const response = await api.runtime.sendMessage({ action: "testBunpro" });
    if (response?.ok) {
      setStatus(statusEl, "ok", "✓ Connected");
    } else {
      setStatus(statusEl, "err", `✕ ${response?.error || "Failed"}`);
    }
  } catch (err) {
    setStatus(statusEl, "err", `✕ ${err.message}`);
  }
});

// ── Test LLM ─────────────────────────────────────────────────────────────────

document.getElementById("testLlm").addEventListener("click", async () => {
  const statusEl = document.getElementById("llmStatus");
  const baseUrl  = document.getElementById("llmBaseUrl").value.trim().replace(/\/$/, "");
  const apiKey   = document.getElementById("llmApiKey").value.trim();
  const model    = document.getElementById("llmModel").value.trim();

  if (!baseUrl || !apiKey || !model) {
    setStatus(statusEl, "err", "Fill in all LLM fields first");
    return;
  }

  statusEl.className = "test-result";
  statusEl.textContent = "Testing…";

  try {
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        max_tokens: 10,
        messages: [{ role: "user", content: 'Say "ok"' }],
      }),
    });

    if (res.ok) {
      setStatus(statusEl, "ok", "✓ Model responded");
    } else {
      setStatus(statusEl, "err", `✕ HTTP ${res.status}`);
    }
  } catch (err) {
    setStatus(statusEl, "err", `✕ ${err.message}`);
  }
});

// ── Helper ───────────────────────────────────────────────────────────────────

function setStatus(el, type, text) {
  el.className = `test-result ${type}`;
  el.textContent = text;
}
