import * as React from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { axe } from "jest-axe";
import { RuleListEditor } from "./rule-list-editor";

/**
 * Same jsdom gap `dialog.test.tsx` documents for `DestructiveConfirmDialog`
 * (composed here for the delete action) — `FocusScope`'s auto-focus pass
 * touches `scrollIntoView`, which jsdom does not implement.
 */
beforeAll(() => {
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = () => {};
  }
});

afterEach(() => {
  document.documentElement.dir = "";
});

interface TestRule {
  id: string;
  label: string;
  routesTo: string;
  topic?: string;
  priority?: string;
  channel?: string;
}

interface TestInput {
  topic: string;
  priority: string;
  channel: string;
}

/** Every rule's *defined* fields must match; an undefined field is a wildcard for that dimension only — never for every dimension at once. */
function matches(rule: TestRule, input: TestInput): boolean {
  if (rule.topic !== undefined && rule.topic !== input.topic) return false;
  if (rule.priority !== undefined && rule.priority !== input.priority) return false;
  if (rule.channel !== undefined && rule.channel !== input.channel) return false;
  return true;
}

/**
 * Straight from design-system.md §5.5 #54's own worked example (itself from
 * `SHJ3-wireframes-guide.md`'s B8 section): rule 1 (Topic = Billing) beats
 * rule 2 (Priority = High) for a ticket that satisfies both, purely because
 * of order — and reordering changes the outcome. The canonical case for
 * "the tester evaluates the live, unsaved rule order."
 */
const initialRules: TestRule[] = [
  { id: "r1", label: "Topic = Billing", routesTo: "SEWA billing team", topic: "Billing" },
  { id: "r2", label: "Priority = High", routesTo: "Senior agents", priority: "High" },
  {
    id: "r3",
    label: "Channel = WhatsApp",
    routesTo: "WhatsApp-trained agents",
    channel: "WhatsApp",
  },
];

/** A minimal controlled harness — RuleListEditor owns no state of its own. */
function Harness({
  onDelete,
  onEdit,
  onToggleEnabled,
  isEnabled,
}: {
  onDelete?: (rule: TestRule) => void;
  onEdit?: (rule: TestRule) => void;
  onToggleEnabled?: (rule: TestRule) => void;
  isEnabled?: (rule: TestRule) => boolean;
}) {
  const [rules, setRules] = React.useState(initialRules);
  const [testInput, setTestInput] = React.useState<TestInput>({
    topic: "Billing",
    priority: "High",
    channel: "Web",
  });

  return (
    <RuleListEditor<TestRule, TestInput>
      aria-label="Routing rules"
      rules={rules}
      // `readonly TestRule[]` from `onReorder` isn't directly assignable to
      // `useState`'s mutable `TestRule[]` setter type — spreading into a new
      // array satisfies both without an `as` cast.
      onReorder={(next) => setRules([...next])}
      renderRule={(rule) => (
        <p>
          {rule.label} → {rule.routesTo}
        </p>
      )}
      getRuleName={(rule) => rule.label}
      {...(isEnabled ? { isEnabled } : {})}
      {...(onToggleEnabled ? { onToggleEnabled } : {})}
      {...(onEdit ? { onEdit } : {})}
      {...(onDelete ? { onDelete } : {})}
      matches={matches}
      testInput={testInput}
      onTestInputChange={setTestInput}
      renderTestForm={({ input, onChange }) => (
        <fieldset>
          <legend>Test ticket</legend>
          <label>
            Topic
            <select
              value={input.topic}
              onChange={(event) => onChange({ ...input, topic: event.target.value })}
            >
              <option value="Billing">Billing</option>
              <option value="Customs">Customs</option>
            </select>
          </label>
          <label>
            Priority
            <select
              value={input.priority}
              onChange={(event) => onChange({ ...input, priority: event.target.value })}
            >
              <option value="Normal">Normal</option>
              <option value="High">High</option>
            </select>
          </label>
        </fieldset>
      )}
      renderMatchedRuleSummary={(rule) => `${rule.label} fired → routes to ${rule.routesTo}`}
      noMatchMessage="No rule matched — falls to the default queue."
    />
  );
}

