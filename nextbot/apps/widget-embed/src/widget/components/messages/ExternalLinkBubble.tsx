import type { ExternalLinkPayload } from "@nextbot/contracts";

/** Phase 12 (BL-05) — External Link Card: a plain outbound link with optional
 * preview text (e.g. a knowledge-base article, a status page). */
export function ExternalLinkBubble({ payload }: { payload: ExternalLinkPayload }) {
  return (
    <div className="my-2 rounded-none border p-3">
      <a
        href={payload.url}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1 text-sm font-medium text-primary underline underline-offset-2"
      >
        {payload.title} ↗
      </a>
      {payload.description && <p className="mt-1 text-xs text-gray-500">{payload.description}</p>}
    </div>
  );
}
