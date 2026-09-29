import { streamRequest, isAbortError } from "./stream.js";
import { appendLine, showError, clearLog, loadLog } from "./logView.js";
import {
  startRun,
  applyFixEvent,
  finishRun,
  resetResults,
  isActive,
  showRecord,
} from "./resultsView.js";
import {
  initHistory,
  refreshHistory,
  clearOpenRun,
  setHistoryBusy,
} from "./history.js";
import { clearBriefing, showBriefing, startBriefing } from "./briefing.js";

const form = document.getElementById("fix-form");
const submitButton = document.getElementById("submit-button");
const briefButton = document.getElementById("brief-button");
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
  resetResults();
}

function setBusy(busy) {
  submitButton.disabled = busy;
  briefButton.disabled = busy;
  stopButton.hidden = !busy;
  // Opening a saved run mid-stream would replace the live one on screen.
  setHistoryBusy(busy);
  // A finished (or failed) run is saved by now, so it joins the list.
  if (!busy) refreshHistory();
}

// A saved run shows in the same views as a live one, read-only.
function openSaved(record) {
  resetPanels();
  if (record.kind === "briefing") {
    startBriefing();
    loadLog(record.rawLog);
    if (record.briefingMarkdown) {
      showBriefing(record.briefingMarkdown, record.startedAt);
    } else if (record.error) {
      showError(new Error(record.error));
    }
  } else {
    showRecord(record);
    loadLog(record.rawLog);
  }
}

initHistory({
  onOpen: openSaved,
  onMissing: () => {
    resetPanels();
    showError(
      new Error(
        "That run isn't in this server's history (it may have been pruned).",
      ),
    );
  },
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  resetPanels();
  clearOpenRun();
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
  resetPanels();
  clearOpenRun();
  startBriefing();
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
