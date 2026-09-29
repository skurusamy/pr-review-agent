import type { PrComment } from "../briefing/fetchPrContext.js";
import type { ReviewComment, ReviewThread } from "./types.js";

// Our own replies end in a hidden Agent Marker; it is bookkeeping, not part
// of what anyone said.
const stripAgentMarker = (body: string): string =>
  body.replace(/\s*<!-- pr-review-agent:comment-\d+ -->\s*$/, "");

/**
 * Who wrote a comment, in the words a prompt needs: the PR author's own
 * replies are their explanation of intent, the reviewer's are the concern, and
 * the model can't tell which is which from a bare username.
 */
export function describeAuthor(
  thread: ReviewThread,
  comment: ReviewComment,
): string {
  const same = (a: string | undefined, b: string): boolean =>
    a?.toLowerCase() === b.toLowerCase();
  if (same(thread.prAuthor, comment.author)) {
    return `${comment.author} (PR author)`;
  }
  if (comment.id === thread.rootComment.id) {
    return `${comment.author} (reviewer)`;
  }
  if (same(thread.rootComment.author, comment.author)) {
    return `${comment.author} (reviewer)`;
  }
  return comment.author;
}

/** The opening comment's author, e.g. "alice (reviewer)". */
export function describeRootAuthor(thread: ReviewThread): string {
  return describeAuthor(thread, thread.rootComment);
}

/**
 * The replies under the opening comment, oldest first, as a prompt section
 * (or an empty string when there are none). Every reply is included: a
 * clarification ("I meant the other function") or an explanation ("this is
 * intentional") can change what the right answer is.
 */
export function formatRepliesForPrompt(thread: ReviewThread): string {
  if (thread.replies.length === 0) return "";
  const lines = thread.replies.map(
    (r) => `- ${describeAuthor(thread, r)}: ${stripAgentMarker(r.body)}`,
  );
  return `\n\nReplies in this thread, oldest first:\n${lines.join("\n")}`;
}

// These sections go into prompts that are sent once per comment (Fix comments)
// or once per review, so they are bounded: a PR with a very long discussion
// must not crowd out the thing the model is actually being asked about.
export const MAX_CONVERSATION_COMMENTS = 20;
export const MAX_THREADS_SHOWN = 30;
export const MAX_COMMENT_CHARS = 1500;

const clip = (text: string): string =>
  text.length > MAX_COMMENT_CHARS
    ? `${text.slice(0, MAX_COMMENT_CHARS)}...(truncated)`
    : text;

/**
 * The PR's top-level conversation as a prompt section: the most recent
 * MAX_CONVERSATION_COMMENTS comments, each clipped, with the PR author's own
 * comments labelled. Empty string when there is nothing to show.
 */
export function formatConversationForPrompt(
  comments: PrComment[],
  prAuthor?: string,
): string {
  if (comments.length === 0) return "";
  const shown = comments.slice(-MAX_CONVERSATION_COMMENTS);
  const omitted = comments.length - shown.length;
  const lines = shown.map(
    (c) =>
      `- ${prAuthor?.toLowerCase() === c.author.toLowerCase() ? `${c.author} (PR author)` : c.author}: ${clip(stripAgentMarker(c.body))}`,
  );
  const note = omitted > 0 ? ` (${omitted} earlier comment(s) not shown)` : "";
  return `\n\nDiscussion on the PR as a whole${note}, oldest first:\n${lines.join("\n")}`;
}

/**
 * The inline review threads already on the PR, as a prompt section: where
 * each one is, whether it is open, resolved or outdated, and what was said.
 * Lets a reviewer (human or model) avoid repeating a point somebody already
 * raised, and see which ones people considered settled. Bounded to
 * MAX_THREADS_SHOWN threads, open ones first.
 */
export function formatExistingThreadsForPrompt(
  threads: ReviewThread[],
): string {
  if (threads.length === 0) return "";
  const state = (t: ReviewThread): string =>
    t.resolved ? "resolved" : t.rootComment.outdated ? "outdated" : "open";
  // Open threads matter most for "don't repeat this", so they win the cap.
  const ordered = [...threads].sort(
    (a, b) => Number(a.resolved === true) - Number(b.resolved === true),
  );
  const shown = ordered.slice(0, MAX_THREADS_SHOWN);
  const omitted = threads.length - shown.length;
  const blocks = shown.map((t) => {
    const at = `${t.rootComment.path}:${t.rootComment.line ?? t.rootComment.originalLine}`;
    const comments = [t.rootComment, ...t.replies].map(
      (c) => `  ${describeAuthor(t, c)}: ${clip(stripAgentMarker(c.body))}`,
    );
    return `- ${at} [${state(t)}]\n${comments.join("\n")}`;
  });
  const note = omitted > 0 ? `\n(${omitted} more thread(s) not shown)` : "";
  return `\n\nInline review threads already on this PR:\n${blocks.join("\n")}${note}`;
}
