// @vitest-environment jsdom
import type { ReactNode } from "react";
import { describe, expect, it, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

// Minimal stand-in: Next's real Link needs a Router context this unit test doesn't
// provide (same pattern `apps/web/app/(admin)/AdminShell.test.tsx` established).
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

import { AccessDeniedState } from "./AccessDeniedState.js";

afterEach(() => cleanup());

describe("AccessDeniedState (QA Defect U3 — fail-closed deep-link guard)", () => {
  it("renders an h1 and a link back to Dashboard Home", () => {
    render(<AccessDeniedState />);
    expect(screen.getByRole("heading", { level: 1, name: /don't have access/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /back to dashboard home/i })).toHaveAttribute("href", "/dashboard");
  });

  it("names the specific module when provided", () => {
    render(<AccessDeniedState moduleLabel="Connectors" />);
    expect(screen.getByText(/connectors/i)).toBeInTheDocument();
  });

  // Plan Phase 4 (QA finding, Batch D): every real call site renders this component
  // nested inside `AdminShell.tsx`'s own `<main role="main">` — a second `main`
  // landmark here produced a real duplicate-landmark a11y defect app-wide. Assert
  // the component itself never introduces a competing landmark.
  it("does not render its own main landmark (avoids duplicating AdminShell's <main>)", () => {
    render(<AccessDeniedState />);
    expect(screen.queryByRole("main")).not.toBeInTheDocument();
  });
});
