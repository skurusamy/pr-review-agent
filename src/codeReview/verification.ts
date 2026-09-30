import { z } from "zod";

/**
 * What the verify pass concluded about one Finding (see CONTEXT.md).
 * confirmed: a fresh session found the concrete code that makes it true.
 * refuted: it found code showing the Finding is wrong.
 * unsure: it could not decide, or ran out of turns. Never treated as confirmed.
 * unchecked: not looked at, because only the most severe few are checked.
 */
export const VERIFICATION_STATUSES = [
  "confirmed",
  "refuted",
  "unsure",
  "unchecked",
] as const;

export type VerificationStatus = (typeof VERIFICATION_STATUSES)[number];

export interface Verification {
  status: VerificationStatus;
  /** What the check looked at, in its own words. */
  evidence: string;
  /**
   * Only when the finding came with a suggested change: whether the check
   * judged that change correct. Anything but `true` keeps it out of the posted comment.
   */
  suggestionOk?: boolean;
}

/** The shape a Verification has when it comes back from the browser. */
export const verificationSchema = z.object({
  status: z.enum(VERIFICATION_STATUSES),
  evidence: z.string(),
  suggestionOk: z.boolean().optional(),
});

/**
 * Whether a Finding may go into a pending review as an inline comment. A
 * Finding nobody checked at all (an older review, or a run where the verify
 * pass was off) keeps the old behavior; once it has been through the verify
 * pass, only a confirmed one goes inline.
 */
export function postsInline(f: { verification?: Verification }): boolean {
  return f.verification === undefined || f.verification.status === "confirmed";
}

/** Checked by the verify pass and found wrong: kept in the report, never posted. */
export function isDismissed(f: { verification?: Verification }): boolean {
  return f.verification?.status === "refuted";
}

/** The one-line note under a finding that went through the verify pass. */
export function describeVerification(v: Verification): string {
  const label: Record<VerificationStatus, string> = {
    confirmed: "Confirmed by a second check",
    refuted: "Dismissed by a second check",
    unsure: "Not confirmed: the second check could not decide",
    unchecked: "Not checked",
  };
  return `${label[v.status]}: ${v.evidence}`;
}
