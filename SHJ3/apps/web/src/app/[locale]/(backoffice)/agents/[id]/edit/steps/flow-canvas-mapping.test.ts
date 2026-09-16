import { describe, expect, it } from "vitest";
import {
  CANVAS_KEY_NODE_TYPE,
  NODE_TYPE_CANVAS_KEY,
  buildFlowCanvasModel,
  mapFlowEdgeRowToCanvasConnection,
  mapFlowNodeRowToCanvasNode,
} from "./flow-canvas-mapping.js";
import type {
  FlowEdgeRow,
  FlowNodeRow,
} from "../../../../../../../modules/flows/ports/flow-repository.js";

const now = new Date("2026-09-10T00:00:00.000Z");

function messageNode(overrides: Partial<FlowNodeRow> = {}): FlowNodeRow {
  return {
    id: "node-1",
    flowVersionId: "version-1",
    key: "n1",
    type: "Message",
    title: "Greeting",
    canvasX: 0,
    canvasY: 0,
    messageText: "Hello!",
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
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function edge(overrides: Partial<FlowEdgeRow> = {}): FlowEdgeRow {
  return {
    id: "edge-1",
    flowVersionId: "version-1",
    fromNodeId: "node-1",
    toNodeId: "node-2",
    label: null,
    ordinal: 0,
    conditionExpression: null,
    isDefaultBranch: false,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe("NODE_TYPE_CANVAS_KEY", () => {
  it("maps every real FlowNodeType onto the canvas's lowercase vocabulary", () => {
    expect(NODE_TYPE_CANVAS_KEY).toEqual({
      Message: "message",
      Question: "question",
      ToolCall: "tool-call",
      Handover: "handover",
      Condition: "condition",
    });
  });
});

describe("mapFlowNodeRowToCanvasNode", () => {
  it("carries id/title through and derives the canvas type + real summary", () => {
    const node = mapFlowNodeRowToCanvasNode(messageNode());
    expect(node).toEqual({
      id: "node-1",
      type: "message",
      title: "Greeting",
      summary: "Hello!",
      x: 0,
      y: 0,
    });
  });

  it("summarizes a ToolCall node the same way the real node table did", () => {
    const node = mapFlowNodeRowToCanvasNode(
      messageNode({ type: "ToolCall", retryCount: 2, title: "Fetch bill" }),
    );
    expect(node.type).toBe("tool-call");
    expect(node.summary).toBe("Retries 2x on failure");
  });

  it("carries the real canvasX/canvasY columns through as the graphical canvas's x/y", () => {
    const node = mapFlowNodeRowToCanvasNode(messageNode({ canvasX: 240, canvasY: 160 }));
    expect(node.x).toBe(240);
    expect(node.y).toBe(160);
  });
});

describe("CANVAS_KEY_NODE_TYPE", () => {
  it("is the exact inverse of NODE_TYPE_CANVAS_KEY", () => {
    expect(CANVAS_KEY_NODE_TYPE).toEqual({
      message: "Message",
      question: "Question",
      "tool-call": "ToolCall",
      handover: "Handover",
      condition: "Condition",
    });
  });
});

describe("mapFlowEdgeRowToCanvasConnection", () => {
  it("renames fromNodeId/toNodeId to sourceId/targetId and omits branchLabel when label is null", () => {
    const connection = mapFlowEdgeRowToCanvasConnection(edge());
    expect(connection).toEqual({
      id: "edge-1",
      sourceId: "node-1",
      targetId: "node-2",
      isDefaultBranch: false,
    });
    expect("branchLabel" in connection).toBe(false);
  });

  it("carries a real label through as branchLabel", () => {
    const connection = mapFlowEdgeRowToCanvasConnection(edge({ label: "Yes" }));
    expect(connection.branchLabel).toBe("Yes");
  });

  it("carries the real isDefaultBranch column through verbatim, for the canvas's dashed fallback-branch line", () => {
    expect(mapFlowEdgeRowToCanvasConnection(edge({ isDefaultBranch: true })).isDefaultBranch).toBe(
      true,
    );
    expect(mapFlowEdgeRowToCanvasConnection(edge({ isDefaultBranch: false })).isDefaultBranch).toBe(
      false,
    );
  });
});

describe("buildFlowCanvasModel", () => {
  it("maps every node and edge into one FlowModel", () => {
    const model = buildFlowCanvasModel(
      [messageNode(), messageNode({ id: "node-2", title: "Follow-up" })],
      [edge({ label: "Next" })],
    );
    expect(model.nodes).toHaveLength(2);
    expect(model.connections).toEqual([
      {
        id: "edge-1",
        sourceId: "node-1",
        targetId: "node-2",
        branchLabel: "Next",
        isDefaultBranch: false,
      },
    ]);
  });
});
