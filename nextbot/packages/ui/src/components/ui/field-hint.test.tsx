// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest"
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import "@testing-library/jest-dom/vitest"
import { TooltipProvider } from "./tooltip.js"
import { FieldHint } from "./field-hint.js"
import { Label } from "./label.js"
import { Input } from "./input.js"

/**
 * `FieldHint` establishes a new, systematic field-level-help usage of the shared
 * `Tooltip` primitive (UX_GUIDELINES.md §1.c) — distinct from this codebase's existing
 * disabled-row-explanation tooltip usage (e.g. `RolesTable.tsx`). These tests prove:
 * (1) the trigger has a real, independent accessible name so it doesn't get confused
 * with the field's own `Label` by assistive tech, and (2) the one-sentence help copy
 * actually renders once the trigger is hovered/focused, wired through Base UI's own
 * `aria-describedby` tooltip semantics rather than anything hand-rolled here.
 */
function Harness({ content }: { content: string }) {
  return (
    <TooltipProvider delay={0}>
      <div>
        <Label htmlFor="demo-field">
          Demo Field
        </Label>
        <FieldHint id="demo-field-hint" content={content} />
        <Input id="demo-field" />
      </div>
    </TooltipProvider>
  )
}

afterEach(() => {
  cleanup()
})

describe("FieldHint", () => {
  it("renders a trigger with an independent accessible name, distinct from the field's own Label", () => {
    render(<Harness content="Explains exactly what this field does." />)

    // Resolvable via its own accessible name — not swallowed by the sibling `Label`
    // text ("Demo Field"), proving the two are independently addressable by a screen
    // reader.
    const trigger = screen.getByRole("button", { name: "More information" })
    expect(trigger).toBeInTheDocument()
    expect(screen.getByLabelText("Demo Field")).toBeInTheDocument()
  })

  it("reveals the one-sentence help content on hover, with aria-describedby wired to the popup while open", async () => {
    render(<Harness content="Explains exactly what this field does." />)
    const trigger = screen.getByRole("button", { name: "More information" })

    // No dangling ARIA IDREF while closed — the popup isn't rendered yet, so the
    // trigger must not point at a nonexistent id (same defect class as the
    // `FormControl`/`FormDescription` fix documented in `form.test.tsx`).
    expect(trigger).not.toHaveAttribute("aria-describedby")

    fireEvent.mouseEnter(trigger)

    await waitFor(() => {
      expect(screen.getByText("Explains exactly what this field does.")).toBeInTheDocument()
    })

    // `@base-ui/react@1.7.0`'s Tooltip does not wire `aria-describedby` itself (verified
    // against the installed version rather than assumed) — `FieldHint` wires it
    // directly once open, pointing at the now-mounted popup's id.
    const describedBy = trigger.getAttribute("aria-describedby")
    expect(describedBy).toBeTruthy()
    expect(document.getElementById(describedBy!)).toHaveTextContent(
      "Explains exactly what this field does."
    )
  })

  it("reveals the help content on keyboard focus (not hover-only), so it's reachable without a pointer", async () => {
    render(<Harness content="Keyboard-reachable help text." />)
    const trigger = screen.getByRole("button", { name: "More information" })

    fireEvent.focus(trigger)

    await waitFor(() => {
      expect(screen.getByText("Keyboard-reachable help text.")).toBeInTheDocument()
    })
  })

  // QA fix pass (client-feedback-batch, retry 2) — `id` is now a required prop
  // (see field-hint.tsx's doc comment): Base UI's Tooltip.Trigger always renders a
  // DOM `id`, and its own generated fallback was found to genuinely drift between
  // the server render and the client's hydration pass on this app's real pages.
  // These tests prove the caller-supplied id actually reaches the DOM, and that two
  // instances with byte-identical `content` (the exact shape of ModelGateway.tsx's
  // per-Provider-Chain-entry hints) never collide as long as their caller-supplied
  // `id`s are distinct.
  it("wires the caller-supplied id onto the trigger's DOM id, not an auto-generated one", () => {
    render(<Harness content="Explains exactly what this field does." />)
    const trigger = screen.getByRole("button", { name: "More information" })
    expect(trigger).toHaveAttribute("id", "demo-field-hint")
  })

  it("does not collide between two instances with identical content but distinct caller-supplied ids", async () => {
    render(
      <TooltipProvider delay={0}>
        <div>
          <FieldHint id="row-1-hint" content="Same text every row." />
          <FieldHint id="row-2-hint" content="Same text every row." />
        </div>
      </TooltipProvider>
    )
    const [firstTrigger, secondTrigger] = screen.getAllByRole("button", { name: "More information" })
    expect(firstTrigger).toHaveAttribute("id", "row-1-hint")
    expect(secondTrigger).toHaveAttribute("id", "row-2-hint")

    fireEvent.mouseEnter(secondTrigger!)
    await waitFor(() => {
      expect(secondTrigger).toHaveAttribute("aria-describedby", "row-2-hint-content")
    })
    // Only the hovered trigger points at a (mounted) popup — the other stays closed.
    expect(firstTrigger).not.toHaveAttribute("aria-describedby")
  })
})
