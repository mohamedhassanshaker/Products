// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

const fetchJsonMock = vi.fn();
vi.mock("@/src/lib/fetch-json", () => ({ fetchJson: (...a: unknown[]) => fetchJsonMock(...a) }));

import { RoutingConfig } from "./RoutingConfig.js";

const QUEUES = [{ id: "q1", name: "General Support", isDefault: true, queueExternalRef: null }];
const RULES = [{ id: "r1", ordinal: 1, conditions: { reasons: ["SensitiveTopic"] }, queueId: "q1", enabled: true }];

/** Opens a shadcn/Base UI `Select` by its trigger's accessible name, then clicks
 * the option with the given visible text — the Batch A (Plan Phase 2) equivalent
 * of the old native-`<select>` `fireEvent.change`, since Base UI's `Select` is a
 * listbox, not a native form control. */
async function chooseOption(triggerName: string | RegExp, optionName: string) {
  fireEvent.click(screen.getByRole("combobox", { name: triggerName }));
  const option = await screen.findByRole("option", { name: optionName });
  // Base UI's `Select.Item` only commits a mouse-originated selection when it
  // saw a real `pointerdown` immediately before the `click` (it otherwise
  // treats a bare `click` — e.g. one synthesized without a preceding pointer
  // sequence — as a stray click that shouldn't select an unhighlighted item).
  // `fireEvent.click` alone never fires that `pointerdown`, so simulate it.
  fireEvent.pointerDown(option);
  fireEvent.click(option);
}

describe("RoutingConfig (B.5.3 — Phase 16/BL-09)", () => {
  beforeEach(() => {
    fetchJsonMock.mockReset();
    global.fetch = vi.fn();
  });
  afterEach(() => cleanup());

  it("renders the fallback queue and existing rules", async () => {
    fetchJsonMock.mockImplementation((url: string) => {
      if (url.includes("escalation-queues")) return Promise.resolve({ kind: "ok", data: { queues: QUEUES } });
      return Promise.resolve({ kind: "ok", data: { rules: RULES } });
    });
    render(<RoutingConfig permissionLevel="Write" />);
    await waitFor(() => expect(screen.getAllByText("General Support").length).toBeGreaterThan(0));
  });

  it("renders AccessDeniedState on a 403", async () => {
    fetchJsonMock.mockResolvedValue({ kind: "forbidden", message: "no access" });
    render(<RoutingConfig permissionLevel="Read" />);
    await waitFor(() => expect(screen.getByText(/don.t have access|access denied/i)).toBeInTheDocument());
  });

  it("read-only users see no Add Rule / Save controls", async () => {
    fetchJsonMock.mockImplementation((url: string) => {
      if (url.includes("escalation-queues")) return Promise.resolve({ kind: "ok", data: { queues: QUEUES } });
      return Promise.resolve({ kind: "ok", data: { rules: RULES } });
    });
    render(<RoutingConfig permissionLevel="Read" />);
    await waitFor(() => expect(screen.getAllByText("General Support").length).toBeGreaterThan(0));
    expect(screen.queryByText("Add Rule")).not.toBeInTheDocument();
    expect(screen.queryByText("Save")).not.toBeInTheDocument();
  });

  it("adding a rule and saving PUTs the full rule set", async () => {
    fetchJsonMock.mockImplementation((url: string) => {
      if (url.includes("escalation-queues")) return Promise.resolve({ kind: "ok", data: { queues: QUEUES } });
      return Promise.resolve({ kind: "ok", data: { rules: [] } });
    });
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ rules: [] }) });
    render(<RoutingConfig permissionLevel="Write" />);
    await waitFor(() => expect(screen.getByText("Add Rule")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Add Rule"));
    await waitFor(() => expect(screen.getByText("Save")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Save"));
    await waitFor(() =>
      expect(global.fetch).toHaveBeenCalledWith("/api/v1/admin/escalation-routing-rules", expect.objectContaining({ method: "PUT" })),
    );
  });

  it("exposes a Channel condition select alongside Goal/Reason (D4)", async () => {
    fetchJsonMock.mockImplementation((url: string) => {
      if (url.includes("escalation-queues")) return Promise.resolve({ kind: "ok", data: { queues: QUEUES } });
      return Promise.resolve({ kind: "ok", data: { rules: RULES } });
    });
    render(<RoutingConfig permissionLevel="Write" />);
    await waitFor(() => expect(screen.getByRole("combobox", { name: "Channel condition" })).toBeInTheDocument());
    await chooseOption("Channel condition", "WhatsApp");
    expect(screen.getByRole("combobox", { name: "Channel condition" })).toHaveTextContent("WhatsApp");
  });

  it("creating a new backend queue posts to the queues endpoint", async () => {
    fetchJsonMock.mockImplementation((url: string) => {
      if (url.includes("escalation-queues")) return Promise.resolve({ kind: "ok", data: { queues: QUEUES } });
      return Promise.resolve({ kind: "ok", data: { rules: RULES } });
    });
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ id: "q2" }) });
    render(<RoutingConfig permissionLevel="Write" />);
    await waitFor(() => expect(screen.getByPlaceholderText("New queue name")).toBeInTheDocument());
    fireEvent.change(screen.getByPlaceholderText("New queue name"), { target: { value: "VIP" } });
    fireEvent.click(screen.getByText("Add Queue"));
    await waitFor(() =>
      expect(global.fetch).toHaveBeenCalledWith("/api/v1/admin/escalation-queues", expect.objectContaining({ method: "POST" })),
    );
  });
});
