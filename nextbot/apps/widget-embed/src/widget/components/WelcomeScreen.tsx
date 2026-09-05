import type { FormEvent } from "react";
import { Input } from "@nextbot/ui/components/ui/input";
import { Button } from "@nextbot/ui/components/ui/button";
import { useWidgetStore } from "../store.js";
import type { WidgetEmbedConfig } from "../types.js";

/** A.1.3 — Welcome/Home Screen. Shown when the widget opens with no active
 * conversation. Service-menu cards come from the embed config's `quickActions[]`
 * (screen inventory's own field, reused here rather than inventing a parallel
 * "menu cards" config surface — the agent extracts full parameters regardless of
 * which card/chip pre-filled the request, per FR-AI-01). */
export function WelcomeScreen({ config }: { config: WidgetEmbedConfig | null }) {
  const send = useWidgetStore((s) => s.send);

  function handleCard(request: string) {
    void send("Text", { contentType: "Text", text: request });
  }

  function handleFreeText(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const input = (e.target as HTMLFormElement).elements.namedItem("query") as HTMLInputElement;
    const value = input.value.trim();
    if (!value) return;
    void send("Text", { contentType: "Text", text: value });
    input.value = "";
  }

  const quickActions = config?.quickActions ?? [];

  return (
    <div className="flex-1 overflow-y-auto p-4">
      <h2 className="mb-4 text-sm font-semibold font-heading">Welcome 👋</h2>
      {quickActions.length > 0 && (
        <div className="mb-4 grid grid-cols-2 gap-2">
          {quickActions.map((action) => (
            <Button key={action.label} type="button" size="sm" variant="outline" onClick={() => handleCard(action.request)}>
              {action.label}
            </Button>
          ))}
        </div>
      )}
      <form onSubmit={handleFreeText}>
        <Input name="query" placeholder="Ask me anything…" aria-label="Ask me anything" />
      </form>
      {/* D10 (QA fix pass, carried forward): text-gray-600 clears WCAG AA contrast
          at this font size on a white background. */}
      <p className="mt-2 text-xs text-gray-600">Type a message below or pick a shortcut above to get started.</p>
    </div>
  );
}
