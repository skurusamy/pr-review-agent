import { applyEvent, newRun, groupThreads } from "./runState.js";
import { showTabs, hideTabs } from "./panelTabs.js";
import { streamRequest } from "./stream.js";
import { appendLine } from "./logView.js";

// The Fix Run results view: a grouped list of review threads on the left,
// one thread's detail on the right, plus a Raw log tab (the existing log
// panel). It draws the run record it holds, built live from streamed events.
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
      label:
        run.dryRun && !run.applied?.complete
          ? "Fix ready (would push)"
          : "Fix pushed",
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

function banner(run) {
  const parts = [];
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

// ---- Applying a dry run's saved results to the PR. The server does the work
// (POST /runs/:id/apply); this is the confirm step and its progress. ----

let applyUi = { phase: "idle", message: "" };

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

function applyCounts(run) {
  const kinds = run.threads.map((t) => t.outcome?.kind);
  return {
    fixes: kinds.filter((k) => k === "fix").length,
    drafts: kinds.filter((k) => k === "draft" || k === "fix-failed").length,
  };
}

function applyBar(run) {
  if (run.kind !== "fix" || run.dryRun !== true) return null;
  if (run.status !== "completed" || !run.pr) return null;
  const { fixes, drafts } = applyCounts(run);
  if (fixes === 0 && drafts === 0) return null;

  if (run.applied?.complete) {
    return h(
      "div",
      { class: "rv-apply done" },
      `Applied on ${new Date(run.applied.finishedAt ?? run.applied.at).toLocaleString()}: ${plural(fixes, "fix", "fixes")} pushed, ${plural(drafts, "draft reply", "draft replies")} in a pending review.`,
    );
  }

  const target = `${run.pr.owner}/${run.pr.repo}#${run.pr.prNumber}`;
  const what = [
    fixes && `push ${plural(fixes, "fix", "fixes")}`,
    drafts &&
      `create a pending review with ${plural(drafts, "draft reply", "draft replies")}`,
  ]
    .filter(Boolean)
    .join(" and ");
  const bar = h("div", { class: "rv-apply" });
  const failed = (run.applied?.items ?? []).filter(
    (i) => i.status === "failed",
  );

  if (applyUi.phase === "running") {
    bar.append(h("span", {}, applyUi.message || "Applying..."));
    return bar;
  }
  if (applyUi.phase === "confirm") {
    const confirm = h("button", { type: "button" }, "Confirm");
    confirm.addEventListener("click", () => startApply(run));
    const cancel = h(
      "button",
      { type: "button", class: "secondary" },
      "Cancel",
    );
    cancel.addEventListener("click", () => {
      applyUi = { phase: "idle", message: "" };
      render();
    });
    bar.append(
      h("span", {}, `Apply to ${target}? This will ${what}.`),
      confirm,
      cancel,
    );
    return bar;
  }

  const start = h(
    "button",
    { type: "button" },
    run.applied ? "Retry apply" : "Apply this run",
  );
  start.addEventListener("click", () => {
    applyUi = { phase: "confirm", message: "" };
    render();
  });
  bar.append(
    h(
      "span",
      {},
      run.applied
        ? `Partly applied: ${plural(failed.length, "item", "items")} still to do.`
        : `Not applied yet: ${what}.`,
    ),
    start,
  );
  if (applyUi.message)
    bar.append(h("p", { class: "rv-apply-error" }, applyUi.message));
  for (const item of failed) {
    const thread = run.threads.find((t) => t.threadId === item.threadId);
    bar.append(
      h(
        "p",
        { class: "rv-apply-error" },
        `${thread ? location(thread) : item.threadId}: ${item.detail}`,
      ),
    );
  }
  return bar;
}

async function refetchRecord() {
  const response = await fetch(`/runs/${record.id}`);
  if (response.ok) record = await response.json();
}

async function startApply(run) {
  applyUi = { phase: "running", message: "Applying..." };
  render();
  try {
    await streamRequest(`/runs/${run.id}/apply`, {}, (kind, text) => {
      appendLine(kind, text);
      applyUi = { phase: "running", message: text };
      render();
    });
    applyUi = { phase: "idle", message: "" };
  } catch (err) {
    applyUi = {
      phase: "idle",
      message: err instanceof Error ? err.message : String(err),
    };
  }
  // The server's record now carries the outcome (and any failed items).
  try {
    await refetchRecord();
  } catch {
    // Keep what's on screen; the message above already says what happened.
  }
  render();
}

function render() {
  renderQueued = false;
  if (!record) return;
  const run = record;

  const nodes = [banner(run), applyBar(run)].filter(Boolean);
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
    // A live run follows its newest thread.
    const fallback = run.threads[run.threads.length - 1];
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
  applyUi = { phase: "idle", message: "" };

  selectedId = null;
  reasoningOpen.clear();
  patchExpanded.clear();
  showTabs("Summary", summary);
  render();
}

export function applyFixEvent(event) {
  if (!record) return;
  record = applyEvent(record, event);
  scheduleRender();
}

export function finishRun(status, error) {
  if (!record) return;
  record = { ...record, status, ...(error ? { error } : {}) };
  render();
  // The apply step needs what only the server's record has (the PR, and any
  // earlier apply), so a finished dry run pulls it in.
  if (status === "completed" && record.dryRun) {
    refetchRecord()
      .then(render)
      .catch(() => {});
  }
}

export function resetResults() {
  record = null;
  selectedId = null;
  hideTabs();
  summary.textContent = "";
}
