import { streamRequest, isAbortError } from "./stream.js";
import { appendLine, showError, clearLog } from "./logView.js";
import {
  clearBriefing,
  showBriefing,
  initBriefingActions,
} from "./briefing.js";

const form = document.getElementById("review-form");
const submitButton = document.getElementById("submit-button");
const briefButton = document.getElementById("brief-button");
const stopButton = document.getElementById("stop-button");
const prUrlInput = document.getElementById("prUrl");
const dryRunInput = document.getElementById("dryRun");

initBriefingActions(() => prUrlInput.value);

// The in-flight request's own controller, if any -- what the Stop
// button aborts. Aborting the fetch also closes the connection to the
// server, which (see server.ts) aborts the underlying Claude Agent SDK
// session too, so Stop actually halts the work instead of just hiding it.
let activeController = null;

function resetPanels() {
  clearLog();
  clearBriefing();
}

function setBusy(busy) {
  submitButton.disabled = busy;
  briefButton.disabled = busy;
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
      "/review",
      { prUrl: prUrlInput.value, dryRun: dryRunInput.checked },
      appendLine,
      controller.signal,
    );
    // Aborting mid-stream doesn't always reject the pending read (some
    // browsers just resolve it as a clean stream end) -- checking the
    // signal here is what catches that case instead of the request
    // silently looking like it finished normally.
    if (controller.signal.aborted) {
      appendLine("warn", "Stopped.");
    }
  } catch (err) {
    if (isAbortError(err) || controller.signal.aborted) {
      appendLine("warn", "Stopped.");
    } else {
      showError(err);
    }
  } finally {
    setBusy(false);
    submitButton.textContent = "Address review comments";
    activeController = null;
  }
});

briefButton.addEventListener("click", async () => {
  resetPanels();
  setBusy(true);
  briefButton.textContent = "Generating...";
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
    briefButton.textContent = "Generate PR Briefing";
    activeController = null;
  }
});

stopButton.addEventListener("click", () => {
  activeController?.abort();
});
