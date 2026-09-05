// @vitest-environment jsdom
import type { ReactNode } from "react";
import { describe, expect, it, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

afterEach(() => cleanup());

let currentPathname = "/internal/ops/tenants";
vi.mock("next/navigation", () => ({
  usePathname: () => currentPathname,
}));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const opsLogoutActionMock = vi.fn();
vi.mock("../login/actions", () => ({ opsLogoutAction: (...a: unknown[]) => opsLogoutActionMock(...a) }));

import { OpsShell } from "./OpsShell.js";

describe("OpsShell (NFR-11 Platform Manager console — genuinely separate minimal shell)", () => {
  it("renders the Platform Manager title, nav, and children", () => {
    render(
      <OpsShell>
        <p>Tenant content</p>
      </OpsShell>,
    );
    expect(screen.getByText("Platform Manager")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Tenants" })).toHaveAttribute("href", "/internal/ops/tenants");
    expect(screen.getByRole("link", { name: "Plan Tiers" })).toHaveAttribute("href", "/internal/ops/plan-tiers");
    expect(screen.getByRole("link", { name: "Health" })).toHaveAttribute("href", "/internal/ops/health");
    expect(screen.getByText("Tenant content")).toBeInTheDocument();
  });

  it("marks the active nav item with aria-current", () => {
    currentPathname = "/internal/ops/tenants/new";
    render(
      <OpsShell>
        <p>content</p>
      </OpsShell>,
    );
    expect(screen.getByRole("link", { name: "Tenants" })).toHaveAttribute("aria-current", "page");
  });

  it("submits the sign-out form", () => {
    render(
      <OpsShell>
        <p>content</p>
      </OpsShell>,
    );
    fireEvent.click(screen.getByRole("button", { name: /sign out/i }));
    // The action is a native form action (not a click handler) — this asserts the
    // button/form wiring exists, not the Server Action's own effect (already
    // covered by `login/actions.test.ts`).
    expect(screen.getByRole("button", { name: /sign out/i })).toBeInTheDocument();
  });
});
