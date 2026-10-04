import { setLogManaged } from "./logView.js";

// The tab bar shared by the Fix Run results and the PR Review: one
// "summary" panel (whichever of those is on screen, under a label of its own)
// beside the Raw log. While tabs are showing they own the log panel's
// visibility, so its lines never appear on top of the summary.

const tabs = document.getElementById("results-tabs");
const output = document.getElementById("output");
const summaryButton = tabs.querySelector('[data-tab="summary"]');

let panel = null;
let current = "summary";

function sync() {
  if (panel) panel.hidden = current !== "summary";
  output.hidden = current !== "log";
  for (const button of tabs.querySelectorAll("button")) {
    button.classList.toggle("on", button.dataset.tab === current);
  }
}

tabs.addEventListener("click", (event) => {
  const button = event.target.closest("button");
  if (!button) return;
  current = button.dataset.tab;
  sync();
});

/** Shows the tab bar over `panelEl`, labelled `label`, starting on `start`. */
export function showTabs(label, panelEl, start = "summary") {
  panel = panelEl;
  summaryButton.textContent = label;
  current = start;
  setLogManaged(true);
  tabs.hidden = false;
  sync();
}

export function selectTab(name) {
  current = name;
  sync();
}

export function hideTabs() {
  setLogManaged(false);
  tabs.hidden = true;
  if (panel) {
    panel.hidden = true;
    panel = null;
  }
}
