import { useState } from "react";
import { Button } from "@nextbot/ui/components/ui/button";
import type { QuickReplyPayload } from "@nextbot/contracts";
import { useWidgetStore } from "../../store.js";

/** A.2.2 — Quick Reply Chips. Single-use: tapping a chip sends it and disables the
 * whole row, with the tapped chip kept visually distinct (`docs/design/
 * UX_GUIDELINES.md` §5.3.2) — this component keeps its own local "selected" state
 * for that reason (once sent, the source message's payload itself is immutable). */
export function QuickReplyBubble({ payload, disabled }: { payload: QuickReplyPayload; disabled?: boolean }) {
  const send = useWidgetStore((s) => s.send);
  const [selectedId, setSelectedId] = useState<string | null>(payload.selectedChipId ?? null);
  const isAnswered = disabled || selectedId !== null;

  function handleTap(chipId: string) {
    if (isAnswered) return;
    setSelectedId(chipId);
    void send("QuickReply", { ...payload, selectedChipId: chipId });
  }

  return (
    <div className="my-2">
      {payload.text && <p className="mb-2 text-sm">{payload.text}</p>}
      <div role="group" aria-label="Quick reply options" className="flex gap-2 overflow-x-auto">
        {payload.chips.map((chip) => (
          <Button
            key={chip.id}
            type="button"
            size="sm"
            variant={chip.id === selectedId ? "default" : "outline"}
            disabled={isAnswered}
            tabIndex={isAnswered && chip.id !== selectedId ? -1 : undefined}
            onClick={() => handleTap(chip.id)}
          >
            {chip.label}
          </Button>
        ))}
      </div>
    </div>
  );
}
