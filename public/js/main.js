import { streamRequest, isAbortError } from "./stream.js";
import { appendLine, showError, clearLog } from "./logView.js";
import {
  startRun,
  applyFixEvent,
  finishRun,
  resetResults,
  isActive,
} from "./resultsView.js";
import { applyStep, resetActivity, startActivity } from "./activity.js";
import { selectTab } from "./panelTabs.js";
import { hidePrCard, showPrCard, showPrLoading } from "./prCard.js";
import { clearBriefing, showBriefing, startBriefing } from "./briefing.js";
import {
  clearCodeReview,
  showCodeReview,
  startCodeReview,
} from "./codeReview.js";

const form = document.getElementById("fix-form");
const runButton = document.getElementById("run-button");
const loadButton = document.getElementById("load-button");
const stopButton = document.getElementById("stop-button");
const prUrlInput = document.getElementById("prUrl");
const dryRunInput = document.getElementById("dryRun");
const dryRunRow = document.getElementById("dryrun-row");
const statusEl = document.getElementById("status");
const statusText = document.getElementById("status-text");
const modeInputs = document.querySelectorAll('input[name="mode"]');

// The in-flight request's own controller, if any -- what the Stop
// button aborts. Aborting the fetch also closes the connection to the
// server, which (see server.ts) aborts the underlying Claude Agent SDK
// session too, so Stop actually halts the work instead of just hiding it.
let activeController = null;

function errorBoxReset() {
  clearLog();
}

function resetPanels() {
  resetActivity();
  clearLog();
  clearBriefing();
  clearCodeReview();
  resetResults();
}

function setStatus(state, text) {
  statusEl.dataset.state = state;
  statusText.textContent = text;
}

function setBusy(busy) {
  runButton.disabled = busy;
  loadButton.disabled = busy;
  for (const input of modeInputs) input.disabled = busy;
  stopButton.hidden = !busy;
  if (busy) setStatus("running", "Running");
}

// What each mode is called on the button, while idle and while running.
const MODES = {
  fix: { label: "Fix comments", busy: "Addressing..." },
  brief: { label: "Brief PR", busy: "Briefing..." },
  review: { label: "Review PR", busy: "Reviewing..." },
};

function currentMode() {
  return document.querySelector('input[name="mode"]:checked').value;
}

function syncMode() {
  const mode = currentMode();
  runButton.textContent = MODES[mode].label;
  // Only Fix comments writes anything; Brief and Review are read-only.
  dryRunRow.hidden = mode !== "fix";
}

for (const input of modeInputs) input.addEventListener("change", syncMode);
syncMode();

// Each action starts its own panel, streams, and renders its result. They
// share the abort, error and busy handling in runAction below.
const ACTIONS = {
  async fix(signal) {
    try {
      await streamRequest(
        "/fix",
        { prUrl: prUrlInput.value, dryRun: dryRunInput.checked },
        appendLine,
        signal,
        { onRun: startRun, onEvent: applyFixEvent, onStep: applyStep },
      );
      finishRun("completed");
      // Aborting mid-stream doesn't always reject the pending read (some
      // browsers just resolve it as a clean stream end) -- checking the
      // signal here is what catches that case instead of the request
      // silently looking like it finished normally.
      if (signal.aborted) {
        appendLine("warn", "Stopped.");
        finishRun("stopped");
      }
    } catch (err) {
      if (isAbortError(err) || signal.aborted) {
        appendLine("warn", "Stopped.");
        finishRun("stopped");
      } else if (isActive()) {
        finishRun("failed", err instanceof Error ? err.message : String(err));
      } else {
        throw err;
      }
    }
  },

  async brief(signal) {
    startBriefing();
    const markdown = await streamRequest(
      "/brief",
      { prUrl: prUrlInput.value },
      appendLine,
      signal,
      { onStep: applyStep },
    );
    if (signal.aborted) appendLine("warn", "Stopped.");
    else if (markdown) await showBriefing(markdown);
  },

  async review(signal) {
    startCodeReview();
    // The structured review arrives on its own line, just before the Markdown
    // result; the panel needs both (cards from the first, download from the
    // second), so it is held here until the stream ends.
    let data = null;
    const markdown = await streamRequest(
      "/review",
      { prUrl: prUrlInput.value },
      appendLine,
      signal,
      { onData: (d) => (data = d), onStep: applyStep },
    );
    if (signal.aborted) appendLine("warn", "Stopped.");
    else if (data && markdown) showCodeReview(data, markdown);
  },
};

async function runAction() {
  if (!form.reportValidity()) return;
  const mode = currentMode();
  resetPanels();
  startActivity();
  setBusy(true);
  runButton.textContent = MODES[mode].busy;
  const controller = new AbortController();
  activeController = controller;

  let failed = false;
  try {
    await ACTIONS[mode](controller.signal);
  } catch (err) {
    if (isAbortError(err) || controller.signal.aborted) {
      appendLine("warn", "Stopped.");
    } else {
      failed = true;
      showError(err);
    }
  } finally {
    setBusy(false);
    setStatus(failed ? "error" : "ready", failed ? "Failed" : "Ready");
    syncMode();
    activeController = null;
  }
}

runButton.addEventListener("click", runAction);

stopButton.addEventListener("click", () => {
  activeController?.abort();
});

// "Load PR" shows the PR's details before anything runs. Editing the link
// drops the old card so it never describes a different PR than the field.
let loadedUrl = null;

prUrlInput.addEventListener("input", () => {
  if (prUrlInput.value.trim() !== loadedUrl) hidePrCard();
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const prUrl = prUrlInput.value.trim();
  errorBoxReset();
  showPrLoading();
  loadButton.disabled = true;
  try {
    const response = await fetch(`/pr?prUrl=${encodeURIComponent(prUrl)}`);
    const body = await response.json().catch(() => ({}));
    if (!response.ok)
      throw new Error(body.error ?? `Failed (${response.status})`);
    loadedUrl = prUrl;
    showPrCard(body);
  } catch (err) {
    hidePrCard();
    showError(err);
  } finally {
    loadButton.disabled = false;
  }
});

// "View details" opens the full log: the Raw log tab when a results view has
// tabs up, otherwise the log panel itself.
document.getElementById("details-button").addEventListener("click", () => {
  const tabs = document.getElementById("results-tabs");
  if (!tabs.hidden) {
    selectTab("log");
  } else {
    const output = document.getElementById("output");
    output.hidden = !output.hidden;
  }
});
