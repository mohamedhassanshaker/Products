"use client"

import * as React from "react"
import {
  Controller,
  FormProvider,
  useFormContext,
  useFormState,
  type ControllerProps,
  type FieldPath,
  type FieldValues,
} from "react-hook-form"

import { cn } from "@nextbot/ui/lib/utils"
import { Label } from "@nextbot/ui/components/ui/label"

/**
 * Batch C hand-authored primitive — the first RHF-based form in this migration
 * sweep (`ConnectorWizard.tsx`, `CreateChannelForm.tsx`,
 * `CreateWhatsAppChannelForm.tsx` all already use React Hook Form + a TypeBox
 * resolver, per LLD §1 — this composes with that existing setup rather than
 * introducing a second validation mechanism).
 *
 * This mirrors shadcn/ui's canonical `form.tsx` shape (`Form`/`FormField`/
 * `FormItem`/`FormLabel`/`FormControl`/`FormDescription`/`FormMessage`), with
 * one deliberate substitution (local/reversible, noted per this project's
 * convention): the official version's `FormControl` wraps its child in
 * Radix's `Slot` to merge `id`/`aria-*` attributes onto whatever single
 * element is passed in. This project has no Radix dependency (the preset
 * resolved to Base UI, not Radix — see Phase 0's status note) and Base UI's
 * own `Field` primitive is tied to its *own* native-validation context, which
 * would conflict with RHF driving validation here — so `FormControl` below
 * hand-rolls the same "merge onto the single child" behavior with
 * `React.cloneElement`, only filling in an attribute the child doesn't
 * already set explicitly.
 */
const Form = FormProvider

interface FormFieldContextValue<
  TFieldValues extends FieldValues = FieldValues,
  TName extends FieldPath<TFieldValues> = FieldPath<TFieldValues>,
> {
  name: TName
}

const FormFieldContext = React.createContext<FormFieldContextValue>(
  {} as FormFieldContextValue
)

/** Wraps `react-hook-form`'s `Controller`, exposing the field name to
 * `FormLabel`/`FormControl`/`FormDescription`/`FormMessage` via context so
 * each one can derive its own ids/`aria-*` wiring without prop-drilling. */
function FormField<
  TFieldValues extends FieldValues = FieldValues,
  TName extends FieldPath<TFieldValues> = FieldPath<TFieldValues>,
>({ ...props }: ControllerProps<TFieldValues, TName>) {
  return (
    <FormFieldContext.Provider value={{ name: props.name }}>
      <Controller {...props} />
    </FormFieldContext.Provider>
  )
}

interface FormItemContextValue {
  id: string
  /** QA fix (Batch C retry 1, Defect 3): whether a `FormDescription` is
   * actually rendered among this `FormItem`'s children. Computed synchronously
   * from the JSX tree (see `hasFormDescriptionChild` below) so `FormControl`
   * never wires `aria-describedby` to a `{id}-form-item-description` element
   * that doesn't exist — a dangling ARIA IDREF, which is what QA flagged. */
  hasDescription: boolean
}

const FormItemContext = React.createContext<FormItemContextValue>(
  {} as FormItemContextValue
)

/** Synchronously checks whether `children` (a `FormItem`'s direct children,
 * as authored by the field's `render` prop — one level of `React.Fragment`
 * is unwrapped since JSX often groups sibling elements that way) includes a
 * `FormDescription` element. Used to decide whether `FormControl` should
 * reference `formDescriptionId` in `aria-describedby` (Defect 3). */
function hasFormDescriptionChild(children: React.ReactNode): boolean {
  return React.Children.toArray(children).some((child) => {
    if (!React.isValidElement(child)) return false
    if (child.type === FormDescription) return true
    if (child.type === React.Fragment) {
      const fragmentProps = child.props as { children?: React.ReactNode }
      return hasFormDescriptionChild(fragmentProps.children)
    }
    return false
  })
}

/** Reads the current field's RHF error state plus the stable ids every other
 * part in this file needs (`formItemId`/`formDescriptionId`/`formMessageId`).
 * Throws if used outside a `FormField` — the same fail-fast contract the
 * shadcn original has, so a missing wrapper is caught during development
 * rather than silently rendering unlabeled markup. */
