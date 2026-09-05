import { describe, expect, it, vi, beforeEach } from "vitest";

const buildSsoLoginUrlMock = vi.fn();
const completeOidcLoginMock = vi.fn();
const completeSamlLoginMock = vi.fn();

vi.mock("../application/sso-login.js", () => ({
  buildSsoLoginUrl: (...a: unknown[]) => buildSsoLoginUrlMock(...a),
  completeOidcLogin: (...a: unknown[]) => completeOidcLoginMock(...a),
  completeSamlLogin: (...a: unknown[]) => completeSamlLoginMock(...a),
}));

describe("iam http/sso-login-routes (unit, mocked application layer)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("handleSsoLoginStart forwards tenantSlug + input to buildSsoLoginUrl", async () => {
    buildSsoLoginUrlMock.mockResolvedValue({ url: "https://idp/auth", protocol: "Oidc" });
    const { handleSsoLoginStart } = await import("./sso-login-routes.js");
    const input = { oidcCallbackUrl: "cb1", samlCallbackUrl: "cb2", state: "s", nonce: "n" };
    const result = await handleSsoLoginStart("acme", input);
    expect(buildSsoLoginUrlMock).toHaveBeenCalledWith("acme", input);
    expect(result).toEqual({ url: "https://idp/auth", protocol: "Oidc" });
  });

  it("handleOidcCallback forwards tenantSlug + input to completeOidcLogin", async () => {
    completeOidcLoginMock.mockResolvedValue({ sessionToken: "tok" });
    const { handleOidcCallback } = await import("./sso-login-routes.js");
    const input = { currentUrl: new URL("https://app/callback?code=1"), expectedState: "s", expectedNonce: "n" };
    await handleOidcCallback("acme", input);
    expect(completeOidcLoginMock).toHaveBeenCalledWith("acme", input);
  });

  it("handleSamlCallback forwards tenantSlug + input to completeSamlLogin", async () => {
    completeSamlLoginMock.mockResolvedValue({ sessionToken: "tok" });
    const { handleSamlCallback } = await import("./sso-login-routes.js");
    const input = { callbackUrl: "cb", body: { SAMLResponse: "x", RelayState: "y" } };
    await handleSamlCallback("acme", input);
    expect(completeSamlLoginMock).toHaveBeenCalledWith("acme", input);
  });
});
