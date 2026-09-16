import { describe, expect, it } from "vitest";
import { FakeFlowRepository, flowVersionRowFixture } from "../testing/fakes.js";
import { CreateFlowNode } from "./create-flow-node.js";

const NOW = new Date("2026-09-10T09:00:00.000Z");

describe("CreateFlowNode", () => {
  it("rejects an incomplete ToolCall node before touching the repository — CK_FlowNodes_toolCallFields, application layer, no DB round-trip", async () => {
    const flows = new FakeFlowRepository();
    flows.seedVersion(flowVersionRowFixture());
    const createNode = new CreateFlowNode({ flows });

    const result = await createNode.execute({
      flowVersionId: "flowver_fixture_1",
      type: "ToolCall",
      title: "Fetch bill",
      canvasX: 0,
      canvasY: 0,
      messageText: null,
      quickActionSetKey: null,
      slotName: null,
      optionSourceKind: null,
      optionSourceRef: null,
      staticOptionsJson: null,
      // Deliberately incomplete: a bound tool but no retryCount/onFailureNodeId —
      // exactly the shape the task's own live-verification bar asks to prove rejected.
      toolBindingId: "toolbinding_1",
      retryCount: null,
      retryOnTimeout: null,
      timeoutMs: null,
      onFailureNodeId: null,
      handoverReason: null,
      confidenceThreshold: null,
      conditionExpression: null,
      requiredAssurance: null,
      now: NOW,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("flows.invalid_node");
      expect(result.errors).toEqual(
        expect.arrayContaining([
          expect.stringContaining("retry count"),
          expect.stringContaining("failure path"),
        ]),
      );
    }
    expect(await flows.listNodes("flowver_fixture_1")).toHaveLength(0);
  });

  it("creates a complete ToolCall node and assigns it a unique key derived from its title", async () => {
    const flows = new FakeFlowRepository();
    flows.seedVersion(flowVersionRowFixture());
    const createNode = new CreateFlowNode({ flows });

    const result = await createNode.execute({
      flowVersionId: "flowver_fixture_1",
      type: "ToolCall",
      title: "Fetch bill by account #",
      canvasX: 0,
      canvasY: 0,
      messageText: null,
      quickActionSetKey: null,
      slotName: null,
      optionSourceKind: null,
      optionSourceRef: null,
      staticOptionsJson: null,
      toolBindingId: "toolbinding_1",
      retryCount: 1,
      retryOnTimeout: true,
      timeoutMs: 5000,
      onFailureNodeId: "flownode_fallback",
      handoverReason: null,
      confidenceThreshold: null,
      conditionExpression: null,
      requiredAssurance: null,
      now: NOW,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.node.key).toBe("fetch_bill_by_account");
      expect(result.node.type).toBe("ToolCall");
    }
  });

  it("disambiguates a second node's key when the derived key collides", async () => {
    const flows = new FakeFlowRepository();
    flows.seedVersion(flowVersionRowFixture());
    const createNode = new CreateFlowNode({ flows });
    const baseInput = {
      flowVersionId: "flowver_fixture_1",
      type: "Message" as const,
      title: "Welcome",
      canvasX: 0,
      canvasY: 0,
      messageText: "Hello",
      quickActionSetKey: null,
      slotName: null,
      optionSourceKind: null,
      optionSourceRef: null,
      staticOptionsJson: null,
      toolBindingId: null,
      retryCount: null,
      retryOnTimeout: null,
      timeoutMs: null,
      onFailureNodeId: null,
      handoverReason: null,
      confidenceThreshold: null,
      conditionExpression: null,
      requiredAssurance: null,
      now: NOW,
    };

    const first = await createNode.execute(baseInput);
    const second = await createNode.execute(baseInput);

    expect(first.ok && first.node.key).toBe("welcome");
    expect(second.ok && second.node.key).toBe("welcome_2");
  });
});
