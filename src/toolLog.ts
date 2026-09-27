const MAX_INPUT_CHARS = 150;
const MAX_THINKING_CHARS = 400;

// Tools the harness calls that are infrastructure, not investigation -- e.g.
// resolving a custom MCP tool by name before it's directly callable. Real
// for the model, meaningless to a human reading "what did the agent look
// at": logging it would just be noise.
const NOISE_TOOLS = new Set(["ToolSearch"]);

export function isNoiseTool(name: string): boolean {
  return NOISE_TOOLS.has(name);
}

/**
 * Formats a tool call for the same log stream everything else writes to --
 * not a full trace (that's what Langfuse would give, if it existed here),
 * just enough to see what the agent actually looked at or changed while
 * reaching a verdict or a fix. checkoutDir, when given, is stripped from
 * any path in the input so a real user sees "README.md", not
 * "/private/var/folders/.../pr-review-agent-KhijLh/README.md".
 */
export function formatToolUse(
  name: string,
  input: unknown,
  checkoutDir?: string,
): string {
  let inputStr = JSON.stringify(input);
  if (checkoutDir) {
    // Anchored to a JSON string's opening quote, not a bare global
    // substring match -- a naive split(checkoutDir) also matches
    // checkoutDir sitting in the MIDDLE of a longer, unrelated path (e.g.
    // macOS's /var -> /private/var symlink meant a real path looked like
    // "/private" + checkoutDir + "/README.md", and a bare split mangled it
    // into "/privateREADME.md"). Matching `"${checkoutDir}/` requires the
    // value to actually START with checkoutDir, so a coincidental
    // substring elsewhere is left alone instead of being silently cut out.
    inputStr = inputStr.split(`"${checkoutDir}/`).join('"');
  }
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
