import type { WidgetMessage } from "../../types.js";
import { TextBubble } from "./TextBubble.js";
import { QuickReplyBubble } from "./QuickReplyBubble.js";
import { ListBubble } from "./ListBubble.js";
import { FormBubble } from "./FormBubble.js";
import { ErrorBubble } from "./ErrorBubble.js";
import { DataSummaryBubble } from "./DataSummaryBubble.js";
import { DataTableBubble } from "./DataTableBubble.js";
import { DocumentBubble } from "./DocumentBubble.js";
import { ExternalLinkBubble } from "./ExternalLinkBubble.js";
import { ConfirmationBubble } from "./ConfirmationBubble.js";

function renderMessage(message: WidgetMessage, isLatest: boolean) {
  switch (message.payload.contentType) {
    case "QuickReply":
      return <QuickReplyBubble key={message.id} payload={message.payload} disabled={!isLatest} />;
    case "List":
      return <ListBubble key={message.id} payload={message.payload} disabled={!isLatest} />;
    case "Form":
      return <FormBubble key={message.id} payload={message.payload} disabled={!isLatest} />;
    case "Error":
      return <ErrorBubble key={message.id} payload={message.payload} />;
    case "DataSummary":
      return <DataSummaryBubble key={message.id} payload={message.payload} />;
    case "DataTable":
      return <DataTableBubble key={message.id} payload={message.payload} />;
    case "Document":
      return <DocumentBubble key={message.id} payload={message.payload} />;
    case "ExternalLink":
      return <ExternalLinkBubble key={message.id} payload={message.payload} />;
    case "Confirmation":
      return <ConfirmationBubble key={message.id} payload={message.payload} />;
    case "Text":
    default:
      return <TextBubble key={message.id} message={message} />;
  }
}

/**
 * A.2.x conversation area (`docs/design/UX_GUIDELINES.md` §5.3's shared baseline:
 * every appended message enters an `aria-live="polite"` region once, not per
 * streaming token/animation frame).
 */
export function MessageList({ messages, aiTyping }: { messages: WidgetMessage[]; aiTyping: boolean }) {
  const lastInteractiveIndex = messages
    .map((m, i) => ({ m, i }))
    .filter(({ m }) => m.payload.contentType === "QuickReply" || m.payload.contentType === "List" || m.payload.contentType === "Form")
    .map(({ i }) => i)
    .at(-1);

  return (
    <div className="flex-1 overflow-y-auto px-3 py-2" aria-live="polite" aria-relevant="additions">
      {messages.map((message, index) => renderMessage(message, index === lastInteractiveIndex))}
      {aiTyping && (
        <div aria-label="NextBot is typing" className="my-1 flex items-center gap-2">
          <span className="text-xs text-gray-500">NextBot is typing…</span>
        </div>
      )}
    </div>
  );
}
