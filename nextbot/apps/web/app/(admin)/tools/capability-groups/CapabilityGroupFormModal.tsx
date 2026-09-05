"use client";

import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogBody, DialogFooter } from "@nextbot/ui/components/ui/dialog";
import { Button } from "@nextbot/ui/components/ui/button";
import { Input } from "@nextbot/ui/components/ui/input";
import { Label } from "@nextbot/ui/components/ui/label";
import { Textarea } from "@nextbot/ui/components/ui/textarea";
import { FieldHint } from "@nextbot/ui/components/ui/field-hint";
import { toast } from "@nextbot/ui/lib/toast";

export interface CapabilityGroupFormValue {
  name: string;
  guidanceText: string;
  priorityWeight: number;
}

/**
 * Create/edit dialog for a `capability_group` row (Phase 6, BL-28, FR-MCP-17) — the
 * management screen the Design Studio's tool-policy picker and `tool.capability_
 * group_id` have referenced since Phase 10, but which had no authoring UI of its own
 * until this phase (previously creatable only via direct seed/DB access).
 */
export function CapabilityGroupFormModal({
  isOpen,
  onClose,
  initial,
  onSubmit,
  title,
}: {
  isOpen: boolean;
  onClose: () => void;
  initial?: CapabilityGroupFormValue;
  onSubmit: (value: CapabilityGroupFormValue) => Promise<{ ok: true } | { ok: false; message: string }>;
  title: string;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [guidanceText, setGuidanceText] = useState(initial?.guidanceText ?? "");
  const [priorityWeight, setPriorityWeight] = useState(initial?.priorityWeight ?? 50);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Same re-seed-on-open convention as `RoleFormModal` — a `useState` initializer
  // alone would freeze the first render's `initial` and never pick up a later Edit
  // click on a *different* group.
  useEffect(() => {
    if (isOpen) {
      setName(initial?.name ?? "");
      setGuidanceText(initial?.guidanceText ?? "");
      setPriorityWeight(initial?.priorityWeight ?? 50);
      setError(null);
    }
  }, [isOpen, initial]);

  async function handleSubmit() {
    setSubmitting(true);
    setError(null);
    const result = await onSubmit({ name: name.trim(), guidanceText: guidanceText.trim(), priorityWeight });
    setSubmitting(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    toast.success("Capability group saved.");
    onClose();
  }

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <DialogBody className="flex flex-col gap-4">
          <div>
            <div className="mb-1 flex items-center gap-1">
              <Label htmlFor="capability-group-name" className="font-bold">
                Name
              </Label>
              <FieldHint
                id="capability-group-name-hint"
                content="The name shown in the Design Studio's tool-policy picker and this screen's own table — must be unique per tenant."
              />
            </div>
            <Input id="capability-group-name" value={name} onChange={(e) => setName(e.target.value)} required />
          </div>
          <div>
            <div className="mb-1 flex items-center gap-1">
              <Label htmlFor="capability-group-guidance" className="font-bold">
                Guidance text
              </Label>
              <FieldHint
                id="capability-group-guidance-hint"
                content="Optional free text shown alongside this group wherever it's picked — a short description of what kind of tools belong here and when an agent should reach for them."
              />
            </div>
            <Textarea id="capability-group-guidance" value={guidanceText} onChange={(e) => setGuidanceText(e.target.value)} />
          </div>
          <div>
            <div className="mb-1 flex items-center gap-1">
              <Label htmlFor="capability-group-priority" className="font-bold">
                Priority weight
              </Label>
              <FieldHint
                id="capability-group-priority-hint"
                content="1–100. Used as the deterministic tiebreak when an agent's tool-selection reasoning is otherwise ambiguous between tools in different groups — higher wins."
              />
            </div>
            <Input
              id="capability-group-priority"
              type="number"
              min={1}
              max={100}
              value={priorityWeight}
              onChange={(e) => setPriorityWeight(Number(e.target.value))}
            />
          </div>
          {error && <p className="text-xs text-destructive">{error}</p>}
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => void handleSubmit()} disabled={submitting || !name.trim()}>
            {submitting ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
