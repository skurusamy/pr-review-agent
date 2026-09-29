import { streamRequest, isAbortError } from "./stream.js";
import { appendLine, showError, clearLog } from "./logView.js";
import {
  startRun,
  applyFixEvent,
  finishRun,
  resetResults,
  isActive,
} from "./resultsView.js";
import { clearBriefing, showBriefing, startBriefing } from "./briefing.js";
import {
  clearCodeReview,
  showCodeReview,
  startCodeReview,
} from "./codeReview.js";

const form = document.getElementById("fix-form");
const submitButton = document.getElementById("submit-button");
const briefButton = document.getElementById("brief-button");
const reviewButton = document.getElementById("review-button");
const stopButton = document.getElementById("stop-button");
const prUrlInput = document.getElementById("prUrl");
const dryRunInput = document.getElementById("dryRun");

// The in-flight request's own controller, if any -- what the Stop
// button aborts. Aborting the fetch also closes the connection to the
// server, which (see server.ts) aborts the underlying Claude Agent SDK
// session too, so Stop actually halts the work instead of just hiding it.
let activeController = null;

function resetPanels() {
  clearLog();
  clearBriefing();
  clearCodeReview();
  resetResults();
}

function setBusy(busy) {
  submitButton.disabled = busy;
  briefButton.disabled = busy;
  reviewButton.disabled = busy;
  stopButton.hidden = !busy;
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  resetPanels();
  setBusy(true);
  submitButton.textContent = "Addressing...";
  const controller = new AbortController();
  activeController = controller;

  try {
    await streamRequest(
      "/fix",
      { prUrl: prUrlInput.value, dryRun: dryRunInput.checked },
      appendLine,
      controller.signal,
      { onRun: startRun, onEvent: applyFixEvent },
    );
    finishRun("completed");
    // Aborting mid-stream doesn't always reject the pending read (some
    // browsers just resolve it as a clean stream end) -- checking the
    // signal here is what catches that case instead of the request
    // silently looking like it finished normally.
    if (controller.signal.aborted) {
      appendLine("warn", "Stopped.");
      finishRun("stopped");
    }
  } catch (err) {
    if (isAbortError(err) || controller.signal.aborted) {
      appendLine("warn", "Stopped.");
      finishRun("stopped");
    } else if (isActive()) {
      finishRun("failed", err instanceof Error ? err.message : String(err));
    } else {
      showError(err);
    }
  } finally {
    setBusy(false);
    submitButton.textContent = "Fix comments";
    activeController = null;
  }
});

briefButton.addEventListener("click", async () => {
  if (!form.reportValidity()) return;
  resetPanels();
  startBriefing();
  setBusy(true);
  briefButton.textContent = "Briefing...";
  const controller = new AbortController();
  activeController = controller;

  try {
    const markdown = await streamRequest(
      "/brief",
      { prUrl: prUrlInput.value },
      appendLine,
      controller.signal,
    );
    if (controller.signal.aborted) {
      appendLine("warn", "Stopped.");
    } else if (markdown) {
      await showBriefing(markdown);
    }
  } catch (err) {
    if (isAbortError(err) || controller.signal.aborted) {
      appendLine("warn", "Stopped.");
    } else {
      showError(err);
    }
  } finally {
    setBusy(false);
    briefButton.textContent = "Brief PR";
    activeController = null;
  }
});

reviewButton.addEventListener("click", async () => {
  if (!form.reportValidity()) return;
  resetPanels();
  startCodeReview();
  setBusy(true);
  reviewButton.textContent = "Reviewing...";
  const controller = new AbortController();
  activeController = controller;

  // The structured review arrives on its own line, just before the Markdown
  // result; the panel needs both (cards from the first, download from the
  // second), so it is held here until the stream ends.
  let data = null;
  try {
    const markdown = await streamRequest(
      "/review",
      { prUrl: prUrlInput.value },
      appendLine,
      controller.signal,
      { onData: (d) => (data = d) },
    );
    if (controller.signal.aborted) {
      appendLine("warn", "Stopped.");
    } else if (data && markdown) {
      showCodeReview(data, markdown);
    }
  } catch (err) {
    if (isAbortError(err) || controller.signal.aborted) {
      appendLine("warn", "Stopped.");
    } else {
      showError(err);
    }
  } finally {
    setBusy(false);
    reviewButton.textContent = "Review PR";
    activeController = null;
  }
});

stopButton.addEventListener("click", () => {
  activeController?.abort();
});
