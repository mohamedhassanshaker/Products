import { describe, expect, it } from "vitest";
import {
  API_CONNECTOR_AUTH_MODES,
  isApiConnectorAuthMode,
  isApiConnectorMethod,
  isApiConnectorTestState,
  isMcpAuthMode,
  isMcpConnectionState,
  isMcpTransport,
  isRateLimitScope,
  isRequiredAssuranceLevel,
  isSkillInvocationKind,
  isToolBindingTargetKind,
} from "./tool-catalog.js";

describe("skill invocation kind", () => {
  it("accepts the three real values", () => {
    expect(isSkillInvocationKind("Native")).toBe(true);
    expect(isSkillInvocationKind("ApiConnector")).toBe(true);
    expect(isSkillInvocationKind("McpTool")).toBe(true);
    expect(isSkillInvocationKind("Composite")).toBe(false);
  });
});

describe("MCP enums", () => {
  it("transport", () => {
    expect(isMcpTransport("StreamableHttp")).toBe(true);
    expect(isMcpTransport("WebSocket")).toBe(false);
  });

  it("auth mode", () => {
    expect(isMcpAuthMode("MutualTls")).toBe(true);
    expect(isMcpAuthMode("Basic")).toBe(false);
  });

  it("connection state", () => {
    expect(isMcpConnectionState("Connected")).toBe(true);
    expect(isMcpConnectionState("Connecting")).toBe(false);
  });
});

describe("API connector enums", () => {
  it("auth mode has no MutualTls, unlike MCP", () => {
    expect(API_CONNECTOR_AUTH_MODES).toEqual(["OAuth2ClientCredentials", "ApiKey", "None"]);
    expect(isApiConnectorAuthMode("MutualTls")).toBe(false);
  });

  it("method", () => {
    expect(isApiConnectorMethod("PATCH")).toBe(true);
    expect(isApiConnectorMethod("HEAD")).toBe(false);
  });

  it("test state", () => {
    expect(isApiConnectorTestState("Untested")).toBe(true);
    expect(isApiConnectorTestState("Passed")).toBe(false);
  });
});

describe("tool binding enums", () => {
  it("target kind", () => {
    expect(isToolBindingTargetKind("McpTool")).toBe(true);
    expect(isToolBindingTargetKind("Flow")).toBe(false);
  });

  it("required assurance", () => {
    expect(isRequiredAssuranceLevel("VerifiedPlusOtp")).toBe(true);
    expect(isRequiredAssuranceLevel("Elevated")).toBe(false);
  });
});

describe("rate limit scope", () => {
  it("accepts the four real values", () => {
    expect(isRateLimitScope("PerAgent")).toBe(true);
    expect(isRateLimitScope("Global")).toBe(false);
  });
});
