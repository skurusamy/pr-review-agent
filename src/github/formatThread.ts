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
