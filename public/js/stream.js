export function isAbortError(err) {
  return err instanceof DOMException && err.name === "AbortError";
}

// Shared by /review and /brief: both stream newline-delimited JSON,
// one object per log line, so progress shows up live instead of only
// after the whole request finishes. /brief also sends one
// {kind: "result"} line carrying the rendered Markdown -- everything
// else is a progress line for onLine to render.
//
// It also carries {kind: "run", text: <run id>} once at the start and, for
// /review, {kind: "event", event: <ReviewEvent>} lines; both go to the
// optional handlers and are otherwise ignored.
export async function streamRequest(url, body, onLine, signal, handlers = {}) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });

  if (!response.ok || !response.body) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error ?? `Request failed (${response.status})`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let result = null;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const raw of lines) {
      if (!raw) continue;
      const entry = JSON.parse(raw);
      if (entry.kind === "done") continue;
      if (entry.kind === "run") {
        handlers.onRun?.(entry.text);
        continue;
      }
      if (entry.kind === "event") {
        handlers.onEvent?.(entry.event);
        continue;
      }
      if (entry.kind === "error") throw new Error(entry.text);
      if (entry.kind === "result") {
        result = entry.text;
        continue;
      }
      onLine(entry.kind, entry.text);
    }
  }
  return result;
}
