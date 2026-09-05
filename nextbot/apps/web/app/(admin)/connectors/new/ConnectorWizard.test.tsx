// @vitest-environment jsdom
import { describe, expect, it, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

const pushMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock }),
}));

import { ConnectorWizard } from "./ConnectorWizard.js";

/** Opens a shadcn/Base UI `Select` by its trigger's accessible name, then clicks
 * the option with the given visible text — the Batch A/B (Plan Phase 2) equivalent
 * of the old native-`<select>` `fireEvent.change`, since Base UI's `Select` is a
 * listbox, not a native form control. */
async function chooseOption(triggerName: string | RegExp, optionName: string) {
  fireEvent.click(screen.getByRole("combobox", { name: triggerName }));
  const option = await screen.findByRole("option", { name: optionName });
  // Base UI's `Select.Item` only commits a mouse-originated selection when it
  // saw a real `pointerdown` immediately before the `click`.
  fireEvent.pointerDown(option);
  fireEvent.click(option);
}

describe("ConnectorWizard (QA Defect U10 — human-readable field errors)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    pushMock.mockReset();
    cleanup();
  });

  it("shows human-readable copy instead of raw TypeBox validator strings on an invalid submit", async () => {
    render(<ConnectorWizard />);

    fireEvent.click(screen.getByRole("button", { name: /create connector/i }));

    expect(await screen.findByText("Name is required.")).toBeInTheDocument();
    expect(await screen.findByText("Choose a backend type.")).toBeInTheDocument();

    // The raw validator strings QA flagged must never appear.
    expect(screen.queryByText(/expected string length greater or equal to 1/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/expected union value/i)).not.toBeInTheDocument();
  });

  it("submits successfully and navigates to the connectors list", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ connector: { id: "c1" } }) }),
    );
    render(<ConnectorWizard />);

    fireEvent.change(screen.getByLabelText(/^Name/), { target: { value: "Zendesk" } });
    await chooseOption(/^Backend type/, "Ticketing");
    fireEvent.change(screen.getByLabelText(/^Endpoint URL/), { target: { value: "https://zendesk.example.com/mcp" } });

    fireEvent.click(screen.getByRole("button", { name: /create connector/i }));

    await waitFor(() => expect(pushMock).toHaveBeenCalledWith("/connectors"));
  });

  it("surfaces a server-side error verbatim on a failed submit", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, json: async () => ({ title: "A connector named 'Zendesk' already exists." }) }),
    );
    render(<ConnectorWizard />);

    fireEvent.change(screen.getByLabelText(/^Name/), { target: { value: "Zendesk" } });
    await chooseOption(/^Backend type/, "Ticketing");
    fireEvent.change(screen.getByLabelText(/^Endpoint URL/), { target: { value: "https://zendesk.example.com/mcp" } });

    fireEvent.click(screen.getByRole("button", { name: /create connector/i }));

    expect(await screen.findByText("A connector named 'Zendesk' already exists.")).toBeInTheDocument();
  });

  it("reveals the Credential value field once a non-None authentication method is chosen", async () => {
    render(<ConnectorWizard />);
    expect(screen.queryByLabelText(/^Credential value/)).not.toBeInTheDocument();
    await chooseOption(/^Authentication method/, "APIKey");
    expect(await screen.findByLabelText(/^Credential value/)).toBeInTheDocument();
  });
});
