// @vitest-environment jsdom
import { describe, expect, it, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

afterEach(() => cleanup());

const opsLoginActionMock = vi.fn();
vi.mock("./actions", () => ({ opsLoginAction: (...a: unknown[]) => opsLoginActionMock(...a) }));

import { OpsLoginForm } from "./OpsLoginForm.js";

describe("OpsLoginForm (NFR-11 Platform Manager console)", () => {
  it("renders a single, accessible operator-token field", () => {
    render(<OpsLoginForm />);
    const input = screen.getByLabelText(/operator token/i);
    expect(input).toBeInTheDocument();
    expect(input).toHaveAttribute("type", "password");
    expect(screen.getByRole("button", { name: /sign in/i })).toBeInTheDocument();
  });

  it("does not render any tenant-scoped fields (no tenant slug/email/MFA — a wholly different form)", () => {
    render(<OpsLoginForm />);
    expect(screen.queryByLabelText(/tenant/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/email/i)).not.toBeInTheDocument();
  });

  it("lets the operator type into the token field", () => {
    render(<OpsLoginForm />);
    const input = screen.getByLabelText(/operator token/i) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "some-token" } });
    expect(input.value).toBe("some-token");
  });
});
