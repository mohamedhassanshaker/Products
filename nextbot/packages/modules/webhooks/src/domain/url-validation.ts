/**
 * Server-side validation of a tenant-supplied webhook target URL (security review
 * requirement, dev-agent brief §5: "every input is validated server-side"). Rejects
 * anything that is not a well-formed `https://` URL — never used to construct a raw
 * query/command, only ever passed as the `url` argument to `fetch()`, so this check's
 * only job is "reject garbage before it reaches a delivery attempt," not defend
 * against injection (there is none to defend against here).
 *
 * Deliberately requires `https:` (never `http:`) — a webhook payload includes a
 * masked-but-real `domain_event.payload`, and this codebase does not offer a
 * plaintext-transport option for any other credential-bearing traffic either.
 */
export function isWellFormedHttpsUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:";
  } catch {
    return false;
  }
}
