import { useState, type SelectHTMLAttributes } from "react";
import { Input } from "@nextbot/ui/components/ui/input";
import { Textarea } from "@nextbot/ui/components/ui/textarea";
import { Label } from "@nextbot/ui/components/ui/label";
import { Button } from "@nextbot/ui/components/ui/button";
import { Alert, AlertDescription } from "@nextbot/ui/components/ui/alert";
import { cn } from "@nextbot/ui/lib/utils";
import type { FormPayload } from "@nextbot/contracts";
import { useWidgetStore } from "../../store.js";

type SubmitState = "idle" | "submitting" | "submitted" | "error";

/**
 * Plain, Tailwind-styled `<select>` for this card's "select" field type —
 * deliberately **not** `packages/ui`'s Base UI `Select` primitive (documented
 * deviation, per this dispatch's scope): a native `<select>` already satisfies
 * label association (a `<label htmlFor>` needs no `items` map/label-resolution
 * fix at all — that fix exists specifically because Base UI's headless `Select`
 * has no underlying native element to derive a label from) and keeps this
 * compact, single-file form card's fields uniformly `fireEvent.change`-testable
 * without pulling in a popup-based interaction pattern this simple card doesn't
 * need. Styled to match this package's other reused input/textarea primitives
 * (border-input, h-8, rounded-none, the strengthened 2px focus ring).
 */
function FieldSelect({ className, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={cn(
        "h-8 w-full min-w-0 rounded-none border border-input bg-transparent px-2.5 py-1 text-xs outline-none transition-colors focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    />
  );
}

/** A.2.8 — Form Collection Card (multi-field). File-upload fields are deliberately
 * not rendered — deferred alongside the standalone File Upload Bubble (A.2.14),
 * per `docs/design/UX_GUIDELINES.md` §5.3.4's flagged open question, resolved here
 * as "defer" since no attachment-upload endpoint exists yet this phase. */
export function FormBubble({ payload, disabled }: { payload: FormPayload; disabled?: boolean }) {
  const send = useWidgetStore((s) => s.send);
  const [values, setValues] = useState<Record<string, string>>(payload.values ?? {});
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [submitState, setSubmitState] = useState<SubmitState>(payload.values ? "submitted" : "idle");

  const renderableFields = payload.fields.filter((f) => f.type !== "file");

  function fieldError(fieldName: string): string | null {
    const field = renderableFields.find((f) => f.name === fieldName);
    if (!field || !touched[fieldName]) return null;
    const value = values[fieldName] ?? "";
    if (field.required && !value) return `${field.label} is required.`;
    if (field.pattern && value && !new RegExp(field.pattern).test(value)) {
      return `That doesn't look like a valid ${field.label.toLowerCase()} — could you share it again?`;
    }
    if (field.type === "email" && value && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
      return "That doesn't look like a valid email — could you share it again?";
    }
    return null;
  }

  const hasErrors = renderableFields.some((f) => fieldError(f.name) !== null);
  const missingRequired = renderableFields.some((f) => f.required && !values[f.name]);
  const canSubmit = !hasErrors && !missingRequired;

  async function handleSubmit() {
    setSubmitState("submitting");
    try {
      await send("Form", { ...payload, values });
      setSubmitState("submitted");
    } catch {
      setSubmitState("error");
    }
  }

  if (submitState === "submitted" || disabled) {
    return (
      <div className="my-2 rounded-none border p-3 text-sm">
        <p className="font-bold">✓ Submitted</p>
        {Object.entries(values).map(([k, v]) => (
          <p key={k} className="text-gray-600">
            {k}: {v}
          </p>
        ))}
      </div>
    );
  }

  const isSubmitting = submitState === "submitting";

  return (
    <div className="my-2 rounded-none border p-3">
      {payload.title && <p className="mb-2 text-sm font-bold">{payload.title}</p>}
      {submitState === "error" && (
        <Alert variant="warning" className="mb-3">
          <AlertDescription>
            Something went wrong while processing your request. I&apos;ve logged this — would you like to try again or speak with an agent?
          </AlertDescription>
        </Alert>
      )}
      {renderableFields.map((field) => {
        const error = fieldError(field.name);
        const fieldId = `nextbot-form-field-${field.name}`;
        return (
          <div key={field.name} className="mb-3">
            <Label htmlFor={fieldId} className="mb-1 text-sm">
              {field.label}
              {field.required ? " *" : ""}
            </Label>
            {field.type === "select" ? (
              <FieldSelect
                id={fieldId}
                aria-invalid={!!error}
                disabled={isSubmitting}
                value={values[field.name] ?? ""}
                onChange={(e) => setValues((v) => ({ ...v, [field.name]: e.target.value }))}
                onBlur={() => setTouched((t) => ({ ...t, [field.name]: true }))}
              >
                <option value="" disabled>
                  Select…
                </option>
                {(field.options ?? []).map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </FieldSelect>
            ) : field.type === "textarea" ? (
              <Textarea
                id={fieldId}
                aria-invalid={!!error}
                disabled={isSubmitting}
                value={values[field.name] ?? ""}
                onChange={(e) => setValues((v) => ({ ...v, [field.name]: e.target.value }))}
                onBlur={() => setTouched((t) => ({ ...t, [field.name]: true }))}
              />
            ) : (
              <Input
                id={fieldId}
                type={field.type === "email" ? "email" : field.type === "phone" ? "tel" : "text"}
                aria-invalid={!!error}
                disabled={isSubmitting}
                value={values[field.name] ?? ""}
                onChange={(e) => setValues((v) => ({ ...v, [field.name]: e.target.value }))}
                onBlur={() => setTouched((t) => ({ ...t, [field.name]: true }))}
              />
            )}
            {error && <p className="mt-1 text-xs text-destructive">{error}</p>}
          </div>
        );
      })}
      <Button type="button" onClick={handleSubmit} disabled={!canSubmit || isSubmitting} className="w-full">
        {isSubmitting ? "Submitting…" : payload.submitLabel}
      </Button>
    </div>
  );
}
