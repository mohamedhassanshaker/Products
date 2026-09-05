// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

const fetchJsonMock = vi.fn();
vi.mock("@/src/lib/fetch-json", () => ({
  fetchJson: (...a: unknown[]) => fetchJsonMock(...a),
}));

const fetchMock = vi.fn();

import { ToolPermissionRules } from "./ToolPermissionRules.js";

/** shadcn/Tailwind conversion (Batch D) — same `chooseOption` helper this migration
 * established in `RoutingConfig.test.tsx` (Batch A) for driving the new Base
 * UI-backed `Select` instead of a native `<select>`'s `fireEvent.change`. */
async function chooseOption(triggerName: string | RegExp, optionName: string) {
  const trigger = await screen.findByRole("combobox", { name: triggerName });
  fireEvent.click(trigger);
  const option = await screen.findByRole("option", { name: optionName });
  fireEvent.pointerDown(option);
  fireEvent.click(option);
}

const RULES = [
  { id: "r1", ordinal: 0, effect: "RequireApproval" as const, requiredTier: "Tier3" as const, enabled: true },
];

describe("ToolPermissionRules (QA Final Review S2 — the tool-scoped permission rule editor)", () => {
  beforeEach(() => {
    fetchJsonMock.mockReset();
    fetchMock.mockReset();
    global.fetch = fetchMock as unknown as typeof fetch;
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    cleanup();
  });

  it("renders an existing tool-scoped rule with its effect/tier/enabled state", async () => {
    fetchJsonMock.mockResolvedValue({ kind: "ok", data: { rules: RULES } });
    render(<ToolPermissionRules toolId="t1" canMutate={true} />);
    expect(await screen.findByRole("combobox", { name: "Effect for rule 1" })).toHaveTextContent("Require approval");
    expect(screen.getByRole("combobox", { name: "Required tier for rule 1" })).toHaveTextContent("Tier 3");
    expect(screen.getByLabelText("Enable rule 1")).toBeChecked();
  });

  it("disables every mutating control when canMutate is false", async () => {
    fetchJsonMock.mockResolvedValue({ kind: "ok", data: { rules: RULES } });
    render(<ToolPermissionRules toolId="t1" canMutate={false} />);
    await screen.findByRole("combobox", { name: "Effect for rule 1" });
    expect(screen.getByRole("combobox", { name: "Effect for rule 1" })).toBeDisabled();
    // Same Base UI `Switch` rendering note as `ToolCatalog.test.tsx`'s equivalent
    // assertion: the visible `<span role="switch">` never carries a real
    // `disabled` attribute (only a hidden hidden native input does), so
    // jest-dom's `toBeDisabled()` can't see it — assert `aria-disabled` instead.
    expect(screen.getByLabelText("Enable rule 1")).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByRole("button", { name: "Add rule" })).toBeDisabled();
    expect(screen.getByRole("button", { name: /^save$/i })).toBeDisabled();
  });

  it("adds a new rule defaulted to RequireApproval/Tier3/enabled", async () => {
    fetchJsonMock.mockResolvedValue({ kind: "ok", data: { rules: [] } });
    render(<ToolPermissionRules toolId="t1" canMutate={true} />);
    await waitFor(() => expect(screen.getByRole("button", { name: "Add rule" })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Add rule" }));
    expect(await screen.findByRole("combobox", { name: "Effect for rule 1" })).toHaveTextContent("Require approval");
    expect(screen.getByLabelText("Enable rule 1")).toBeChecked();
  });

  it("removes a rule via its row action", async () => {
    fetchJsonMock.mockResolvedValue({ kind: "ok", data: { rules: RULES } });
    render(<ToolPermissionRules toolId="t1" canMutate={true} />);
    await screen.findByRole("combobox", { name: "Effect for rule 1" });
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    expect(screen.queryByRole("combobox", { name: "Effect for rule 1" })).not.toBeInTheDocument();
  });

  it("saves the rule set and reloads on success", async () => {
    fetchJsonMock.mockResolvedValue({ kind: "ok", data: { rules: RULES } });
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({}) });
    render(<ToolPermissionRules toolId="t1" canMutate={true} />);
    await screen.findByRole("combobox", { name: "Effect for rule 1" });
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/v1/admin/tools/t1/permissions", expect.objectContaining({ method: "PUT" })));
  });

  it("changes a rule's effect via the Select", async () => {
    fetchJsonMock.mockResolvedValue({ kind: "ok", data: { rules: RULES } });
    render(<ToolPermissionRules toolId="t1" canMutate={true} />);
    await screen.findByRole("combobox", { name: "Effect for rule 1" });
    await chooseOption("Effect for rule 1", "Deny");
    expect(screen.getByRole("combobox", { name: "Effect for rule 1" })).toHaveTextContent("Deny");
  });
});
