"use client";

/**
 * One colour token's editing control — design-system.md §5.5 #55's own words: "The
 * only screen permitted to write raw colour values, and it does so into token slots
 * via a validated form — not into class names."
 *
 * A native `<input type="color">` swatch (no design-system colour-picker atom exists
 * to reuse — this compound control genuinely is SkinEditor-specific work, not a
 * reason to hand-roll something a real atom already covers) paired with the real
 * `Input` atom in its `mono` variant for the hex text — `mono` is the established
 * pattern for "this value is LTR-only regardless of the ambient page direction"
 * (§11.3), and a hex colour code is exactly that class of value, the same as an
 * endpoint URL or a transaction id.
 *
 * The typed text field accepts free typing (so a value mid-edit, e.g. `#1F6`, is not
 * fought), but only calls `onChange` — which drives BOTH the candidate state and the
 * live preview — once the draft is a genuine 6-digit hex colour. An in-progress,
 * invalid draft never reaches `applyCandidate` or the save payload; it only ever
 * shows as a local, visibly invalid field via `aria-invalid` until it resolves.
 */

import * as React from "react";
import { isHexColor } from "@shj3/tokens";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";

export interface ColorFieldProps {
  readonly id: string;
  readonly label: string;
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly help?: string;
  readonly invalidMessage: string;
}

export const ColorField = React.forwardRef<HTMLDivElement, ColorFieldProps>(function ColorField(
  { id, label, value, onChange, help, invalidMessage },
  ref,
) {
  const [draft, setDraft] = React.useState(value);
  // Re-syncs when the candidate's value changes for a reason OTHER than this field's
  // own typing — discard()/markSaved()/replaceMode() (an import, "Match brand") all
  // change `value` from outside, and the draft must follow rather than keep showing
  // stale text the candidate has already moved on from.
  React.useEffect(() => {
    setDraft(value);
  }, [value]);

  const valid = isHexColor(draft);

  return (
    <div ref={ref} className="flex flex-col gap-1">
      <FormField
        label={label}
        help={valid ? help : undefined}
        error={valid ? undefined : invalidMessage}
        id={id}
      >
        {(field) => (
          <div className="flex items-center gap-2">
            <input
              type="color"
              aria-label={label}
              value={valid ? draft : "#000000"}
              onChange={(event) => {
                setDraft(event.target.value);
                onChange(event.target.value);
              }}
              className="h-[var(--control-height-sm)] w-[var(--control-height-sm)] shrink-0 cursor-pointer rounded-[var(--radius-sm)] border border-border-strong bg-transparent p-0"
            />
            <Input
              {...field}
              variant="mono"
              value={draft}
              onChange={(event) => {
                const next = event.target.value;
                setDraft(next);
                if (isHexColor(next)) onChange(next);
              }}
            />
          </div>
        )}
      </FormField>
    </div>
  );
});
