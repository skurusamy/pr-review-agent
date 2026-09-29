import { applyEvent, newRun, groupThreads } from "./runState.js";
import { showTabs, hideTabs } from "./panelTabs.js";

// The Review Run results view: a grouped list of review threads on the left,
// one thread's detail on the right, plus a Raw log tab (the existing log
// panel). It draws whatever run record it holds, built live from streamed
// events, so the same code can later draw a saved record.
//
// Everything below is built with textContent, never innerHTML: comment text,
// reasoning and patches all come from PR content and the model.

const PATCH_PREVIEW_LINES = 200;

const summary = document.getElementById("results-summary");

let record = null;
// null means "follow the newest thread"; a click pins the selection.
let selectedId = null;
const reasoningOpen = new Set();
const patchExpanded = new Set();
let renderQueued = false;

function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs ?? {})) {
    if (k === "class") el.className = v;
    else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v);
  }
  for (const kid of kids.flat(Infinity)) {
    if (kid == null || kid === false) continue;
    el.append(kid.nodeType ? kid : document.createTextNode(kid));
  }
  return el;
}

const location = (t) => `${t.path}${t.line ? ":" + t.line : ""}`;

function outcomeInfo(thread, run) {
  const kind = thread.outcome?.kind;
  if (!kind) {
    return run.status === "running"
      ? { label: "Working...", tone: "info" }
      : { label: "Interrupted", tone: "warn" };
  }
  return {
    fix: {
      label: run.dryRun ? "Fix ready (would push)" : "Fix pushed",
      tone: "success",
    },
    draft: { label: "Draft reply", tone: "info" },
    "fix-failed": { label: "Fix failed, draft reply", tone: "warn" },
    skipped: { label: "Skipped", tone: "muted" },
  }[kind];
}

const badge = (text, tone) =>
  h("span", { class: `rv-badge tone-${tone}` }, text);

function verdictBadge(thread) {
  if (thread.verdict === "bug") return badge("BUG", "danger");
  if (thread.verdict === "not-a-bug") return badge("NOT A BUG", "success");
  // Still working (or cut off): no verdict yet is not the same as none reached.
  return thread.outcome ? badge("NO VERDICT", "muted") : null;
}

function patchView(thread) {
  const patch = thread.outcome.patch;
  const all = patch.split("\n");
  const expanded = patchExpanded.has(thread.threadId);
  const shown = expanded ? all : all.slice(0, PATCH_PREVIEW_LINES);
  const actions = h("div", { class: "rv-patch-actions" });
  if (all.length > PATCH_PREVIEW_LINES) {
    actions.append(
      h(
        "button",
        {
          type: "button",
          class: "secondary",
          onclick: () => {
            if (expanded) patchExpanded.delete(thread.threadId);
            else patchExpanded.add(thread.threadId);
            render();
          },
        },
        expanded ? "Show less" : `Show full patch (${all.length} lines)`,
      ),
    );
  }
  const copy = h(
    "button",
    { type: "button", class: "secondary" },
    "Copy patch",
  );
  copy.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(patch);
      copy.textContent = "Copied";
    } catch {
      copy.textContent = "Copy failed";
    }
  });
  actions.append(copy);
  return [
    h(
      "pre",
      { class: "rv-patch" },
      shown.map((line) =>
        h(
          "div",
          {
            class:
              line.startsWith("+") && !line.startsWith("+++")
                ? "add"
                : line.startsWith("-") && !line.startsWith("---")
                  ? "del"
                  : "",
          },
          line,
        ),
      ),
    ),
    actions,
  ];
}

function reasoningView(thread) {
  if (thread.log.length === 0) return null;
  const details = h(
    "details",
    { class: "rv-reasoning" },
    h("summary", {}, "Show reasoning"),
    h(
      "div",
      { class: "rv-log" },
      thread.log.map((entry) =>
        h("div", { class: `log-line log-${entry.kind}` }, entry.text),
      ),
    ),
  );
  if (reasoningOpen.has(thread.threadId)) details.open = true;
  details.addEventListener("toggle", () => {
    if (details.open) reasoningOpen.add(thread.threadId);
    else reasoningOpen.delete(thread.threadId);
  });
  return details;
}

