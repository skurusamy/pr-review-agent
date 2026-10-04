import { showTabs, selectTab, hideTabs } from "./panelTabs.js";
import { clearBriefing, showBriefing, showBriefingError } from "./briefing.js";
import {
  clearCodeReview,
  showCodeReview,
  showReviewPending,
} from "./codeReview.js";

// One PR Review on one page: the briefing on top, the Code Review's Findings
// below. They arrive in the order they finish (briefing, then the Findings
// marked "not checked", then the checked ones), and this decides where each
// goes. A Stop keeps whatever has arrived.

const panel = document.getElementById("pr-review");

// The latest structured review the server sent, so a Stop can keep showing it.
let latest = null;

/** Called as the run starts: the tabs appear on the log while it works. */
export function startPrReview() {
  showTabs("Review", panel, "log");
}

export function clearPrReview() {
  hideTabs();
  clearBriefing();
  clearCodeReview();
  latest = null;
}

// Selecting the tab first matters: Mermaid measures text in the DOM, so a
// diagram drawn into a hidden panel comes out empty.
export async function onBriefing(markdown) {
  selectTab("summary");
  await showBriefing(markdown);
  if (!latest) showReviewPending("The code review is being written...");
}

export function onBriefingFailed(message) {
  selectTab("summary");
  showBriefingError(message);
  if (!latest) showReviewPending("The code review is being written...");
}

/** The structured review: first all unchecked, then the checked one. */
export function onReviewData(data) {
  latest = data;
  showCodeReview(data);
}

/** The run finished: the review's Markdown is here, so it can be downloaded. */
export function onReviewDone(data, markdown) {
  latest = data;
  selectTab("summary");
  showCodeReview(data, markdown);
}

/** The run was stopped: keep the Findings that arrived, labelled as unchecked. */
export function onStopped() {
  if (latest) showCodeReview(latest, undefined, { stopped: true });
}