function useFormField() {
  const fieldContext = React.useContext(FormFieldContext)
  const itemContext = React.useContext(FormItemContext)
  const { getFieldState } = useFormContext()
  const formState = useFormState({ name: fieldContext.name })
  const fieldState = getFieldState(fieldContext.name, formState)

  if (!fieldContext.name) {
    throw new Error("useFormField should be used within <FormField>")
  }

  const { id, hasDescription } = itemContext

  return {
    id,
    name: fieldContext.name,
    hasDescription,
    formItemId: `${id}-form-item`,
    formDescriptionId: `${id}-form-item-description`,
    formMessageId: `${id}-form-item-message`,
    ...fieldState,
  }
}

function FormItem({ className, children, ...props }: React.ComponentProps<"div">) {
  const id = React.useId()
  // Computed per render from the actual children passed in — cheap (a shallow
  // children scan) and avoids any register/unregister-on-mount effect dance,
  // since the value is needed synchronously for the very first paint's
  // `aria-describedby` (an effect-based flag would render once without it).
  const hasDescription = React.useMemo(() => hasFormDescriptionChild(children), [children])
  return (
    <FormItemContext.Provider value={{ id, hasDescription }}>
      <div data-slot="form-item" className={cn("grid gap-1.5", className)} {...props}>
        {children}
      </div>
    </FormItemContext.Provider>
  )
}

function FormLabel({
  className,
  ...props
}: React.ComponentProps<typeof Label>) {
  const { error, formItemId } = useFormField()
  return (
    <Label
      data-slot="form-label"
      data-error={!!error}
      className={cn("data-[error=true]:text-destructive", className)}
      htmlFor={formItemId}
      {...props}
    />
  )
}

/** Merges the computed `id`/`aria-describedby`/`aria-invalid` onto its single
 * child (typically an `Input`/`Select`/`Checkbox`/`Switch`) — see this file's
 * top doc comment for why this is a hand-rolled clone instead of Radix's
 * `Slot`. Only fills in an attribute the child doesn't already set itself,
 * so a caller can still override any of these explicitly if it ever needs to. */
function FormControl({ children }: { children: React.ReactElement }) {
  const { error, formItemId, formDescriptionId, formMessageId, hasDescription } = useFormField()
  const child = children as React.ReactElement<Record<string, unknown>>
  // QA fix (Batch C retry 1, Defect 3): only reference `formDescriptionId` when
  // a `FormDescription` is actually rendered for this field — otherwise
  // `aria-describedby` pointed at a nonexistent element (a dangling ARIA
  // IDREF), e.g. every field in `ConnectorWizard.tsx`, none of which render one.
  const describedByIds = [hasDescription ? formDescriptionId : null, error ? formMessageId : null]
    .filter(Boolean)
    .join(" ")

  return React.cloneElement(child, {
    id: child.props.id ?? formItemId,
    "aria-describedby": (child.props["aria-describedby"] as string | undefined) ?? (describedByIds || undefined),
    "aria-invalid": child.props["aria-invalid"] ?? !!error,
  })
}

function FormDescription({ className, ...props }: React.ComponentProps<"p">) {
  const { formDescriptionId } = useFormField()
  return (
    <p
      data-slot="form-description"
      id={formDescriptionId}
      className={cn("text-xs text-muted-foreground", className)}
      {...props}
    />
  )
}

/** Renders explicit `children` if given (every call site in this codebase
 * passes the field's error message through `humanizeFieldError` first — QA
 * Defect U10 requires TypeBox's raw validator strings never reach the user
 * verbatim), falling back to the field's raw RHF error message only when no
 * `children` were provided at all. Returns `null` (renders nothing) when
 * neither is present, matching every other call site's existing convention
 * of only rendering an error region when there's something to say. */
function FormMessage({ className, children, ...props }: React.ComponentProps<"p">) {
  const { error, formMessageId } = useFormField()
  const body = children !== undefined ? children : error ? String(error.message ?? "") : undefined

  if (!body) return null

  return (
    <p
      data-slot="form-message"
      id={formMessageId}
      className={cn("text-xs text-destructive", className)}
      {...props}
    >
      {body}
    </p>
  )
}

export {
  useFormField,
  Form,
  FormItem,
  FormLabel,
  FormControl,
  FormDescription,
  FormMessage,
  FormField,
}
