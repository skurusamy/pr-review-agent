import type { Octokit } from "octokit";

/** What GitHub's GraphQL API knows about a review thread that REST does not. */
export interface ThreadInfo {
  /** The GraphQL node id, which is what adding a reply to the thread needs. */
  nodeId: string;
  /** Whether someone marked the conversation resolved. */
  resolved: boolean;
}

interface ReviewThreadsPage {
  repository: {
    pullRequest: {
      reviewThreads: {
        pageInfo: { hasNextPage: boolean; endCursor: string | null };
        nodes: {
          id: string;
          isResolved?: boolean;
          comments: { nodes: { databaseId: number | null }[] };
        }[];
      };
    };
  };
}

/**
 * Every review thread on the PR, keyed by its root comment's id (the REST id
 * the rest of the agent uses). The REST API has no "resolved" flag and no
 * thread node ids, so this is the one place they come from.
 */
export async function fetchThreadIndex(
  octokit: Octokit,
  owner: string,
  repo: string,
  prNumber: number,
): Promise<Map<number, ThreadInfo>> {
  const index = new Map<number, ThreadInfo>();
  let after: string | null = null;
  for (;;) {
    const page: ReviewThreadsPage = await octokit.graphql(
      `query($owner: String!, $repo: String!, $number: Int!, $after: String) {
        repository(owner: $owner, name: $repo) {
          pullRequest(number: $number) {
            reviewThreads(first: 100, after: $after) {
              pageInfo { hasNextPage endCursor }
              nodes {
                id
                isResolved
                comments(first: 1) { nodes { databaseId } }
              }
            }
          }
        }
      }`,
      { owner, repo, number: prNumber, after },
    );
    const threads = page.repository.pullRequest.reviewThreads;
    for (const thread of threads.nodes) {
      const rootId = thread.comments.nodes[0]?.databaseId;
      if (rootId != null) {
        index.set(rootId, {
          nodeId: thread.id,
          resolved: thread.isResolved === true,
        });
      }
    }
    if (!threads.pageInfo.hasNextPage) return index;
    after = threads.pageInfo.endCursor;
  }
}
