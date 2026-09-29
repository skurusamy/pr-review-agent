// The saved-runs list: light summaries from GET /runs, opened on demand from
// GET /runs/:id into the same views a live run uses. Read-only. A run can
// also be opened straight from the page's hash (#run=<id>), so a link to it
// can be shared with a teammate on the same server.

const list = document.getElementById("history-list");
const count = document.getElementById("history-count");
const filter = document.getElementById("history-filter");

let summaries = [];
let openId = null;
let busy = false;
let onOpen = () => {};
let onMissing = () => {};

const prLabel = (s) => `${s.pr.owner}/${s.pr.repo}#${s.pr.prNumber}`;

function timeAgo(iso) {
  const seconds = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  return `${Math.floor(hours / 24)} d ago`;
}

function tallyText(tally) {
  const parts = [`${tally.threads} thread${tally.threads === 1 ? "" : "s"}`];
  if (tally.fixes)
    parts.push(`${tally.fixes} fix${tally.fixes === 1 ? "" : "es"}`);
  if (tally.drafts)
    parts.push(`${tally.drafts} draft${tally.drafts === 1 ? "" : "s"}`);
  if (tally.skipped) parts.push(`${tally.skipped} skipped`);
  return parts.join(" · ");
}

function span(className, text) {
  const el = document.createElement("span");
  el.className = className;
  el.textContent = text;
  return el;
}

function row(summary) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = `hx-row${summary.id === openId ? " selected" : ""}`;
  button.disabled = busy;
  button.addEventListener("click", () => openRun(summary.id));

  const top = document.createElement("div");
  top.className = "hx-top";
  const time = span("hx-time", timeAgo(summary.startedAt));
  time.title = new Date(summary.startedAt).toLocaleString();
  top.append(
    span("hx-kind", summary.kind === "briefing" ? "Briefing" : "Review"),
    span("hx-pr", prLabel(summary)),
    summary.kind === "review" && summary.dryRun !== undefined
      ? span("hx-badge", summary.dryRun ? "Dry run" : "Live")
      : "",
    span(`hx-badge hx-${summary.status}`, summary.status),
    summary.applied ? span("hx-badge hx-completed", "Applied") : "",
    time,
  );
  button.append(top);
  if (summary.tally) button.append(span("hx-tally", tallyText(summary.tally)));
  return button;
}

function render() {
  const q = filter.value.trim().toLowerCase();
  const shown = q
    ? summaries.filter((s) => prLabel(s).toLowerCase().includes(q))
    : summaries;
  count.textContent = String(summaries.length);
  list.replaceChildren(
    ...(shown.length
      ? shown.map(row)
      : [
          span(
            "hx-empty",
            summaries.length ? "No matching runs." : "No saved runs yet.",
          ),
        ]),
  );
}

export async function refreshHistory() {
  try {
    const response = await fetch("/runs");
    if (response.ok) summaries = await response.json();
  } catch {
    // History is a convenience; a failed refresh just leaves the old list.
  }
  render();
}

async function openRun(id) {
  if (busy) return;
  const response = await fetch(`/runs/${id}`);
  if (!response.ok) {
    onMissing(id);
    return;
  }
  openId = id;
  history.replaceState(null, "", `#run=${id}`);
  render();
  onOpen(await response.json());
}

/** Forget the opened run (a live run is starting), and drop it from the URL. */
export function clearOpenRun() {
  openId = null;
  if (location.hash) {
    history.replaceState(null, "", location.pathname + location.search);
  }
  render();
}

export function setHistoryBusy(value) {
  busy = value;
  render();
}

function openFromHash() {
  const id = /^#run=([\w-]+)$/.exec(location.hash)?.[1];
  if (id && id !== openId) openRun(id);
}

export async function initHistory(handlers) {
  onOpen = handlers.onOpen;
  onMissing = handlers.onMissing;
  filter.addEventListener("input", render);
  window.addEventListener("hashchange", openFromHash);
  document.addEventListener("history-stale", refreshHistory);
  await refreshHistory();
  openFromHash();
}
