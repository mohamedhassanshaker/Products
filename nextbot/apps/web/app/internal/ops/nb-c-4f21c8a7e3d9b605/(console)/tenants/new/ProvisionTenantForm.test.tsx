// @vitest-environment jsdom
import { describe, expect, it, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

const pushMock = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: pushMock }) }));

import { ProvisionTenantForm } from "./ProvisionTenantForm.js";

describe("ProvisionTenantForm (NFR-11 Platform Manager console)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    pushMock.mockReset();
    cleanup();
  });

  it("has an accessible label on every input (audited defect class per dispatch scope)", () => {
    render(<ProvisionTenantForm />);
    expect(screen.getByLabelText(/tenant name/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^slug/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/region/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/plan tier/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/default language/i)).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: /indefinite retention/i })).toBeInTheDocument();
  });

  it("submits the form and navigates to the new tenant's detail page on success", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ id: "t1", name: "Acme" }) }));
    render(<ProvisionTenantForm />);

    fireEvent.change(screen.getByLabelText(/tenant name/i), { target: { value: "Acme Corp" } });
    fireEvent.change(screen.getByLabelText(/^slug/i), { target: { value: "acme-corp" } });
    fireEvent.click(screen.getByRole("button", { name: /provision tenant/i }));

    await waitFor(() => expect(pushMock).toHaveBeenCalledWith("/internal/ops/tenants/t1"));
  });

  it("surfaces a server-side error without navigating away", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, json: async () => ({ title: "A tenant with slug 'acme-corp' already exists." }) }),
    );
    render(<ProvisionTenantForm />);

    fireEvent.change(screen.getByLabelText(/tenant name/i), { target: { value: "Acme Corp" } });
    fireEvent.change(screen.getByLabelText(/^slug/i), { target: { value: "acme-corp" } });
    fireEvent.click(screen.getByRole("button", { name: /provision tenant/i }));

    expect(await screen.findByText(/already exists/)).toBeInTheDocument();
    expect(pushMock).not.toHaveBeenCalled();
  });

  it("reveals explicit retention-day fields when indefinite retention is unchecked", () => {
    render(<ProvisionTenantForm />);
    expect(screen.queryByLabelText(/transcripts \(days\)/i)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("checkbox", { name: /indefinite retention/i }));
    expect(screen.getByLabelText(/transcripts \(days\)/i)).toBeInTheDocument();
  });

  // QA retry 2, Defect 3 regression: current Chromium compiles the `pattern`
  // attribute's regex with the 'v' (unicodeSets) flag, under which an unescaped
  // trailing `-` in a character class already containing a range is a syntax error —
  // this asserts the slug field's actual rendered `pattern` attribute compiles
  // cleanly under both flags, so the browser's client-side validation for this field
  // is never silently disabled again the way it was under the unescaped pattern.
  it("the slug field's pattern attribute is a valid regular expression under both the legacy 'u' and current 'v' RegExp flags", () => {
    render(<ProvisionTenantForm />);
    const slugInput = screen.getByLabelText(/^slug/i) as HTMLInputElement;
    const patternAttr = slugInput.getAttribute("pattern");
    expect(patternAttr).toBeTruthy();
    expect(() => new RegExp(`^(?:${patternAttr})$`, "u")).not.toThrow();
    expect(() => new RegExp(`^(?:${patternAttr})$`, "v")).not.toThrow();
  });
});
