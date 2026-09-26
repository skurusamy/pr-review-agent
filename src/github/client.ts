import { Octokit } from "octokit";

export function createOctokit(token = process.env.GITHUB_TOKEN): Octokit {
  if (!token) {
    throw new Error("GITHUB_TOKEN is not set");
  }
  return new Octokit({ auth: token });
}
