import requests
import json
from openai import OpenAI

# --- Configuration ---
BUNPRO_BASE = "https://api.bunpro.jp/api/frontend"
BUNPRO_TOKEN = ""

# OpenAI-compatible LLM Configuration
LLM_BASE_URL = "https://oai.endpoints.kepler.ai.cloud.ovh.net/v1"
LLM_API_KEY = ""
LLM_MODEL = "Meta-Llama-3_3-70B-Instruct"

# Initialize LLM Client
client = OpenAI(api_key=LLM_API_KEY, base_url=LLM_BASE_URL)

HEADERS = {
    "Authorization": f"Token token={BUNPRO_TOKEN}",
    "Content-Type": "application/json"
}

SYSTEM_PROMPT = """You are an expert Japanese linguist and educational content creator. Your task is to generate structured JSON data for Japanese learning flashcards based on a provided "Selected word" and "Full sentence".

**RULES & CONSTRAINTS:**
1. **JSON Only:** You must output strictly valid JSON and absolutely nothing else. No markdown formatting outside the JSON block, no conversational filler.
2. **dictionary_form:** Provide the plain, dictionary form of the selected word.
3. **content:** Provide the full sentence with two critical modifications:
- **Furigana:** All Kanji must have furigana added immediately after them in full-width parentheses (e.g., 漢字（かんじ）). Do not add furigana to standard hiragana or katakana.
- **The Blank:** Replace the target word with exactly four underscores `____`. 
    - *Verb Inflection Rule:* If the selected word is a verb with inflections (like 食べていけません), replace ONLY the verb root/stem with `____` and leave the auxiliary/inflectional endings in the sentence intact (e.g., `____ていけません`). 
    - *Noun Rule:* If the word is a noun, replace the entire word with `____`.
4. **answer:** Provide the exact text that belongs in the `____` blank. This MUST include the relevant furigana in full-width parentheses (e.g., 食（た）べ).
5. **translation:** Provide a natural English translation of the entire sentence wrapped in `<p>` tags. You must bold the English translation of the selected word using `<strong>` tags.

**EXAMPLES:**

Input:
Selected word: 食べていけません
Full sentence: 今の安月給ではとても食べていけません。

Output:
{
    "dictionary_form": "食べる",
    "content": "今（いま）の安（やす）月給（げっきゅう）ではとても____ていけません。",
    "answer": "食（た）べ",
    "translation": "<p>My current cheap salary <strong>doesn't pay the rent</strong>.</p>"
}

Input:
Selected word: 不満
Full sentence: 先生に対する不満を口にする。

Output:
{
    "dictionary_form": "不満",
    "content": "先生（せんせい）に対（たい）する____を口（くち）にする。",
    "answer": "不満（ふまん）",
    "translation": "<p>To express <strong>dissatisfaction</strong> towards the teacher.</p>"
}
"""

def get_review_id(query: str) -> int:
    """Finds the internal Bunpro ID for a vocab word."""
    endpoint = f"{BUNPRO_BASE}/search/reviewables_v1_1"
    payload = {
        "query": query,
        "options": {"include_reviews": False, "include_bookmarks": False, "include_notes": False, "only_bookmarks": False},
        "is_searching_grammar": False,
        "is_searching_vocab": True
    }
    response = requests.post(endpoint, json=payload, headers=HEADERS)
    response.raise_for_status()
    
    vocabs = response.json().get("vocabs", {}).get("data", [])
    best_match = next((i for i in vocabs if i["attributes"]["title"] == query), None)
    return int(best_match["id"]) if best_match else -1

def add_to_reviews(id: int):
    """Adds a vocab to the user's reviews."""
    endpoint = f"{BUNPRO_BASE}/reviews/update_via_action_type"
    payload = {
        "action_type":"add",
        "deck_id": None,
        "reviewables":[["Vocab", id]]
    }
    response = requests.patch(endpoint, json=payload, headers=HEADERS)
    if response.status_code == 200:
        print(f"Successfully added ID {id} to reviews!")
    else:
        print(f"Error adding ID {id} to reviews: {response.text}")

def llm_process_sentence(target_word: str, full_sentence: str):
    prompt = f"Selected word: {target_word}\nFull sentence: {full_sentence}"
    
    response = client.chat.completions.create(
        model=LLM_MODEL,
        messages=[{"role": "system", "content": SYSTEM_PROMPT}, {"role": "user", "content": prompt}],
        response_format={"type": "json_object"},
        temperature=0.2  # For strict formatting and logical extraction
    )
    return json.loads(response.choices[0].message.content)

def create_self_study_card(selected_text: str, sentence: str):
    print(f"Processing sentence and extracting dictionary form via LLM...")
    llm_data = llm_process_sentence(selected_text, sentence)
    
    dict_form = llm_data.get("dictionary_form")
    print(f"   -> Extracted Dictionary Form: {dict_form}")

    print(f"Searching Bunpro for ID...")
    review_id = get_review_id(dict_form) # Search using the clean dictionary form
    
    if review_id == -1:
        print(f"Could not find Bunpro ID for {dict_form}")
        return

    print(f"Pushing to Bunpro...")
    payload = {
        "reviewable_id": review_id,
        "reviewable_type": "Vocab",
        "content": llm_data["content"],
        "answer": llm_data["answer"],
        "translation": llm_data["translation"],
        "alternate_grammar": []
    }

    endpoint = f"{BUNPRO_BASE}/user_study_questions"
    response = requests.post(endpoint, json=payload, headers=HEADERS)
    
    if response.status_code == 200:
        print(f"Successfully added '{dict_form}' to self-study!")
        add_to_reviews(review_id)
        print(f"Access the card here: https://bunpro.jp/vocabs/{dict_form}")
    else:
        print(f"Error: {response.status_code}")

if __name__ == "__main__":
    # Example usage
    word_to_mine = "募った"
    example_sentence = "恋心が募ったので思いを伝えました。"
    
    create_self_study_card(word_to_mine, example_sentence)
