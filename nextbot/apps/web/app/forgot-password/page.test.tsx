// @vitest-environment jsdom
import type { ReactNode } from "react";
import { describe, expect, it, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

// This project doesn't run with vitest's `globals: true`, so RTL's auto-cleanup
// (which only registers against a *global* `afterEach`) never fires on its own —
// same convention as every other component test in this app.
afterEach(() => cleanup());

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

import ForgotPasswordPage from "./page.js";

describe("ForgotPasswordPage (QA Defect U8 placeholder, shadcn/Tailwind cutover)", () => {
  it("renders an honest placeholder (no fake reset form) with a link back to sign in", () => {
    render(<ForgotPasswordPage />);

    expect(screen.getByRole("heading", { name: /forgot your password/i })).toBeInTheDocument();
    expect(screen.getByText(/self-service password reset isn't available yet/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /back to sign in/i })).toHaveAttribute("href", "/login");
  });
});
