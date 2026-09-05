import { randomBytes, createHmac, timingSafeEqual } from "node:crypto";
import type { TenantContext } from "@nextbot/db";
import { KmsEnvelopeSecretsProvider } from "@nextbot/secrets";
import type { ConnectGitRequest, GitDiffResult, GitProviderValue } from "@nextbot/contracts";
import { GitConnectionUnavailableError, GitConnectionNotFoundError } from "@nextbot/contracts";
import { getGitProviderClient, GitProviderTransportError, type GitProviderClient } from "../infrastructure/git-provider/index.js";
import { upsertGitConnection, getGitConnection, setGitConnectionStatus, deleteGitConnection, type GitConnectionRow } from "../infrastructure/git-connection-repository.js";
import { insertCredential, getCredentialForDecrypt } from "../infrastructure/credential-repository.js";
import { setVersionGitPrInfo, listOpenGitPrVersions, updateVersionGitPrStatus } from "../infrastructure/agent-definition-repository.js";
import { promoteAgentVersion } from "./promote-version-service.js";
import { listActiveTenantContexts } from "@nextbot/tenancy";

let secretsProvider: KmsEnvelopeSecretsProvider | undefined;
function getSecretsProvider(): KmsEnvelopeSecretsProvider {
  if (!secretsProvider) secretsProvider = new KmsEnvelopeSecretsProvider();
  return secretsProvider;
}

export interface GitConnectionView {
  provider: GitProviderValue;
  baseUrl: string | null;
  repoOwner: string;
  repoName: string;
  defaultBranch: string;
  status: GitConnectionRow["status"];
  lastCheckedAt: Date | null;
}

function toView(row: GitConnectionRow): GitConnectionView {
  return { provider: row.provider, baseUrl: row.baseUrl, repoOwner: row.repoOwner, repoName: row.repoName, defaultBranch: row.defaultBranch, status: row.status, lastCheckedAt: row.lastCheckedAt };
}

/**
 * ADR-0009's connect flow, step 2: the browser already completed the OAuth
 * redirect/token exchange (see `infrastructure/git-oauth.ts`) and the tenant admin has
 * picked a repo from the list the token can see; this persists the connection —
 * vaulting the access token (and a freshly generated webhook HMAC secret) exactly the
 * way every other credential in this codebase is vaulted (ADR-0007 envelope
 * encryption), never a bespoke storage path.
 */
export async function connectGit(ctx: TenantContext, input: ConnectGitRequest & { createdByUserId: string }): Promise<GitConnectionView> {
  const tokenPlaintext = input.refreshToken ? JSON.stringify({ accessToken: input.accessToken, refreshToken: input.refreshToken }) : input.accessToken;
  const tokenCredentialId = crypto.randomUUID();
  const encryptedToken = await getSecretsProvider().put(tokenPlaintext, { tenantId: ctx.tenantId, kind: "git-oauth-token", id: tokenCredentialId });
  await insertCredential(ctx, {
    id: tokenCredentialId,
    label: `${input.provider} OAuth token (${input.repoOwner}/${input.repoName})`,
    type: "GitOAuthToken",
    vaultRef: encryptedToken.vaultRef,
    ciphertext: encryptedToken.ciphertext,
    dekRef: encryptedToken.dekRef,
    maskedHint: encryptedToken.maskedHint,
  });

  const webhookSecretPlaintext = randomBytes(32).toString("hex");
  const webhookCredentialId = crypto.randomUUID();
  const encryptedWebhookSecret = await getSecretsProvider().put(webhookSecretPlaintext, { tenantId: ctx.tenantId, kind: "git-webhook-secret", id: webhookCredentialId });
  await insertCredential(ctx, {
    id: webhookCredentialId,
    label: `${input.provider} webhook secret (${input.repoOwner}/${input.repoName})`,
    type: "WebhookSecret",
    vaultRef: encryptedWebhookSecret.vaultRef,
    ciphertext: encryptedWebhookSecret.ciphertext,
    dekRef: encryptedWebhookSecret.dekRef,
    maskedHint: encryptedWebhookSecret.maskedHint,
  });

  const row = await upsertGitConnection(ctx, {
    provider: input.provider,
    baseUrl: input.baseUrl,
    repoOwner: input.repoOwner,
    repoName: input.repoName,
    credentialId: tokenCredentialId,
    webhookSecretCredentialId: webhookCredentialId,
    createdByUserId: input.createdByUserId,
  });
  return toView(row);
}

