import { HugeiconsIcon } from "@hugeicons/react";
import { Alert02Icon } from "@hugeicons/core-free-icons";
import type { ErrorPayload } from "@nextbot/contracts";
import { QuickReplyBubble } from "./QuickReplyBubble.js";

/**
 * A.2.15 / FR-AI-05 — Error/Fallback Message. Three fixed, verbatim copy strings —
 * rendered with an amber/warning accent (not red/error), per `docs/design/
 * UX_GUIDELINES.md` §5.3.5: "a recoverable, conversational fallback... should read
 * as 'a hiccup, still talking to you,' not 'the system is broken.'"
 */
export function ErrorBubble({ payload }: { payload: ErrorPayload }) {
  return (
    <div className="my-2 rounded-none border-s-4 border-s-amber-400 bg-amber-50 p-3">
      <div className="flex items-start gap-2">
        <HugeiconsIcon icon={Alert02Icon} size={16} strokeWidth={2} aria-label="Warning" className="mt-0.5 shrink-0 text-amber-700" />
        <p className="text-sm">{payload.text}</p>
      </div>
      {payload.chips && payload.chips.length > 0 && <QuickReplyBubble payload={{ contentType: "QuickReply", chips: payload.chips }} />}
    </div>
  );
}
