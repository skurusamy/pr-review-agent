import { classifyLogLine } from "./logFormat.js";
import { paint } from "./ansi.js";

/**
 * The CLI's `log` callback: colors each line by its kind before writing it
 * to stdout. The color-vs-plain decision (TTY, NO_COLOR) lives in ansi.ts;
 * this just maps a kind to a style.
 */
export function colorizeLine(line: string): string {
  switch (classifyLogLine(line)) {
    case "thinking":
      return paint(line, "dim", "cyan");
    case "tool":
      return paint(line, "blue");
    case "verdict-bug":
      return paint(line, "bold", "red");
    case "verdict-not-bug":
      return paint(line, "green");
    case "section":
      return paint(line, "bold");
    case "success":
      return paint(line, "green");
    case "warn":
      return paint(line, "yellow");
    case "error":
      return paint(line, "bold", "red");
    case "info":
      return line;
  }
}
