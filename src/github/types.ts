export interface ReviewComment {
  id: number;
  path: string;
  /** Current diff line; null when the comment is outdated (see `outdated`). */
  line: number | null;
  /** Line the comment was originally made on, even if the diff has since moved. */
  originalLine: number | null;
  diffHunk: string;
  body: string;
  author: string;
  createdAt: string;
  htmlUrl: string;
  /** True when the PR's diff has moved past this comment's original position. */
  outdated: boolean;
}

export interface ReviewThread {
  rootComment: ReviewComment;
  /** Replies to the root comment, oldest first. */
  replies: ReviewComment[];
}
