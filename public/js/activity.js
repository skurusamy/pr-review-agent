import { h } from "./dom.js";

// The Agent activity checklist: one row per {kind: "step"} update from the
// server. A step arrives as "running" and then again as "done" or "failed";
// the timestamps it carries give each row its duration.

const card = document.getElementById("activity");
const list = document.getElementById("activity-steps");

const rows = new Map();
const startedAt = new Map();

const ICONS = { running: "◔", done: "✓", failed: "✕" };

export function resetActivity() {
  rows.clear();
  startedAt.clear();
  list.replaceChildren();
  card.hidden = true;
}

export function startActivity() {
  resetActivity();
  card.hidden = false;
}

export function applyStep(step) {
  let row = rows.get(step.id);
  if (!row) {
    row = {
      li: h("li", "step"),
      icon: h("span", "step-icon"),
      label: h("span", "step-label"),
      time: h("span", "step-time"),
    };
    row.li.append(row.icon, row.label, row.time);
    list.append(row.li);
    rows.set(step.id, row);
    startedAt.set(step.id, step.at);
  }
  row.li.dataset.status = step.status;
  row.icon.textContent = ICONS[step.status];
  row.label.textContent = `${step.label}${step.status === "running" ? "..." : ""}`;
  if (step.status !== "running") {
    const seconds = Math.max(
      0,
      Math.round((step.at - startedAt.get(step.id)) / 1000),
    );
    row.time.textContent = `${seconds}s`;
  }
}
