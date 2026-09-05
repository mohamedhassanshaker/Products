// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import yaml from "js-yaml";

// Phase 10 (client-feedback-batch item 8): `DesignModeForm` now fetches the tenant's
// real capability groups from `GET /api/v1/admin/tools/capability-groups` for its Tool
// Policy picker. Mocked the same way `VersionEditor.test.tsx` already established for
// this exact helper, rather than mocking the global `fetch`.
const fetchJsonMock = vi.fn();
vi.mock("@/src/lib/fetch-json", () => ({
  fetchJson: (...a: unknown[]) => fetchJsonMock(...a),
}));

import { DesignModeForm } from "./DesignModeForm.js";

const CAPABILITY_GROUPS_FIXTURE = [
  { id: "cg-billing", name: "billing", guidanceText: null, toolCount: 3 },
  { id: "cg-order-lookup", name: "order-lookup", guidanceText: null, toolCount: 1 },
];

/** Opens a shadcn/Base UI `Select` by its trigger's accessible name, then clicks the
 * option with the given visible text — the same helper `ConnectorWizard.test.tsx`
 * already established for this exact primitive (Base UI's `Select.Item` only commits
 * a mouse-originated selection after a real `pointerdown` immediately before `click`). */
async function chooseOption(triggerName: string | RegExp, optionName: string | RegExp) {
  fireEvent.click(screen.getByRole("combobox", { name: triggerName }));
  const option = await screen.findByRole("option", { name: optionName });
  fireEvent.pointerDown(option);
  fireEvent.click(option);
}

const VALID_YAML = `apiVersion: nextbot.io/v1
kind: AgentDefinition
metadata:
  name: support-triage
  version: 1.0.0
spec:
  graphType: ADK
  modelRoute: chat.primary
  instructions: You are a helpful support agent.
  toolPolicy:
    source: agent-tool-registry
    capabilityGroups: []
    maxToolCallsPerTurn: 5
  guardrails:
    minConfidenceForAutonomy: 0.6
    escalateOn: []
  memory:
    strategy: rolling-window
    maxTurns: 20
  budgets:
    maxCostUsdPerConversation: "0.50"
    maxLatencyMsP95: 6000
`;

