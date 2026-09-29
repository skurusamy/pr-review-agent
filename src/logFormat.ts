export type LogLineKind =
  | "thinking"
  | "tool"
  | "verdict-bug"
  | "verdict-not-bug"
  | "section"
  | "success"
  | "warn"
  | "error"
  | "info";

/**
 * Classifies a line from the fix run's log stream by its prefix, so the
 * CLI (ANSI colors) and the UI (CSS classes) can render each kind distinctly
 * without either one re-deriving the same rules twice. "error" is never
 * produced here -- runFix's own log lines never report a caught
 * exception, only its callers do, and they label that line directly.
 */
export function classifyLogLine(line: string): LogLineKind {
  const trimmed = line.trim();

  if (trimmed.startsWith("[thinking]")) {
    return "thinking";
  }
  if (trimmed.startsWith("[tool]")) {
    return "tool";
  }
  if (trimmed.startsWith("Verdict: bug")) {
    return "verdict-bug";
  }
  if (trimmed.startsWith("Verdict: not-a-bug")) {
    return "verdict-not-bug";
  }
  if (trimmed.startsWith("---")) {
    return "section";
  }
  if (
    trimmed.startsWith("Pushed commit") ||
    trimmed.startsWith("[dry-run] Would push commit") ||
    trimmed.startsWith("Created a pending review")
  ) {
    return "success";
  }
  if (
    trimmed.startsWith("Fix Attempt exhausted") ||
    trimmed.startsWith("Could not reach a verdict") ||
    trimmed.startsWith("Could not create a pending review")
  ) {
    return "warn";
  }
  return "info";
}
