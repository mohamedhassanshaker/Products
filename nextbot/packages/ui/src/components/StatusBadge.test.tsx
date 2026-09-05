// @vitest-environment jsdom
import { describe, expect, it, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { StatusBadge } from "./StatusBadge.js";

// This project doesn't run with vitest's `globals: true`, so testing-library's own
// auto-cleanup never registers — clean up explicitly so each `render()` starts from
// an empty DOM (same convention `AccessDeniedState.test.tsx` and `AdminShell.test.tsx`
// already establish; without it, a later test's `getByRole("status")` can match a
// prior test's un-unmounted badge too).
afterEach(() => cleanup());

describe("StatusBadge (UX baseline: never convey status by color alone)", () => {
  it("renders both a text label and a status role for screen readers", () => {
    render(<StatusBadge tone="connected" label="Connected" />);
    const status = screen.getByRole("status");
    expect(status).toHaveTextContent("Connected");
  });

  it("renders the label verbatim for each tone", () => {
    render(<StatusBadge tone="offline" label="Offline" />);
    expect(screen.getByText("Offline")).toBeInTheDocument();
  });

  it("pairs the status dot with an aria-hidden marker so only the text label is announced", () => {
    render(<StatusBadge tone="degraded" label="Degraded" />);
    const status = screen.getByRole("status");
    const dot = status.querySelector("[aria-hidden='true']");
    expect(dot).toBeInTheDocument();
  });
});