describe("DesignModeForm (Phase 9, client-feedback-batch item 7; Phase 10, item 8)", () => {
  beforeEach(() => {
    fetchJsonMock.mockReset();
    fetchJsonMock.mockResolvedValue({ kind: "ok", data: { capabilityGroups: CAPABILITY_GROUPS_FIXTURE } });
  });
  afterEach(() => cleanup());

  it("seeds every field from the current Text-mode YAML", async () => {
    render(<DesignModeForm definitionName="support-triage" version="1.0.0" yamlText={VALID_YAML} onYamlChange={vi.fn()} />);
    expect(await screen.findByRole("combobox", { name: "Graph type" })).toHaveTextContent("ADK");
    expect(screen.getByRole("combobox", { name: "Model route" })).toHaveTextContent("chat.primary");
    expect(screen.getByLabelText(/system instructions/i)).toHaveValue("You are a helpful support agent.");
    expect(screen.getByLabelText(/max tool calls per turn/i)).toHaveValue(5);
    expect(screen.getByLabelText(/min confidence for autonomy/i)).toHaveValue(0.6);
    expect(screen.getByLabelText(/max turns/i)).toHaveValue(20);
    expect(screen.getByLabelText(/max cost/i)).toHaveValue("0.50");
    expect(screen.getByLabelText(/max latency/i)).toHaveValue(6000);
  });

  it("shows a field-level hint (FieldHint) next to every section's fields", () => {
    render(<DesignModeForm definitionName="support-triage" version="1.0.0" yamlText={VALID_YAML} onYamlChange={vi.fn()} />);
    // One `FieldHint` trigger per labeled field/group in this form.
    const hints = screen.getAllByRole("button", { name: "More information" });
    expect(hints.length).toBeGreaterThanOrEqual(10);
  });

  it("does not call onYamlChange on initial mount — only on an actual field edit", async () => {
    const onYamlChange = vi.fn();
    render(<DesignModeForm definitionName="support-triage" version="1.0.0" yamlText={VALID_YAML} onYamlChange={onYamlChange} />);
    await screen.findByLabelText(/system instructions/i);
    // Give any stray microtask a turn to run before asserting the negative.
    await new Promise((r) => setTimeout(r, 0));
    expect(onYamlChange).not.toHaveBeenCalled();
  });

  it("propagates an edited field back to YAML via onYamlChange, preserving the rest of the artifact", async () => {
    const onYamlChange = vi.fn();
    render(<DesignModeForm definitionName="support-triage" version="1.0.0" yamlText={VALID_YAML} onYamlChange={onYamlChange} />);
    const instructions = await screen.findByLabelText(/system instructions/i);
    fireEvent.change(instructions, { target: { value: "You are a billing specialist." } });
    await waitFor(() => expect(onYamlChange).toHaveBeenCalled());
    const lastCall = onYamlChange.mock.calls.at(-1)?.[0] as string;
    const parsed = yaml.load(lastCall) as { spec: { instructions: string; graphType: string } };
    expect(parsed.spec.instructions).toBe("You are a billing specialist.");
    expect(parsed.spec.graphType).toBe("ADK");
  });

  it("toggles an escalation reason checkbox and reflects it in the generated YAML", async () => {
    const onYamlChange = vi.fn();
    render(<DesignModeForm definitionName="support-triage" version="1.0.0" yamlText={VALID_YAML} onYamlChange={onYamlChange} />);
    const lowConfidence = await screen.findByRole("checkbox", { name: "Low confidence" });
    fireEvent.click(lowConfidence);
    await waitFor(() => expect(onYamlChange).toHaveBeenCalled());
    const lastCall = onYamlChange.mock.calls.at(-1)?.[0] as string;
    const parsed = yaml.load(lastCall) as { spec: { guardrails: { escalateOn: string[] } } };
    expect(parsed.spec.guardrails.escalateOn).toEqual(["LowConfidence"]);
  });

  it("changes the graph type via the Select and reflects it in the generated YAML", async () => {
    const onYamlChange = vi.fn();
    render(<DesignModeForm definitionName="support-triage" version="1.0.0" yamlText={VALID_YAML} onYamlChange={onYamlChange} />);
    await screen.findByRole("combobox", { name: "Graph type" });
    await chooseOption("Graph type", "CustomFSM");
    await waitFor(() => expect(onYamlChange).toHaveBeenCalled());
    const parsed = yaml.load(onYamlChange.mock.calls.at(-1)?.[0] as string) as { spec: { graphType: string } };
    expect(parsed.spec.graphType).toBe("CustomFSM");
  });

  it("changes the model route via the Select and reflects it in the generated YAML", async () => {
    const onYamlChange = vi.fn();
    render(<DesignModeForm definitionName="support-triage" version="1.0.0" yamlText={VALID_YAML} onYamlChange={onYamlChange} />);
    await screen.findByRole("combobox", { name: "Model route" });
    await chooseOption("Model route", "chat.fast");
    await waitFor(() => expect(onYamlChange).toHaveBeenCalled());
    const parsed = yaml.load(onYamlChange.mock.calls.at(-1)?.[0] as string) as { spec: { modelRoute: string } };
    expect(parsed.spec.modelRoute).toBe("chat.fast");
  });

  it("picks capability groups via the checkbox picker, plus tool-call/turn/latency numbers and budgets, and reflects all of them in the generated YAML", async () => {
    const onYamlChange = vi.fn();
    render(<DesignModeForm definitionName="support-triage" version="1.0.0" yamlText={VALID_YAML} onYamlChange={onYamlChange} />);
    fireEvent.click(await screen.findByRole("checkbox", { name: /billing/i }));
    fireEvent.click(screen.getByRole("checkbox", { name: /order-lookup/i }));
    fireEvent.change(screen.getByLabelText(/max tool calls per turn/i), { target: { value: "12" } });
    fireEvent.change(screen.getByLabelText(/^max turns/i), { target: { value: "40" } });
    fireEvent.change(screen.getByLabelText(/max cost/i), { target: { value: "1.25" } });
    fireEvent.change(screen.getByLabelText(/max latency/i), { target: { value: "9000" } });
    fireEvent.change(screen.getByLabelText(/eval suite/i), { target: { value: "support-golden-v3" } });
    await waitFor(() => {
      const parsed = yaml.load(onYamlChange.mock.calls.at(-1)?.[0] as string) as {
        spec: {
          toolPolicy: { capabilityGroups: string[]; maxToolCallsPerTurn: number };
          memory: { maxTurns: number };
          budgets: { maxCostUsdPerConversation: string; maxLatencyMsP95: number };
          evalSuite?: string;
        };
      };
      expect(parsed.spec.toolPolicy.capabilityGroups).toEqual(["billing", "order-lookup"]);
      expect(parsed.spec.toolPolicy.maxToolCallsPerTurn).toBe(12);
      expect(parsed.spec.memory.maxTurns).toBe(40);
      expect(parsed.spec.budgets.maxCostUsdPerConversation).toBe("1.25");
      expect(parsed.spec.budgets.maxLatencyMsP95).toBe(9000);
      expect(parsed.spec.evalSuite).toBe("support-golden-v3");
    });
  });

  it("checking then unchecking an escalation reason ends with it absent from the generated YAML", async () => {
    const onYamlChange = vi.fn();
    render(<DesignModeForm definitionName="support-triage" version="1.0.0" yamlText={VALID_YAML} onYamlChange={onYamlChange} />);
    const toolFailure = await screen.findByRole("checkbox", { name: "Tool failure" });
    fireEvent.click(toolFailure);
    await waitFor(() => {
      const parsed = yaml.load(onYamlChange.mock.calls.at(-1)?.[0] as string) as { spec: { guardrails: { escalateOn: string[] } } };
      expect(parsed.spec.guardrails.escalateOn).toEqual(["ToolFailure"]);
    });
    fireEvent.click(toolFailure);
    await waitFor(() => {
      const parsed = yaml.load(onYamlChange.mock.calls.at(-1)?.[0] as string) as { spec: { guardrails: { escalateOn: string[] } } };
      expect(parsed.spec.guardrails.escalateOn).toEqual([]);
    });
  });

  it("momentarily clearing a required numeric field (min confidence) does not propagate an invalid artifact, then resumes propagating once corrected", async () => {
    const onYamlChange = vi.fn();
    render(<DesignModeForm definitionName="support-triage" version="1.0.0" yamlText={VALID_YAML} onYamlChange={onYamlChange} />);
    const minConfidence = await screen.findByLabelText(/min confidence for autonomy/i);
    fireEvent.change(minConfidence, { target: { value: "" } });
    // Give the watch-subscription effect a turn; it must not have propagated an
    // invalid (empty-string) artifact up to Text mode.
    await new Promise((r) => setTimeout(r, 0));
    const callsAfterClearing = onYamlChange.mock.calls.length;
    fireEvent.change(minConfidence, { target: { value: "0.9" } });
    await waitFor(() => expect(onYamlChange.mock.calls.length).toBeGreaterThan(callsAfterClearing));
    const parsed = yaml.load(onYamlChange.mock.calls.at(-1)?.[0] as string) as { spec: { guardrails: { minConfidenceForAutonomy: number } } };
    expect(parsed.spec.guardrails.minConfidenceForAutonomy).toBe(0.9);
  });

  it("shows a humanized error, not the raw TypeBox message, when a required text field is cleared", async () => {
    render(<DesignModeForm definitionName="support-triage" version="1.0.0" yamlText={VALID_YAML} onYamlChange={vi.fn()} />);
    const instructions = await screen.findByLabelText(/system instructions/i);
    fireEvent.change(instructions, { target: { value: "" } });
    expect(await screen.findByText("System instructions are required.")).toBeInTheDocument();
    expect(screen.queryByText(/expected string length greater or equal to 1/i)).not.toBeInTheDocument();
  });

  it("shows a humanized error when the max cost field is cleared, and clears it again once corrected", async () => {
    render(<DesignModeForm definitionName="support-triage" version="1.0.0" yamlText={VALID_YAML} onYamlChange={vi.fn()} />);
    const maxCost = await screen.findByLabelText(/max cost/i);
    fireEvent.change(maxCost, { target: { value: "" } });
    expect(await screen.findByText("Enter a maximum cost.")).toBeInTheDocument();
    fireEvent.change(maxCost, { target: { value: "0.75" } });
    await waitFor(() => expect(screen.queryByText("Enter a maximum cost.")).not.toBeInTheDocument());
  });

  it("shows a humanized error when max latency is cleared to empty", async () => {
    const onYamlChange = vi.fn();
    render(<DesignModeForm definitionName="support-triage" version="1.0.0" yamlText={VALID_YAML} onYamlChange={onYamlChange} />);
    const maxLatency = await screen.findByLabelText(/max latency/i);
    fireEvent.change(maxLatency, { target: { value: "" } });
    expect(await screen.findByText(/enter a latency of 0 or more|enter a whole number/i)).toBeInTheDocument();
  });

  it("shows a non-blocking warning and starts from defaults when the current Text-mode YAML doesn't parse", async () => {
    render(<DesignModeForm definitionName="support-triage" version="1.0.0" yamlText="not: valid: at: all: [" onYamlChange={vi.fn()} />);
    expect(await screen.findByText(/starting from defaults/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/system instructions/i)).toHaveValue("You are a helpful support agent.");
  });

  it("shows a non-blocking warning and lists the schema errors when the current Text-mode YAML parses but fails schema validation", async () => {
    // Valid YAML syntax (real newlines via template literal — a JSX plain-string
    // attribute does not process `\n` escapes the way a JS string literal does),
    // but missing required top-level keys (`kind`/`metadata`/`spec`), so this
    // exercises the schema-invalid branch specifically, distinct from the
    // parse-error test above.
    const incompleteYaml = `apiVersion: nextbot.io/v1\n`;
    render(<DesignModeForm definitionName="support-triage" version="1.0.0" yamlText={incompleteYaml} onYamlChange={vi.fn()} />);
    expect(await screen.findByText(/starting from defaults/i)).toBeInTheDocument();
    expect(screen.getAllByText(/expected required property/i).length).toBeGreaterThan(0);
  });

  describe("Phase 10 (client-feedback-batch item 8) — real capability-group picker", () => {
    it("fetches the tenant's real capability groups and renders one checkbox per group with its tool count", async () => {
      render(<DesignModeForm definitionName="support-triage" version="1.0.0" yamlText={VALID_YAML} onYamlChange={vi.fn()} />);
      expect(fetchJsonMock).toHaveBeenCalledWith("/api/v1/admin/tools/capability-groups");
      expect(await screen.findByRole("checkbox", { name: /billing.*3 tools/i })).toBeInTheDocument();
      expect(screen.getByRole("checkbox", { name: /order-lookup.*1 tool\b/i })).toBeInTheDocument();
    });

    it("shows a loading placeholder before the fetch resolves, not an empty picker", async () => {
      let resolveFetch!: (v: unknown) => void;
      fetchJsonMock.mockReturnValue(new Promise((resolve) => (resolveFetch = resolve)));
      render(<DesignModeForm definitionName="support-triage" version="1.0.0" yamlText={VALID_YAML} onYamlChange={vi.fn()} />);
      expect(screen.getByRole("status", { name: "Loading capability groups" })).toBeInTheDocument();
      resolveFetch({ kind: "ok", data: { capabilityGroups: CAPABILITY_GROUPS_FIXTURE } });
      await waitFor(() => expect(screen.queryByRole("status", { name: "Loading capability groups" })).not.toBeInTheDocument());
    });

    it("shows a non-blocking notice and still renders the picker (with zero pickable groups) when the fetch fails", async () => {
      fetchJsonMock.mockResolvedValue({ kind: "error", status: 500, message: "boom" });
      render(<DesignModeForm definitionName="support-triage" version="1.0.0" yamlText={VALID_YAML} onYamlChange={vi.fn()} />);
      expect(await screen.findByText(/couldn.t load capability groups/i)).toBeInTheDocument();
      expect(screen.queryByRole("checkbox", { name: /billing/i })).not.toBeInTheDocument();
    });

    it("preserves a capability group name already on the artifact that no longer matches a real tenant group, and lets it be removed", async () => {
      const yamlWithStaleGroup = VALID_YAML.replace("capabilityGroups: []", "capabilityGroups: [deleted-group]");
      const onYamlChange = vi.fn();
      render(<DesignModeForm definitionName="support-triage" version="1.0.0" yamlText={yamlWithStaleGroup} onYamlChange={onYamlChange} />);
      const orphan = await screen.findByRole("checkbox", { name: /deleted-group.*no longer exists/i });
      expect(orphan).toBeChecked();
      fireEvent.click(orphan);
      await waitFor(() => {
        const parsed = yaml.load(onYamlChange.mock.calls.at(-1)?.[0] as string) as { spec: { toolPolicy: { capabilityGroups: string[] } } };
        expect(parsed.spec.toolPolicy.capabilityGroups).toEqual([]);
      });
    });

    it("unchecking a picked capability group removes it from the generated YAML", async () => {
      const yamlWithBilling = VALID_YAML.replace("capabilityGroups: []", "capabilityGroups: [billing]");
      const onYamlChange = vi.fn();
      render(<DesignModeForm definitionName="support-triage" version="1.0.0" yamlText={yamlWithBilling} onYamlChange={onYamlChange} />);
      const billing = await screen.findByRole("checkbox", { name: /billing.*3 tools/i });
      expect(billing).toBeChecked();
      fireEvent.click(billing);
      await waitFor(() => {
        const parsed = yaml.load(onYamlChange.mock.calls.at(-1)?.[0] as string) as { spec: { toolPolicy: { capabilityGroups: string[] } } };
        expect(parsed.spec.toolPolicy.capabilityGroups).toEqual([]);
      });
    });
  });
});
