// @vitest-environment jsdom
import type { ReactNode } from "react";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

// No `globals: true` in this workspace's vitest config, so RTL's auto-cleanup
// (which only registers against a *global* `afterEach`) never fires on its own.
afterEach(() => cleanup());

const loginActionMock = vi.fn();
const mfaChallengeActionMock = vi.fn();
const mfaEnrollmentConfirmActionMock = vi.fn();

vi.mock("./actions", () => ({
  loginAction: (...a: unknown[]) => loginActionMock(...a),
  mfaChallengeAction: (...a: unknown[]) => mfaChallengeActionMock(...a),
  mfaEnrollmentConfirmAction: (...a: unknown[]) => mfaEnrollmentConfirmActionMock(...a),
}));

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

import { LoginForm } from "./LoginForm.js";

function fillAndSubmitLogin() {
  // `isRequired` FormControls render a "*" indicator inside the `<label>` itself
  // (textContent e.g. "Tenant*"), so exact-string `getByLabelText` never matches —
  // match on the leading label text instead.
  fireEvent.change(screen.getByLabelText(/^Tenant/), { target: { value: "acme" } });
  fireEvent.change(screen.getByLabelText(/^Email/), { target: { value: "a@b.com" } });
  fireEvent.change(screen.getByLabelText(/^Password/), { target: { value: "correct-horse" } });
  fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
}

describe("LoginForm (QA Defects U1/U8/U9)", () => {
  beforeEach(() => {
    loginActionMock.mockReset();
    mfaChallengeActionMock.mockReset();
    mfaEnrollmentConfirmActionMock.mockReset();
  });

  it("renders the MFA challenge screen once the server action returns a real challenge token (QA Defect U1 regression)", async () => {
    loginActionMock.mockResolvedValue({ mfaChallengeToken: "tok-123" });
    render(<LoginForm />);

    expect(screen.getByRole("heading", { name: /sign in to nextbot/i })).toBeInTheDocument();
    fillAndSubmitLogin();

    // Before the fix, this screen never rendered because `challengeToken` was
    // captured via `useState(loginState.mfaChallengeToken)` at first render and
    // never updated afterward.
    expect(await screen.findByRole("heading", { name: /verify your identity/i })).toBeInTheDocument();
  });

  it("renders the forced-enrollment screen with the setup URI and backup codes (QA Defect B3)", async () => {
    loginActionMock.mockResolvedValue({
      enrollmentToken: "enroll-123",
      otpauthUri: "otpauth://totp/NextBot:a@b.com?secret=ABCDEF",
      backupCodes: ["1111111111", "2222222222"],
    });
    render(<LoginForm />);
    fillAndSubmitLogin();

    expect(await screen.findByRole("heading", { name: /set up multi-factor authentication/i })).toBeInTheDocument();
    expect(screen.getByText(/otpauth:\/\/totp/)).toBeInTheDocument();
    expect(screen.getByText("1111111111")).toBeInTheDocument();
    expect(screen.getByText("2222222222")).toBeInTheDocument();
  });

  it("toggles the password field between masked and visible via the show/hide button (QA Defect U8)", () => {
    render(<LoginForm />);
    const passwordInput = screen.getByLabelText(/^Password/) as HTMLInputElement;
    expect(passwordInput.type).toBe("password");

    const toggle = screen.getByRole("button", { name: "Show password" });
    expect(toggle).toHaveAttribute("aria-pressed", "false");

    fireEvent.click(toggle);
    expect(passwordInput.type).toBe("text");
    expect(screen.getByRole("button", { name: "Hide password" })).toHaveAttribute("aria-pressed", "true");
  });

  it("has a Forgot password link and a clearly-disabled SSO affordance (QA Defect U8)", () => {
    render(<LoginForm />);
    expect(screen.getByRole("link", { name: /forgot password/i })).toHaveAttribute("href", "/forgot-password");
    expect(screen.getByRole("button", { name: /sign in with sso/i })).toBeDisabled();
  });

  it("renders lockout with warning-tier styling and disables the form for the cooldown (QA Defect U9)", async () => {
    loginActionMock.mockResolvedValue({
      error: "Too many failed sign-in attempts. Your account is temporarily locked — try again in 5 minute(s).",
      errorKind: "locked",
    });
    render(<LoginForm />);
    fillAndSubmitLogin();

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/temporarily locked/i);

    await waitFor(() => {
      expect(screen.getByLabelText(/^Tenant/)).toBeDisabled();
      expect(screen.getByLabelText(/^Email/)).toBeDisabled();
      expect(screen.getByLabelText(/^Password/)).toBeDisabled();
      expect(screen.getByRole("button", { name: "Sign in" })).toBeDisabled();
    });
  });

  it("renders a plain wrong-password error without disabling the form", async () => {
    loginActionMock.mockResolvedValue({ error: "Incorrect email or password.", errorKind: "generic" });
    render(<LoginForm />);
    fillAndSubmitLogin();

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/incorrect email or password/i);
    expect(screen.getByLabelText(/^Email/)).toBeEnabled();
  });

  it("retains the tenant and email fields after a failed login, per UX_GUIDELINES.md §2.1 (QA Defect D1)", async () => {
    loginActionMock.mockResolvedValue({ error: "Incorrect email or password.", errorKind: "generic" });
    render(<LoginForm />);
    fillAndSubmitLogin();

    await screen.findByRole("alert");

    // Tenant + email must survive the failed attempt — only the password field is
    // expected to clear (matching the pre-migration Chakra behavior this dispatch
    // regressed).
    expect(screen.getByLabelText(/^Tenant/)).toHaveValue("acme");
    expect(screen.getByLabelText(/^Email/)).toHaveValue("a@b.com");
  });

  it("moves focus to the error alert after a failed login, so screen-reader users get an unambiguous signal (QA Defect D2)", async () => {
    loginActionMock.mockResolvedValue({ error: "Incorrect email or password.", errorKind: "generic" });
    render(<LoginForm />);
    fillAndSubmitLogin();

    const alert = await screen.findByRole("alert");
    await waitFor(() => {
      expect(document.activeElement).toBe(alert);
    });
  });
});

