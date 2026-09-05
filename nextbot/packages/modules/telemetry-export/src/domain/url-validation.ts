/**
 * Server-side validation of a tenant-supplied OTel/SIEM export endpoint URL (security
 * review requirement: "every input is validated server-side"). Identical logic to
 * `@nextbot/webhooks`'s own `isWellFormedHttpsUrl` — duplicated here rather than
 * imported, the same disclosed-duplication precedent this codebase already applies
 * to `credential-repository.ts` across multiple modules, since a module-to-module
 * edge for one trivial, pure, unlikely-to-drift predicate would be disproportionate.
 */
export function isWellFormedHttpsUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:";
  } catch {
    return false;
  }
}