export async function disconnectGit(ctx: TenantContext): Promise<void> {
  await deleteGitConnection(ctx);
}

export async function getGitConnectionView(ctx: TenantContext): Promise<GitConnectionView | null> {
  const row = await getGitConnection(ctx);
  return row ? toView(row) : null;
}

async function decryptCredential(ctx: TenantContext, credentialId: string, kind: string): Promise<string> {
  const encrypted = await getCredentialForDecrypt(ctx, credentialId);
  if (!encrypted) throw new Error(`Credential '${credentialId}' not found for decryption.`);
  return getSecretsProvider().get(encrypted.ciphertext, encrypted.dekRef, { tenantId: ctx.tenantId, kind, id: credentialId });
}

/**
 * Resolves the tenant's connection + a real, authenticated `GitProviderClient` —
 * performing the health check LLD §3.10a requires "before every write/diff/PR call".
 * @throws {GitConnectionNotFoundError} no connection configured yet.
 * @throws {GitConnectionUnavailableError} the connection exists but is unreachable —
 * new version/diff/PR actions are blocked; already-deployed versions are unaffected
 * (this function is never on that read path).
 */
async function getHealthyClient(ctx: TenantContext): Promise<{ connection: GitConnectionRow; client: GitProviderClient }> {
  const connection = await getGitConnection(ctx);
  if (!connection) throw new GitConnectionNotFoundError();

  const tokenPlaintext = await decryptCredential(ctx, connection.credentialId, "git-oauth-token");
  const accessToken = tokenPlaintext.startsWith("{") ? (JSON.parse(tokenPlaintext) as { accessToken: string }).accessToken : tokenPlaintext;
  const client = getGitProviderClient(connection.provider, { token: accessToken, baseUrl: connection.baseUrl ?? undefined });

  try {
    await client.listRepos();
  } catch (err) {
    if (err instanceof GitProviderTransportError) {
      await setGitConnectionStatus(ctx, "Unreachable");
      throw new GitConnectionUnavailableError();
    }
    throw err;
  }
  await setGitConnectionStatus(ctx, "Connected");
  return { connection, client };
}

/**
 * BE1 fix (QA 2026-08-15 backend pass, BLOCKING): each agent-definition version gets
 * its own branch off the tenant's `defaultBranch`, named deterministically so
 * `openAgentDefinitionReview` can recompute it later without needing to persist a
 * separate `git_branch` column. Real GitHub/GitLab reject a PR/MR whose `head` and
 * `base` are the same ref (422 "No commits between main and main" / 409) — committing
 * every version straight onto `defaultBranch` and then opening `head===base===
 * defaultBranch` silently defeated ADR-0009's entire governed-review premise; this was
 * only ever masked in tests because the mock Git server used to return 201
 * unconditionally regardless of head/base (now fixed in `github-mock-server.ts` to
 * enforce the real semantics).
 */
export function versionBranchName(agentDefinitionId: string, version: string): string {
  return `agents/${agentDefinitionId}/${version}`;
}

export async function commitAgentDefinitionVersion(ctx: TenantContext, input: { agentDefinitionId: string; version: string; yamlContent: string }): Promise<{ commitSha: string }> {
  const { connection, client } = await getHealthyClient(ctx);
  const branch = versionBranchName(input.agentDefinitionId, input.version);
  await client.ensureBranch({ owner: connection.repoOwner, repo: connection.repoName, branch, fromBranch: connection.defaultBranch });
  const path = `agents/${input.agentDefinitionId}/${input.version}.yaml`;
  return client.commitFile({
    owner: connection.repoOwner,
    repo: connection.repoName,
    path,
    content: input.yamlContent,
    message: `agent-definition: ${input.agentDefinitionId} v${input.version}`,
    branch,
  });
}

