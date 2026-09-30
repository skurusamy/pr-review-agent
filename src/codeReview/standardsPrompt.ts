/**
 * The "standards" axis of a Code Review: does the diff follow the repo's
 * documented rules, and, where nothing is documented, does it show a known
 * code smell. The smell list is a fixed baseline taken from Fowler's
 * _Refactoring_, ch. 3, as used by the two-axis code-review approach this
 * borrows from. It lives here, in our own prompt, and is not loaded from a
 * skill at run time.
 */
export const SMELL_BASELINE = [
  "Mysterious Name: a name that does not say what the thing is or does",
  "Duplicated Code: the same logic in more than one place in the change",
  "Feature Envy: a function that uses another object's data more than its own",
  "Data Clumps: the same few fields or parameters always travelling together",
  "Primitive Obsession: a string or number standing in for a domain concept",
  "Repeated Switches: the same switch or if-chain on one type, repeated",
  "Shotgun Surgery: one logical change forcing edits scattered over many files",
  "Divergent Change: one file edited for several unrelated reasons",
  "Speculative Generality: hooks or parameters for needs nobody has",
  "Message Chains: long a.b().c().d() navigation callers should not know about",
  "Middle Man: a function that only hands work on to another",
  "Refused Bequest: a subclass that ignores most of what it inherits",
];

/** At most this many smell findings per review: a smell is an opinion, not a bug. */
export const MAX_SMELL_FINDINGS = 2;

/** The bullet added to the review's "Look for" list. */
export function standardsBullet(hasRepoRules: boolean): string {
  const documented = hasRepoRules
    ? "a convention the repo's written rules (above) document and the diff breaks: quote the rule and name its file in the explanation. A documented rule always beats the smell list below: never flag what the rules endorse. "
    : "";
  return `- standards: ${documented}Otherwise, at most ${MAX_SMELL_FINDINGS} clear code smells from this list, always severity low, titled "Possible <smell>": ${SMELL_BASELINE.join("; ")}. A smell is a judgment call, not a bug: report one only when the diff plainly shows it. Skip anything the linter, the formatter or the type checker already enforces.`;
}
