# Bunpro Sentence Mining — Browser Extension

Browser extension to automatically create self-study sentences in Bunpro from text on webpages, using
the frontend API and a LLM connection to generate the readings and translate the sentence.

The extension was almost entirely written by Claude as I know next to nothing about JS. I reverse-engineered
the required API endpoints and made the proof of concept Python script (under `reference`).

## Features

- **Context menu** — works on any webpage
- **Smart sentence extraction** — extracts the full sentence to use in Bunpro
- **Automatic Bunpro authentication** — reads your session token from the Bunpro cookie
- **LLM formatting** — sends word + sentence to your OpenAI-compatible LLM to produce furigana, blank-fill, and English translation
- **Opens vocab page** — after adding, opens `bunpro.jp/vocabs/<word>` in a background tab (configurable)

## Installation

First, **clone the repository** to your local machine.

### Firefox

1. Open a new tab and navigate to `about:debugging#/runtime/this-firefox`
2. Click the **Load Temporary Add-on...** button.
3. Select the `manifest.json` file from the repository.

> **Note:** Firefox will remove the extension every time you restart the browser. You will need to repeat these steps to reload it.

### Chromium-based Browsers (Chrome, Edge, Brave, etc.)

1. Open a new tab and navigate to `chrome://extensions/`
2. In the top-right corner, toggle **Developer mode** to **ON**.
3. Click the **Load unpacked** button.
4. Select the **root directory** of the repository (the folder containing the `manifest.json` file).

## Setup

1. **Log in** at [bunpro.jp](https://bunpro.jp) — the extension reads the token automatically from cookies.

2. Click the extension icon → **Open settings**, and fill in:

   | Field | Description |
   |---|---|
   | **LLM Base URL** | e.g. `https://api.openai.com/v1` |
   | **LLM API Key** | Your provider's API key |
   | **LLM Model** | e.g. `gpt-4o-mini` |
   | **Open vocab tab** | Whether to open the Bunpro word page after adding |

3. Use the **Test** buttons to verify both connections.

4. **Save settings**.

### Supported LLM Providers

Should work with any OpenAI-compatible `/v1/chat/completions` endpoint:
- OpenAI, OVH AI Endpoints, Ollama, LM Studio, Together, Grok, Mistral, Gemini compatible API etc.

I tried it successfully with gemini-3-flash and gemini-3.1-flash-lite.
I also tried Qwen3-32b and Meta-Llama-3_3-70B-Instruct but even though it more or less works, they sometimes
fail to format the output correctly.

## Usage

1. Browse any Japanese page
2. **Select** the word you want to study
3. **Right-click → Study in Bunpro: "〈word〉"**
4. Watch the blue loading toast, then green success — done

# Acknowledgements

Many thanks to this [Postman Bunpro API collection](https://www.postman.com/technical-meteorologist-63813544/bunpro-api/collection/a7eufz9/bunpro-frontend-api?sideView=agentMode)
which was helpful to get started to understand the API structure even though some endpoints are now slightly
outdated.
