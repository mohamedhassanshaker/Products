// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

// Plan Phase 3 (client-feedback-batch item 11): `ConnectorAlertConfig` moved
// here from `settings/connector-alerts/` with its internals unchanged (a file
// relocation, not a rewrite) — the previous location had no test suite of its
// own, so this is new coverage for existing, unmodified logic rather than an
// update to a pre-existing suite.

const fetchJsonMock = vi.fn();
vi.mock("@/src/lib/fetch-json", () => ({
  fetchJson: (...a: unknown[]) => fetchJsonMock(...a),
}));

import { ConnectorAlertConfig } from "./ConnectorAlertConfig.js";

/** Opens a shadcn/Base UI `Select` by its trigger's accessible name, then clicks
 * the option with the given visible text — same helper as
 * `settings/escalation-routing/RoutingConfig.test.tsx`'s (Base UI's `Select` is
 * a listbox, not a native form control, so a plain `fireEvent.change` never
 * applies to it). */
async function chooseOption(triggerName: string | RegExp, optionName: string) {
  fireEvent.click(screen.getByRole("combobox", { name: triggerName }));
  const option = await screen.findByRole("option", { name: optionName });
  // Base UI's `Select.Item` only commits a mouse-originated selection when it
  // saw a real `pointerdown` immediately before the `click`.
  fireEvent.pointerDown(option);
  fireEvent.click(option);
}

const CONNECTORS = [{ id: "c1", name: "Zendesk" }];
const RULES = [
  {
    id: "r1",
    connectorId: "c1",
    metric: "ErrorRatePct" as const,
    thresholdValue: 10,
    destinationKind: "InApp" as const,
    destinationEmail: null,
    destinationCredentialId: null,
    enabled: true,
  },
];

function mockLoad(overrides: Partial<{ connectors: unknown[]; rules: unknown[] }> = {}) {
  fetchJsonMock.mockImplementation((url: string) => {
    if (url.includes("/api/v1/admin/connectors")) {
      return Promise.resolve({ kind: "ok", data: { connectors: overrides.connectors ?? CONNECTORS } });
    }
    if (url.includes("/api/v1/admin/connector-alert-rules")) {
      return Promise.resolve({ kind: "ok", data: { rules: overrides.rules ?? RULES } });
    }
    return Promise.resolve({ kind: "ok", data: {} });
  });
}

describe("ConnectorAlertConfig (B.3A.4, relocated into MCP Health's Alert Configuration tab)", () => {
  beforeEach(() => {
    fetchJsonMock.mockReset();
  });
  afterEach(() => cleanup());

  it("renders the full-page access-denied state on a 403", async () => {
    fetchJsonMock.mockResolvedValue({ kind: "forbidden", message: "denied" });
    render(<ConnectorAlertConfig permissionLevel="None" />);
    expect(await screen.findByText(/you don't have access to this section/i)).toBeInTheDocument();
  });

  it("loads connectors, auto-selects the first one, and lists its existing rules", async () => {
    mockLoad();
    render(<ConnectorAlertConfig permissionLevel="Read" />);
    expect(await screen.findByText("ErrorRatePct")).toBeInTheDocument();
    expect(screen.getByText("10")).toBeInTheDocument();
  });

  it("hides the new-rule authoring form for a Read-only caller", async () => {
    mockLoad();
    render(<ConnectorAlertConfig permissionLevel="Read" />);
    await screen.findByText("ErrorRatePct");
    expect(screen.queryByRole("button", { name: "Save rule" })).not.toBeInTheDocument();
  });

  it("lets a Write caller author and submit a new alert rule", async () => {
    mockLoad();
    render(<ConnectorAlertConfig permissionLevel="Write" />);
    await screen.findByText("ErrorRatePct");

    fireEvent.change(screen.getByLabelText("Threshold"), { target: { value: "25" } });
    fireEvent.click(screen.getByRole("button", { name: "Save rule" }));

    await waitFor(() =>
      expect(fetchJsonMock).toHaveBeenCalledWith(
        "/api/v1/admin/connector-alert-rules",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({
            connectorId: "c1",
            metric: "ErrorRatePct",
            thresholdValue: 25,
            destinationKind: "InApp",
            destinationEmail: undefined,
            enabled: true,
          }),
        }),
      ),
    );
  });

  it("shows the empty state when the selected connector has no rules yet", async () => {
    mockLoad({ rules: [] });
    render(<ConnectorAlertConfig permissionLevel="Write" />);
    expect(await screen.findByText(/no alert rules configured for this connector yet/i)).toBeInTheDocument();
  });

  it("surfaces a submit error inline instead of silently failing", async () => {
    mockLoad();
    fetchJsonMock.mockImplementation((url: string) => {
      if (url.includes("/api/v1/admin/connectors")) return Promise.resolve({ kind: "ok", data: { connectors: CONNECTORS } });
      if (url.includes("/api/v1/admin/connector-alert-rules") && url.includes("connectorId")) {
        return Promise.resolve({ kind: "ok", data: { rules: RULES } });
      }
      return Promise.resolve({ kind: "error", message: "Threshold must be a positive number." });
    });
    render(<ConnectorAlertConfig permissionLevel="Write" />);
    await screen.findByText("ErrorRatePct");
    fireEvent.click(screen.getByRole("button", { name: "Save rule" }));
    expect(await screen.findByText("Threshold must be a positive number.")).toBeInTheDocument();
  });

  it("reveals the email-address field only when Email is chosen as the destination, and includes it in the submitted payload", async () => {
    mockLoad();
    render(<ConnectorAlertConfig permissionLevel="Write" />);
    await screen.findByText("ErrorRatePct");

    expect(screen.queryByLabelText("Email address")).not.toBeInTheDocument();
    await chooseOption("Destination", "Email");
    const emailInput = await screen.findByLabelText("Email address");
    fireEvent.change(emailInput, { target: { value: "ops@tenant.com" } });
    fireEvent.click(screen.getByRole("button", { name: "Save rule" }));

    await waitFor(() =>
      expect(fetchJsonMock).toHaveBeenCalledWith(
        "/api/v1/admin/connector-alert-rules",
        expect.objectContaining({
          body: JSON.stringify({
            connectorId: "c1",
            metric: "ErrorRatePct",
            thresholdValue: 10,
            destinationKind: "Email",
            destinationEmail: "ops@tenant.com",
            enabled: true,
          }),
        }),
      ),
    );
  });
});