describe("RuleListEditor", () => {
  it("renders every rule with an explicit, 1-indexed rank", () => {
    render(<Harness />);
    const list = screen.getByRole("list", { name: "Routing rules" });
    const items = within(list).getAllByRole("listitem");
    expect(items).toHaveLength(3);
    expect(within(items[0]!).getByText("1")).toBeInTheDocument();
    expect(within(items[1]!).getByText("2")).toBeInTheDocument();
    expect(within(items[2]!).getByText("3")).toBeInTheDocument();
  });

  it("Move up is disabled on the first rule; Move down is disabled on the last", () => {
    render(<Harness />);
    expect(screen.getByRole("button", { name: "Move Topic = Billing up" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Move Channel = WhatsApp down" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Move Topic = Billing down" })).toBeEnabled();
  });

  it("clicking Move down reorders the list and announces the new position", async () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "Move Topic = Billing down" }));

    const list = screen.getByRole("list", { name: "Routing rules" });
    const items = within(list).getAllByRole("listitem");
    // "Priority = High" is now rule 1, "Topic = Billing" rule 2.
    expect(within(items[0]!).getByText(/Priority = High/)).toBeInTheDocument();
    expect(within(items[1]!).getByText(/Topic = Billing/)).toBeInTheDocument();

    await waitFor(() =>
      expect(screen.getByText("Topic = Billing is now rule 2 of 3")).toBeInTheDocument(),
    );
  });

  it("Alt+ArrowUp on a focused row moves it up (§10.4's keyboard model)", async () => {
    render(<Harness />);
    const moveDownButtonForRule2 = screen.getByRole("button", {
      name: "Move Priority = High down",
    });
    moveDownButtonForRule2.focus();
    fireEvent.keyDown(moveDownButtonForRule2, { key: "ArrowUp", altKey: true });

    const list = screen.getByRole("list", { name: "Routing rules" });
    const items = within(list).getAllByRole("listitem");
    expect(within(items[0]!).getByText(/Priority = High/)).toBeInTheDocument();
  });

  it("a plain ArrowUp with no Alt key does not reorder", () => {
    render(<Harness />);
    const button = screen.getByRole("button", { name: "Move Priority = High down" });
    button.focus();
    fireEvent.keyDown(button, { key: "ArrowUp" });
    const list = screen.getByRole("list", { name: "Routing rules" });
    const items = within(list).getAllByRole("listitem");
    expect(within(items[0]!).getByText(/Topic = Billing/)).toBeInTheDocument();
  });

  it("the tester reports the highest-precedence match for a ticket that satisfies more than one rule", () => {
    render(<Harness />);
    // Default test input is Topic=Billing, Priority=High — matches both r1 and r2.
    fireEvent.click(screen.getByRole("button", { name: "Run test" }));
    expect(
      screen.getByText("Topic = Billing fired → routes to SEWA billing team"),
    ).toBeInTheDocument();
  });

  it("THE canonical case: reordering rules changes the tester's outcome for the identical ticket, with no save step", () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "Run test" }));
    expect(screen.getByText(/routes to SEWA billing team/)).toBeInTheDocument();

    // Move "Priority = High" above "Topic = Billing" — the exact scenario
    // design-system.md §5.5 #54 and the wireframe guide's B8 section name.
    fireEvent.click(screen.getByRole("button", { name: "Move Priority = High up" }));

    // Same ticket, no save — the live in-memory order now decides.
    fireEvent.click(screen.getByRole("button", { name: "Run test" }));
    expect(screen.getByText("Priority = High fired → routes to Senior agents")).toBeInTheDocument();
    expect(screen.queryByText(/routes to SEWA billing team/)).not.toBeInTheDocument();
  });

  it("reports no match, and the caller's own message, when no active rule fires", () => {
    render(<Harness />);
    fireEvent.change(screen.getByLabelText("Topic"), { target: { value: "Customs" } });
    fireEvent.change(screen.getByLabelText("Priority"), { target: { value: "Normal" } });
    fireEvent.click(screen.getByRole("button", { name: "Run test" }));
    expect(screen.getByText("No rule matched — falls to the default queue.")).toBeInTheDocument();
  });

  it("a disabled rule is skipped by the tester even though it would otherwise match", () => {
    render(<Harness isEnabled={(rule) => rule.id !== "r1"} onToggleEnabled={vi.fn()} />);
    // r1 (Topic = Billing) would match first, but is disabled — r2 should fire instead.
    fireEvent.click(screen.getByRole("button", { name: "Run test" }));
    expect(screen.getByText("Priority = High fired → routes to Senior agents")).toBeInTheDocument();
  });

  it("toggling the enable switch calls onToggleEnabled with the rule", () => {
    const onToggleEnabled = vi.fn();
    render(<Harness isEnabled={() => true} onToggleEnabled={onToggleEnabled} />);
    fireEvent.click(screen.getByRole("switch", { name: "Topic = Billing enabled" }));
    expect(onToggleEnabled).toHaveBeenCalledWith(
      expect.objectContaining({ id: "r1", label: "Topic = Billing" }),
    );
  });

  it("clicking Edit calls onEdit with the rule", () => {
    const onEdit = vi.fn();
    render(<Harness onEdit={onEdit} />);
    fireEvent.click(
      within(screen.getAllByRole("listitem")[0]!).getByRole("button", { name: "Edit" }),
    );
    expect(onEdit).toHaveBeenCalledWith(expect.objectContaining({ id: "r1" }));
  });

  it("Delete opens a destructive confirmation restating the rule by name, and only calls onDelete on confirm", async () => {
    const onDelete = vi.fn();
    render(<Harness onDelete={onDelete} />);
    fireEvent.click(
      within(screen.getAllByRole("listitem")[0]!).getByRole("button", { name: "Delete" }),
    );

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Topic = Billing", { exact: false })).toBeInTheDocument();
    expect(onDelete).not.toHaveBeenCalled();

    fireEvent.click(within(dialog).getByRole("button", { name: "Delete" }));
    expect(onDelete).toHaveBeenCalledWith(expect.objectContaining({ id: "r1" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("cancelling the delete confirmation never calls onDelete", async () => {
    const onDelete = vi.fn();
    render(<Harness onDelete={onDelete} />);
    fireEvent.click(
      within(screen.getAllByRole("listitem")[0]!).getByRole("button", { name: "Delete" }),
    );
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(onDelete).not.toHaveBeenCalled();
  });

  it("renders the default empty state when there are no rules", () => {
    function EmptyHarness() {
      const [rules] = React.useState<TestRule[]>([]);
      return (
        <RuleListEditor<TestRule, TestInput>
          aria-label="Routing rules"
          rules={rules}
          onReorder={() => {}}
          renderRule={(rule) => <p>{rule.label}</p>}
          getRuleName={(rule) => rule.label}
          matches={matches}
          testInput={{ topic: "Billing", priority: "High", channel: "Web" }}
          onTestInputChange={() => {}}
          renderTestForm={() => null}
        />
      );
    }
    render(<EmptyHarness />);
    expect(screen.getByText("No rules yet")).toBeInTheDocument();
  });

  it("has zero axe violations in its default state", async () => {
    const { container } = render(<Harness />);
    expect(await axe(container)).toHaveNoViolations();
  });

  it("has zero axe violations with the delete confirmation open", async () => {
    render(<Harness onDelete={vi.fn()} />);
    fireEvent.click(
      within(screen.getAllByRole("listitem")[0]!).getByRole("button", { name: "Delete" }),
    );
    await screen.findByRole("dialog");
    expect(
      await axe(document.body, { rules: { region: { enabled: false } } }),
    ).toHaveNoViolations();
  });
});
