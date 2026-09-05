// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest"
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react"
import "@testing-library/jest-dom/vitest"

import { Sidebar, SidebarNav, SidebarItem, SidebarSection } from "./sidebar.js"

afterEach(() => {
  cleanup()
  window.localStorage.clear()
})

describe("Sidebar primitive (Plan Phase 2, client-feedback-batch)", () => {
  it("renders a SidebarItem as a link and marks the active one with aria-current=page", () => {
    render(
      <Sidebar aria-label="Primary">
        <SidebarNav>
          <SidebarItem active render={<a href="/a">A</a>} />
          <SidebarItem render={<a href="/b">B</a>} />
        </SidebarNav>
      </Sidebar>
    )
    expect(screen.getByRole("link", { name: "A" })).toHaveAttribute("aria-current", "page")
    expect(screen.getByRole("link", { name: "B" })).not.toHaveAttribute("aria-current")
  })

  it("SidebarSection defaults to open and shows its items", () => {
    render(
      <Sidebar aria-label="Primary">
        <SidebarNav>
          <SidebarSection label="Agent Platform">
            <SidebarItem render={<a href="/x">X</a>} />
          </SidebarSection>
        </SidebarNav>
      </Sidebar>
    )
    expect(screen.getByRole("button", { name: "Agent Platform" })).toHaveAttribute("data-panel-open")
    expect(screen.getByRole("link", { name: "X" })).toBeVisible()
  })

  it("SidebarSection can start closed via defaultOpen={false}", () => {
    render(
      <Sidebar aria-label="Primary">
        <SidebarNav>
          <SidebarSection label="Agent Platform" defaultOpen={false}>
            <SidebarItem render={<a href="/x">X</a>} />
          </SidebarSection>
        </SidebarNav>
      </Sidebar>
    )
    expect(screen.getByRole("button", { name: "Agent Platform" })).not.toHaveAttribute("data-panel-open")
    expect(screen.queryByRole("link", { name: "X" })).not.toBeInTheDocument()
  })

  it("toggles open/closed on trigger click", async () => {
    render(
      <Sidebar aria-label="Primary">
        <SidebarNav>
          <SidebarSection label="Agent Platform">
            <SidebarItem render={<a href="/x">X</a>} />
          </SidebarSection>
        </SidebarNav>
      </Sidebar>
    )
    const trigger = screen.getByRole("button", { name: "Agent Platform" })
    fireEvent.click(trigger)
    await waitFor(() => expect(screen.queryByRole("link", { name: "X" })).not.toBeInTheDocument())
    fireEvent.click(trigger)
    await waitFor(() => expect(screen.getByRole("link", { name: "X" })).toBeVisible())
  })

  it("persists the open/closed state to localStorage under storageKey and reads it back on next mount", async () => {
    const storageKey = "test-sidebar-section"
    const { unmount } = render(
      <Sidebar aria-label="Primary">
        <SidebarNav>
          <SidebarSection label="Agent Platform" storageKey={storageKey}>
            <SidebarItem render={<a href="/x">X</a>} />
          </SidebarSection>
        </SidebarNav>
      </Sidebar>
    )
    fireEvent.click(screen.getByRole("button", { name: "Agent Platform" }))
    await waitFor(() => expect(window.localStorage.getItem(storageKey)).toBe("false"))
    unmount()

    // Remount: the server-rendered/first-client-render pass still shows
    // `defaultOpen` (true) to avoid a hydration mismatch, then the persisted
    // "false" is applied after mount.
    render(
      <Sidebar aria-label="Primary">
        <SidebarNav>
          <SidebarSection label="Agent Platform" storageKey={storageKey}>
            <SidebarItem render={<a href="/x">X</a>} />
          </SidebarSection>
        </SidebarNav>
      </Sidebar>
    )
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Agent Platform" })).not.toHaveAttribute("data-panel-open")
    )
  })

  it("silently ignores a localStorage read failure and falls back to defaultOpen", async () => {
    const getItemSpy = vi.spyOn(window.localStorage.__proto__, "getItem").mockImplementation(() => {
      throw new Error("localStorage disabled")
    })
    render(
      <Sidebar aria-label="Primary">
        <SidebarNav>
          <SidebarSection label="Agent Platform" storageKey="throws-on-read">
            <SidebarItem render={<a href="/x">X</a>} />
          </SidebarSection>
        </SidebarNav>
      </Sidebar>
    )
    // No throw during render/mount, and the section stays at its `defaultOpen`
    // (true) since the (failing) stored-preference read never applied.
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Agent Platform" })).toHaveAttribute("data-panel-open")
    )
    getItemSpy.mockRestore()
  })

  it("silently ignores a localStorage write failure when toggling", async () => {
    const setItemSpy = vi.spyOn(window.localStorage.__proto__, "setItem").mockImplementation(() => {
      throw new Error("quota exceeded")
    })
    render(
      <Sidebar aria-label="Primary">
        <SidebarNav>
          <SidebarSection label="Agent Platform" storageKey="throws-on-write">
            <SidebarItem render={<a href="/x">X</a>} />
          </SidebarSection>
        </SidebarNav>
      </Sidebar>
    )
    const trigger = screen.getByRole("button", { name: "Agent Platform" })
    // The toggle itself must still work even though persisting it throws.
    fireEvent.click(trigger)
    await waitFor(() => expect(trigger).not.toHaveAttribute("data-panel-open"))
    setItemSpy.mockRestore()
  })
})
