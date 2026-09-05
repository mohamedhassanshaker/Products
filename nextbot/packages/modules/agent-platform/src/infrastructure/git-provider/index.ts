import type { GitProviderValue } from "@nextbot/contracts";
import type { GitProviderClient } from "./types.js";
import { createGitHubClient } from "./github-client.js";
import { createGitLabClient } from "./gitlab-client.js";

export function getGitProviderClient(provider: GitProviderValue, opts: { token: string; baseUrl?: string }): GitProviderClient {
  return provider === "GitHub" ? createGitHubClient(opts) : createGitLabClient(opts);
}

export type { GitProviderClient } from "./types.js";
export { GitProviderTransportError } from "./types.js";
