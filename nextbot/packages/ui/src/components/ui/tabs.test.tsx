// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest"
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import "@testing-library/jest-dom/vitest"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./tabs.js"

/**
 * QA fix pass (client-feedback-batch, hydration-bug-class audit — final item):
 * `TabsTrigger`/`TabsContent` already required a caller-supplied `id` to fix a
 * hydration mismatch (see `tabs.tsx`'s doc comment). That fix broke the
 * `aria-controls` relationship — Base UI's `Tabs.Tab` computed `aria-controls` from
 * its own internal (unoverridden) panel-id registry, which never learned about our
 * `id` override, so `aria-controls` pointed at an id that was never actually
 * rendered (axe-core `aria-valid-attr-value`, CRITICAL). These tests prove the fix
 * (a required `panelId` prop on `TabsTrigger`, explicitly overriding
 * `aria-controls`) resolves that without touching the `aria-labelledby` direction,
 * which already worked.
 */
function Harness() {
  return (
    <Tabs defaultValue="one">
      <TabsList>
        <TabsTrigger id="demo-tab-one" panelId="demo-panel-one" value="one">
          One
        </TabsTrigger>
        <TabsTrigger id="demo-tab-two" panelId="demo-panel-two" value="two">
          Two
        </TabsTrigger>
      </TabsList>
      <TabsContent id="demo-panel-one" value="one">
        Panel one content
      </TabsContent>
      <TabsContent id="demo-panel-two" value="two">
        Panel two content
      </TabsContent>
    </Tabs>
  )
}

afterEach(() => {
  cleanup()
})

describe("Tabs", () => {
  it("renders each trigger's aria-controls pointing at its own panel's actually-rendered DOM id", () => {
    render(<Harness />)

    const tabOne = screen.getByRole("tab", { name: "One" })
    const tabTwo = screen.getByRole("tab", { name: "Two" })

    // The panel for "one" is mounted (it's the active tab); "two"'s panel is
    // unmounted by Base UI's default (non-keepMounted) behavior. Either way,
    // aria-controls must match the id TabsContent was actually given.
    expect(tabOne).toHaveAttribute("aria-controls", "demo-panel-one")
    expect(tabTwo).toHaveAttribute("aria-controls", "demo-panel-two")

    // Not just "no violation" — the referenced id must genuinely resolve to a
    // rendered element for the active tab's panel.
    const controlledId = tabOne.getAttribute("aria-controls")!
    const panel = document.getElementById(controlledId)
    expect(panel).toBeInTheDocument()
    expect(panel).toHaveTextContent("Panel one content")
  })

  it("keeps the panel's aria-labelledby pointing back at the caller-supplied trigger id (unchanged direction)", () => {
    render(<Harness />)

    const tabOne = screen.getByRole("tab", { name: "One" })
    const panel = screen.getByRole("tabpanel", { name: "One" })

    expect(panel).toHaveAttribute("id", "demo-panel-one")
    expect(panel).toHaveAttribute("aria-labelledby", "demo-tab-one")
    expect(tabOne).toHaveAttribute("id", "demo-tab-one")
  })

  it("switches the active tab and its aria-controls target on click", () => {
    render(<Harness />)

    const tabTwo = screen.getByRole("tab", { name: "Two" })
    fireEvent.click(tabTwo)

    expect(tabTwo).toHaveAttribute("aria-selected", "true")
    expect(tabTwo).toHaveAttribute("aria-controls", "demo-panel-two")
    const panel = screen.getByRole("tabpanel", { name: "Two" })
    expect(panel).toHaveAttribute("id", "demo-panel-two")
    expect(panel).toHaveAttribute("aria-labelledby", "demo-tab-two")
  })

  it("moves roving focus between tabs with ArrowRight, preserving the correct aria-controls target", async () => {
    render(<Harness />)

    const tabOne = screen.getByRole("tab", { name: "One" })
    const tabTwo = screen.getByRole("tab", { name: "Two" })

    tabOne.focus()
    fireEvent.keyDown(tabOne, { key: "ArrowRight", code: "ArrowRight" })

    await waitFor(() => {
      expect(tabTwo).toHaveFocus()
    })
    expect(tabTwo).toHaveAttribute("aria-controls", "demo-panel-two")
  })
})