export async function diffAgentDefinitionVersions(ctx: TenantContext, input: { baseSha: string; headSha: string }): Promise<GitDiffResult> {
  const { connection, client } = await getHealthyClient(ctx);
  return client.compare({ owner: connection.repoOwner, repo: connection.repoName, base: input.baseSha, head: input.headSha });
}

export async function openAgentDefinitionReview(ctx: TenantContext, input: { agentDefinitionId: string; version: string; commitSha: string }): Promise<{ number: number }> {
  const { connection, client } = await getHealthyClient(ctx);
  return client.openPullRequest({
    owner: connection.repoOwner,
    repo: connection.repoName,
    title: `Agent definition ${input.agentDefinitionId} v${input.version}`,
    body: `Review for agent definition version at commit ${input.commitSha}.`,
    head: versionBranchName(input.agentDefinitionId, input.version),
    base: connection.defaultBranch,
  });
}

/** Inbound webhook receiver (ADR-0009: "webhook-primary... HMAC-verified"). Never
 * trusts the payload before verifying `x-hub-signature-256` (GitHub) /
 * `X-Gitlab-Token` (GitLab) against the vaulted webhook secret. On a merge event,
 * updates `git_pr_status` and attempts to auto-advance the promotion state machine
 * (webhook actor = `null`, per `promotion-policy.ts`'s doc comment on why that path
 * never needs to independently re-derive "reviewer != author" — the tenant's own Git
 * provider's PR/MR review UI already provided that guarantee before the merge
 * happened).
 */
export async function handleGitWebhook(
  ctx: TenantContext,
  input: { provider: "GitHub" | "GitLab"; rawBody: string; signatureHeader: string | null; prNumber: number; eventStatus: "Merged" | "Closed" | "Open" },
): Promise<void> {
  const connection = await getGitConnection(ctx);
  if (!connection?.webhookSecretCredentialId) throw new GitConnectionNotFoundError();
  const secret = await decryptCredential(ctx, connection.webhookSecretCredentialId, "git-webhook-secret");

  const verified = input.provider === "GitHub" ? verifyHmacSignature(input.rawBody, input.signatureHeader, secret) : verifySharedTokenSignature(input.signatureHeader, secret);
  if (!verified) {
    throw new Error("Webhook signature verification failed.");
  }

  const updated = await updateVersionGitPrStatus(ctx, input.prNumber, input.eventStatus);
  if (updated && input.eventStatus === "Merged" && updated.status === "HumanReview") {
    await promoteAgentVersion(ctx, updated.id, "Approved", null);
  }
}

/** The real HMAC-SHA256 construction (`crypto.createHmac`, keyed on `secret`) every
 *  webhook-style signature scheme in this codebase is built on — hex-encoded, unprefixed.
 *  Exported as a shared primitive so a second webhook signature scheme elsewhere in this
 *  codebase (`@nextbot/workflows`' own trigger signature, `X-NextBot-Signature`) reuses
 *  the SAME real HMAC rather than a second, independently-written implementation that
 *  could drift from this one — critically, this is a true HMAC (resistant to
 *  length-extension forgery), never a naive `createHash(secret + "." + body)`, which is
 *  NOT an HMAC and is forgeable via length extension. */
export function computeHmacSha256Hex(secret: string, rawBody: string): string {
  return createHmac("sha256", secret).update(rawBody, "utf8").digest("hex");
}

/** GitHub signs webhook payloads with a computed HMAC-SHA256 (`x-hub-signature-256:
 * sha256=<hex>`). */
export function verifyHmacSignature(rawBody: string, signatureHeader: string | null, secret: string): boolean {
  if (!signatureHeader) return false;
  const expected = `sha256=${computeHmacSha256Hex(secret, rawBody)}`;
  return constantTimeEquals(expected, signatureHeader);
}

/** GitLab's webhook scheme is a plain shared-secret token in `X-Gitlab-Token` (no
 * computed HMAC) — compared directly against the vaulted secret, still constant-time. */
