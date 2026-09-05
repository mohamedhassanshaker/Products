import { afterEach, describe, expect, it } from "vitest";
import { startMockMcpServer, type MockMcpServerHandle } from "@nextbot/testing";
import { callTool, ToolArgsInvalidError, ToolResultInvalidError } from "./call-tool.js";

const inputSchema = { type: "object", properties: { ticketId: { type: "string" } }, required: ["ticketId"] };
const outputSchema = { type: "object", properties: { status: { type: "string" } }, required: ["status"] };

describe("callTool (Ajv-validated both directions, LLD §1.1)", () => {
  let handle: MockMcpServerHandle | undefined;

  afterEach(async () => {
    await handle?.close();
    handle = undefined;
  });

  it("calls the tool and validates a matching result", async () => {
    handle = await startMockMcpServer([
      { name: "get_ticket", inputSchema, outputSchema, result: { status: "open" } },
    ]);
    const result = await callTool("get_ticket", { ticketId: "T-1" }, { inputSchema, outputSchema }, { endpointUrl: handle.url });
    expect(result).toEqual({ status: "open" });
  });

  it("rejects before calling the server when args fail input schema validation", async () => {
    handle = await startMockMcpServer([{ name: "get_ticket", inputSchema, outputSchema }]);
    await expect(
      callTool("get_ticket", { wrongField: 1 }, { inputSchema, outputSchema }, { endpointUrl: handle.url }),
    ).rejects.toThrow(ToolArgsInvalidError);
  });

  it("rejects when the server's result fails output schema validation", async () => {
    handle = await startMockMcpServer([{ name: "get_ticket", inputSchema, outputSchema, result: { wrongField: 1 } }]);
    await expect(
      callTool("get_ticket", { ticketId: "T-1" }, { inputSchema, outputSchema }, { endpointUrl: handle.url }),
    ).rejects.toThrow(ToolResultInvalidError);
  });
});
