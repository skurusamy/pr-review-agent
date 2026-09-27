const CODES = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  cyan: "\x1b[36m",
} as const;

export type ColorName = keyof typeof CODES;

// Colors only help a human staring at a live terminal -- piped output (a
// redirected log file, a CI artifact) should stay plain text, and NO_COLOR
// (https://no-color.org) is the standard opt-out.
const enabled = Boolean(process.stdout.isTTY) && !process.env.NO_COLOR;

export function paint(text: string, ...styles: ColorName[]): string {
  if (!enabled) {
    return text;
  }
  return styles.map((style) => CODES[style]).join("") + text + CODES.reset;
}
