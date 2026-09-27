const MAX_INPUT_CHARS = 150;
const MAX_THINKING_CHARS = 400;

/**
 * Formats a tool call for the same log stream everything else writes to --
 * not a full trace (that's what Langfuse would give, if it existed here),
 * just enough to see what the agent actually looked at or changed while
 * reaching a verdict or a fix.
 */
export function formatToolUse(name: string, input: unknown): string {
  const inputStr = JSON.stringify(input);
  const truncated =
    inputStr.length > MAX_INPUT_CHARS
      ? `${inputStr.slice(0, MAX_INPUT_CHARS)}...`
      : inputStr;
  return `  [tool] ${name} ${truncated}`;
}

/**
 * Formats a thinking block the same way -- a longer allowance than tool
 * input, since reasoning text is prose, not a short argument list.
 */
export function formatThinking(text: string): string {
  const truncated =
    text.length > MAX_THINKING_CHARS
      ? `${text.slice(0, MAX_THINKING_CHARS)}...`
      : text;
  return `  [thinking] ${truncated}`;
}