export function verifySharedTokenSignature(tokenHeader: string | null, secret: string): boolean {
  if (!tokenHeader) return false;
  return constantTimeEquals(secret, tokenHeader);
}

/** Constant-time string comparison (`crypto.timingSafeEqual`, after an early length
 *  check — the length check itself leaks only the length of `actual`, which the caller
 *  already knows, and is required because `timingSafeEqual` throws on a length
 *  mismatch rather than returning `false`). Exported alongside `computeHmacSha256Hex` so
 *  a signature verifier elsewhere never re-implements this comparison as a plain `===`,
 *  which would reintroduce a timing side-channel. */
export function constantTimeEquals(expected: string, actual: string): boolean {
  const expectedBuf = Buffer.from(expected);
  const actualBuf = Buffer.from(actual);
  if (expectedBuf.length !== actualBuf.length) return false;
  return timingSafeEqual(expectedBuf, actualBuf);
}

/** ADR-0009's 15-minute polling reconciliation fallback for one tenant — real logic,
 * genuinely tested; the recurring-scheduler wiring itself (an actual cron/BullMQ
 * repeatable job invoking this on a timer) is deferred to Phase 18, the phase that
 * stands up `apps/worker`'s job-scheduling infrastructure for real (see
 * `apps/worker`'s `agent-platform-git-sweep.ts` stub entrypoint for the intended call
 * site, flagged rather than silently left unimplemented). */
export async function reconcileOpenPrsForTenant(ctx: TenantContext): Promise<{ checked: number; updated: number }> {
  const openVersions = await listOpenGitPrVersions(ctx);
  if (openVersions.length === 0) return { checked: 0, updated: 0 };

  let client: GitProviderClient;
  let connection: GitConnectionRow;
  try {
    ({ connection, client } = await getHealthyClient(ctx));
  } catch {
    return { checked: openVersions.length, updated: 0 };
  }

  let updated = 0;
  for (const version of openVersions) {
    if (version.gitPrNumber === null) continue;
    const status = await client.getPullRequestStatus({ owner: connection.repoOwner, repo: connection.repoName, number: version.gitPrNumber });
    if (status !== version.gitPrStatus) {
      await handleGitWebhookReconciliation(ctx, version.gitPrNumber, status);
      updated += 1;
    }
  }
  return { checked: openVersions.length, updated };
}

async function handleGitWebhookReconciliation(ctx: TenantContext, prNumber: number, status: "Open" | "Merged" | "Closed"): Promise<void> {
  const updated = await updateVersionGitPrStatus(ctx, prNumber, status);
  if (updated && status === "Merged" && updated.status === "HumanReview") {
    await promoteAgentVersion(ctx, updated.id, "Approved", null);
  }
}

/** Iterates every active tenant (via `@nextbot/tenancy`'s enumeration seam, never
 * `withPlatform` directly from this module) and reconciles each one's open PRs/MRs.
 * The callable, tested unit `apps/worker`'s eventual scheduled job invokes. */
export async function reconcileOpenPrsAcrossAllTenants(): Promise<{ tenantsChecked: number }> {
  const tenants = await listActiveTenantContexts();
  for (const tenantCtx of tenants) {
    await reconcileOpenPrsForTenant(tenantCtx);
  }
  return { tenantsChecked: tenants.length };
}

export { setVersionGitPrInfo };

/** Test-only: decrypts the tenant's own webhook secret so an integration test can
 * compute a genuinely valid HMAC signature for `handleGitWebhook`'s repro, without
 * this codebase's real code paths ever exposing plaintext secrets anywhere else. Not
 * re-exported from the module's public `index.ts`. */
export async function debugDecryptWebhookSecretForTests(ctx: TenantContext): Promise<string> {
  const connection = await getGitConnection(ctx);
  if (!connection?.webhookSecretCredentialId) throw new GitConnectionNotFoundError();
  return decryptCredential(ctx, connection.webhookSecretCredentialId, "git-webhook-secret");
}
