const output = document.getElementById("output");
const errorBox = document.getElementById("error");

export function appendLine(kind, text) {
  if (!text) return;
  if (!managed) output.hidden = false;
  const line = document.createElement("div");
  line.className = `log-line log-${kind}`;
  line.textContent = text;
  output.appendChild(line);
  output.scrollTop = output.scrollHeight;
}

export function showError(err) {
  errorBox.textContent = err instanceof Error ? err.message : String(err);
  errorBox.hidden = false;
}

// While the results view is active it owns the panel's visibility (its Raw
// log tab); otherwise the panel appears when the first line arrives.
let managed = false;
export function setLogManaged(value) {
  managed = value;
}

// Fills the panel from a saved run's log (a saved run has no live stream).
export function loadLog(entries) {
  output.textContent = "";
  for (const entry of entries) appendLine(entry.kind, entry.text);
}

export function clearLog() {
  errorBox.hidden = true;
  output.textContent = "";
  output.hidden = true;
}
