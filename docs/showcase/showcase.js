const previewTabs = Array.from(document.querySelectorAll("[data-preview]"));

function selectPreview(tab, focus = false) {
  for (const previewTab of previewTabs) {
    const selected = previewTab === tab;
    previewTab.setAttribute("aria-selected", String(selected));
    previewTab.tabIndex = selected ? 0 : -1;
    const panel = document.getElementById(previewTab.getAttribute("aria-controls"));
    if (panel) panel.hidden = !selected;
  }
  if (focus) tab.focus();
}

for (const tab of previewTabs) {
  tab.addEventListener("click", () => selectPreview(tab));
  tab.addEventListener("keydown", (event) => {
    const index = previewTabs.indexOf(tab);
    let nextIndex;
    if (event.key === "ArrowRight") nextIndex = (index + 1) % previewTabs.length;
    if (event.key === "ArrowLeft")
      nextIndex = (index - 1 + previewTabs.length) % previewTabs.length;
    if (event.key === "Home") nextIndex = 0;
    if (event.key === "End") nextIndex = previewTabs.length - 1;
    if (nextIndex !== undefined) {
      event.preventDefault();
      selectPreview(previewTabs[nextIndex], true);
    }
  });
}

const copyButton = document.getElementById("copy-setup");
const commands = document.getElementById("setup-commands");
const copyFeedback = document.getElementById("copy-feedback");

if (copyButton && commands && copyFeedback) {
  copyButton.addEventListener("click", async () => {
    try {
      if (!navigator.clipboard) throw new Error("Clipboard unavailable");
      await navigator.clipboard.writeText(commands.textContent.trim());
      copyFeedback.textContent = "Commands copied. Paste them into your terminal.";
    } catch {
      const selection = window.getSelection();
      if (selection) {
        const range = document.createRange();
        range.selectNodeContents(commands);
        selection.removeAllRanges();
        selection.addRange(range);
      }
      copyFeedback.textContent =
        "Clipboard access is unavailable. Select the commands above and copy them manually.";
    }
  });
}
