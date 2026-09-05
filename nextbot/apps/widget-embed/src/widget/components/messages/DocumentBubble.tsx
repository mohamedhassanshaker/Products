import { HugeiconsIcon } from "@hugeicons/react";
import { File01Icon } from "@hugeicons/core-free-icons";
import type { DocumentPayload } from "@nextbot/contracts";

function formatSize(bytes?: number): string | undefined {
  if (bytes === undefined) return undefined;
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Phase 12 (BL-05) — Document Card: a link to a generated/fetched document
 * (invoice, report). Opens in a new tab with `rel="noopener noreferrer"`. */
export function DocumentBubble({ payload }: { payload: DocumentPayload }) {
  const size = formatSize(payload.sizeBytes);
  return (
    <div className="my-2 rounded-none border p-3">
      <div className="flex items-start gap-2">
        <HugeiconsIcon icon={File01Icon} size={20} strokeWidth={2} aria-label="Document" />
        <div>
          <a href={payload.url} target="_blank" rel="noopener noreferrer" className="text-sm font-medium text-primary underline underline-offset-2">
            {payload.title}
          </a>
          {(payload.mimeType || size) && <p className="text-xs text-gray-500">{[payload.mimeType, size].filter(Boolean).join(" · ")}</p>}
        </div>
      </div>
    </div>
  );
}
