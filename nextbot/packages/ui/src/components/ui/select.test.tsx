// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "./select.js";

/**
 * QA fix regression test (Batch C retry 1, Defect 1 — BLOCKING).
 *
 * Repro: Base UI's `Select.Value` only resolves a human label for the
 * current value when `Select.Root` is given an `items` map. Any consumer
 * that renders `<Select value={...}>` with a value set outside a direct
 * user click (a pre-set/default value, or one populated asynchronously from
 * a fetch — exactly `TakeoverPanel.tsx`'s "Transfer to queue" after claiming
 * an escalation, and `ConnectorWizard.tsx`'s `transport`/`environment`/
 * `authMethod` fields on initial load) used to render the raw underlying
 * value instead of its label.
 *
 * This test proves the fix at the shared primitive level: a `Select` with a
 * pre-set `value` prop (never opened, never clicked by a user) renders the
 * matching item's label text, not the raw value.
 */
describe("Select (shared primitive) — label resolution for programmatically-set values", () => {
  it("renders the item's label, not the raw value, for a value set via a value prop (never opened/clicked)", () => {
    render(
      <Select value="q-11111111-uuid" onValueChange={() => {}}>
        <SelectTrigger aria-label="Transfer to queue">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="q-11111111-uuid">General Support</SelectItem>
          <SelectItem value="q-22222222-uuid">Billing</SelectItem>
        </SelectContent>
      </Select>
    );

    // The trigger must show the human label...
    expect(screen.getByText("General Support")).toBeInTheDocument();
    // ...never the raw underlying value.
    expect(screen.queryByText("q-11111111-uuid")).not.toBeInTheDocument();
  });

  it("resolves the label for the initially-selected item even when items are declared via .map() (ConnectorWizard's shape)", () => {
    const TRANSPORTS = [
      { value: "StreamableHTTP", label: "Streamable HTTP" },
      { value: "StdioViaGateway", label: "Stdio via Gateway Agent" },
    ] as const;

    render(
      <Select value="StreamableHTTP" onValueChange={() => {}}>
        <SelectTrigger aria-label="Transport">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {TRANSPORTS.map((t) => (
            <SelectItem key={t.value} value={t.value}>
              {t.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    );

    expect(screen.getByText("Streamable HTTP")).toBeInTheDocument();
    expect(screen.queryByText("StreamableHTTP")).not.toBeInTheDocument();
  });

  it("still renders a placeholder when no value is set and no default matches an item", () => {
    render(
      <Select value={undefined} onValueChange={() => {}}>
        <SelectTrigger aria-label="Backend type">
          <SelectValue placeholder="Select backend type" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="Ticketing">Ticketing</SelectItem>
        </SelectContent>
      </Select>
    );

    expect(screen.getByText("Select backend type")).toBeInTheDocument();
  });
});