function detailView(thread, run) {
  const info = outcomeInfo(thread, run);
  const outcome = thread.outcome;
  return h(
    "article",
    { class: "rv-detail" },
    h(
      "header",
      {},
      h("code", {}, location(thread)),
      thread.outdated && badge("outdated", "muted"),
      verdictBadge(thread),
      badge(info.label, info.tone),
    ),
    h(
      "blockquote",
      { class: "rv-quote" },
      h("b", {}, `@${thread.reviewer}: `),
      thread.comment,
    ),
    thread.reasoning && h("p", {}, h("b", {}, "Agent: "), thread.reasoning),
    outcome?.kind === "fix" && [
      h(
        "p",
        { class: "rv-sub" },
        `${outcome.summary} — Validation Gate passed (${outcome.gateSteps.join(", ")}) after ${outcome.attempts} attempt${outcome.attempts === 1 ? "" : "s"}`,
      ),
      patchView(thread),
    ],
    outcome?.kind === "fix-failed" &&
      h(
        "p",
        { class: "rv-sub" },
        `${outcome.attempts} attempts, last failed at ${outcome.failedGate}. Working tree reset.`,
      ),
    (outcome?.kind === "draft" || outcome?.kind === "fix-failed") && [
      h("p", { class: "rv-sub" }, "Draft reply:"),
      h("div", { class: "rv-draft" }, outcome.body),
    ],
    outcome?.kind === "skipped" &&
      h(
        "p",
        { class: "rv-sub" },
        outcome.reason === "already-handled"
          ? "Already handled in a previous run (Agent Marker found)."
          : "The agent could not reach a verdict for this comment.",
      ),
    reasoningView(thread),
  );
}

function savedNote(run) {
  const when = new Date(run.startedAt).toLocaleString();
  return `Saved run from ${when}${run.status === "running" ? " (still running)" : ""}.`;
}

function banner(run) {
  const parts = [];
  if (run.saved) parts.push(savedNote(run));
  if (run.status === "failed") {
    return h(
      "div",
      { class: "rv-banner failed" },
      [...parts, `Run failed${run.error ? `: ${run.error}` : "."}`].join(" "),
    );
  }
  if (run.status === "stopped") {
    parts.push(run.error ? `Stopped: ${run.error}` : "Stopped.");
  }
  parts.push(
    run.dryRun === undefined
      ? ""
      : run.dryRun
        ? "Dry run: nothing was pushed or posted."
        : "Live run.",
  );
  return h("div", { class: "rv-banner" }, parts.filter(Boolean).join(" "));
}

function render() {
  renderQueued = false;
  if (!record) return;
  const run = record;

  const nodes = [banner(run)];
  if (run.threads.length === 0) {
    nodes.push(
      h(
        "p",
        { class: "rv-empty" },
        run.status === "running"
          ? "Fetching review comments..."
          : run.status === "completed"
            ? "No review comments on this PR."
            : "No review comments were reached.",
      ),
    );
  } else {
    // A live run follows its newest thread; a saved one has nothing new
    // coming, so it opens on the first thread the list shows.
    const fallback = run.saved
      ? groupThreads(run)[0].threads[0]
      : run.threads[run.threads.length - 1];
    const current =
      run.threads.find((t) => t.threadId === selectedId) ?? fallback;
    const list = h("nav", { class: "rv-list" });
    for (const group of groupThreads(run)) {
      list.append(h("h3", {}, `${group.title} (${group.threads.length})`));
      for (const thread of group.threads) {
        const info = outcomeInfo(thread, run);
        list.append(
          h(
            "button",
            {
              type: "button",
              class: `rv-row${thread.threadId === current.threadId ? " selected" : ""}`,
              onclick: () => {
                selectedId = thread.threadId;
                render();
              },
            },
            h("span", { class: `rv-dot tone-${info.tone}` }),
            h("code", {}, location(thread)),
          ),
        );
      }
    }
    nodes.push(h("div", { class: "rv-split" }, list, detailView(current, run)));
  }
  summary.replaceChildren(...nodes);
}

// A run streams many log lines; coalescing to one render per frame keeps the
// page responsive without dropping any state (it is all in `record`).
function scheduleRender() {
  if (renderQueued) return;
  renderQueued = true;
  requestAnimationFrame(render);
}

export function isActive() {
  return record !== null;
}

export function startRun(id) {
  record = newRun(id);

  selectedId = null;
  reasoningOpen.clear();
  patchExpanded.clear();
  showTabs("Summary", summary);
  render();
}

export function applyReviewEvent(event) {
  if (!record) return;
  record = applyEvent(record, event);
  scheduleRender();
}

export function finishRun(status, error) {
  if (!record) return;
  record = { ...record, status, ...(error ? { error } : {}) };
  render();
}

/** Shows a saved RunRecord, read-only, in the same view a live run uses. */
export function showRecord(saved) {
  record = { ...saved, saved: true };
  selectedId = null;
  reasoningOpen.clear();
  patchExpanded.clear();
  showTabs("Summary", summary);
  render();
}

export function resetResults() {
  record = null;
  selectedId = null;
  hideTabs();
  summary.textContent = "";
}
