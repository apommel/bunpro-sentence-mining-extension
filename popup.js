// popup.js
document.addEventListener("DOMContentLoaded", () => {
  const api = typeof browser !== "undefined" ? browser : chrome;
  const dot = document.getElementById("dot");
  const statusText = document.getElementById("statusText");

  // Check LLM settings
  api.storage.sync.get(["llmBaseUrl", "llmApiKey", "llmModel"], (data) => {
    const llmOk = data.llmBaseUrl && data.llmApiKey && data.llmModel;

    // Check Bunpro cookie via background
    api.runtime.sendMessage({ action: "testBunpro" }, (response) => {
      const bunproOk = response?.ok;

      if (llmOk && bunproOk) {
        dot.className = "dot ok";
        statusText.textContent = "Ready";
      } else if (!bunproOk) {
        dot.className = "dot warn";
        statusText.textContent = "Not logged in to Bunpro";
      } else {
        dot.className = "dot warn";
        statusText.textContent = "LLM not configured";
      }
    });
  });

  document.getElementById("openOptions").addEventListener("click", () => {
    api.runtime.openOptionsPage();
  });
});