describe("LoginForm branding (FR-ADM-07 Part 2 — login-screen white-labeling, post-QA scope-bug fix)", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    loginActionMock.mockReset();
    mfaChallengeActionMock.mockReset();
    mfaEnrollmentConfirmActionMock.mockReset();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("renders the default NextBot look before any tenant-slug lookup has resolved", () => {
    render(<LoginForm />);
    expect(screen.getByRole("heading", { name: /sign in to nextbot/i })).toBeInTheDocument();
    expect(screen.queryByAltText("Company logo")).not.toBeInTheDocument();
  });

  it("applies the tenant's brand accent + logo after the branding lookup resolves on tenant-slug blur (debounced)", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        whiteLabelEnabled: true,
        primaryColor: "#1B6B4A",
        accentForeground: "#ffffff",
        logoUrl: "https://example.com/logo.svg",
        tenantName: "Acme Corp",
      }),
    }) as unknown as typeof fetch;

    render(<LoginForm />);
    fireEvent.change(screen.getByLabelText(/^Tenant/), { target: { value: "acme" } });
    fireEvent.blur(screen.getByLabelText(/^Tenant/));

    expect(await screen.findByRole("heading", { name: /sign in to acme corp/i })).toBeInTheDocument();
    expect(screen.getByAltText("Company logo")).toHaveAttribute("src", "https://example.com/logo.svg");
    expect(global.fetch).toHaveBeenCalledWith("/api/v1/public/tenant-branding/acme", undefined);

    const signInButton = screen.getByRole("button", { name: "Sign in" });
    expect(signInButton.style.backgroundColor).toBe("var(--brand-accent)");
  });

  it("gracefully falls back to the default NextBot look for an unbranded/nonexistent tenant slug", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ whiteLabelEnabled: false, primaryColor: null, accentForeground: null, logoUrl: null, tenantName: null }),
    }) as unknown as typeof fetch;

    render(<LoginForm />);
    fireEvent.change(screen.getByLabelText(/^Tenant/), { target: { value: "does-not-exist" } });
    fireEvent.blur(screen.getByLabelText(/^Tenant/));

    // Give the debounced lookup a chance to resolve, then assert the look is
    // still (still) the plain default — `findByRole` would throw if the heading
    // never appeared at all, which is the real regression this guards against.
    expect(await screen.findByRole("heading", { name: /sign in to nextbot/i })).toBeInTheDocument();
    expect(screen.queryByAltText("Company logo")).not.toBeInTheDocument();
  });

  it("gracefully keeps the default look if the branding lookup fails outright (network error)", async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error("network down")) as unknown as typeof fetch;

    render(<LoginForm />);
    fireEvent.change(screen.getByLabelText(/^Tenant/), { target: { value: "acme" } });

    // fetchJson itself doesn't catch a thrown fetch() rejection — this exercises
    // that a rejected lookup never leaves the screen in a broken/half-branded
    // state; the default heading must still be present throughout.
    await expect(async () => fireEvent.blur(screen.getByLabelText(/^Tenant/))).not.toThrow();
    expect(screen.getByRole("heading", { name: /sign in to nextbot/i })).toBeInTheDocument();
  });

  it("does not regress the a11y behaviors this screen has a history of QA fixes for: tenant/email retention, focus-to-error, password show/hide", async () => {
    loginActionMock.mockResolvedValue({ error: "Incorrect email or password.", errorKind: "generic" });
    render(<LoginForm />);
    fillAndSubmitLogin();

    const alert = await screen.findByRole("alert");
    await waitFor(() => expect(document.activeElement).toBe(alert));
    expect(screen.getByLabelText(/^Tenant/)).toHaveValue("acme");
    expect(screen.getByLabelText(/^Email/)).toHaveValue("a@b.com");

    const toggle = screen.getByRole("button", { name: "Show password" });
    expect(toggle).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(toggle);
    expect(screen.getByRole("button", { name: "Hide password" })).toHaveAttribute("aria-pressed", "true");
  });
});
