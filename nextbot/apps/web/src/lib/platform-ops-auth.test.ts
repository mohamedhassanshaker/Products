import { afterEach, describe, expect, it, vi } from "vitest";

// "server-only" throws outside a Next build — stubbed the same way every other
// apps/web unit test does (see build-brand-style-tag.test.ts's identical comment).
vi.mock("server-only", () => ({}));

const {
  isPlatformOpsConfigured,
  verifyOperatorToken,
  isIpAllowed,
  extractClientIp,
  isRequestFromAllowedNetwork,
} = await import("./platform-ops-auth.js");

const ORIGINAL_ENV = { ...process.env };
afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe("isPlatformOpsConfigured", () => {
  it("is false when either env var is missing", () => {
    delete process.env.NEXTBOT_OPS_OPERATOR_TOKEN;
    delete process.env.NEXTBOT_OPS_IP_ALLOWLIST;
    expect(isPlatformOpsConfigured()).toBe(false);

    process.env.NEXTBOT_OPS_OPERATOR_TOKEN = "secret";
    expect(isPlatformOpsConfigured()).toBe(false);
  });

  it("is false when either env var is set to an empty string", () => {
    process.env.NEXTBOT_OPS_OPERATOR_TOKEN = "";
    process.env.NEXTBOT_OPS_IP_ALLOWLIST = "10.0.0.0/8";
    expect(isPlatformOpsConfigured()).toBe(false);
  });

  it("is true when both are set to a non-empty value", () => {
    process.env.NEXTBOT_OPS_OPERATOR_TOKEN = "secret";
    process.env.NEXTBOT_OPS_IP_ALLOWLIST = "10.0.0.0/8";
    expect(isPlatformOpsConfigured()).toBe(true);
  });
});

describe("verifyOperatorToken", () => {
  it("accepts the exact configured token", () => {
    process.env.NEXTBOT_OPS_OPERATOR_TOKEN = "correct-horse-battery-staple";
    expect(verifyOperatorToken("correct-horse-battery-staple")).toBe(true);
  });

  it("rejects a wrong token", () => {
    process.env.NEXTBOT_OPS_OPERATOR_TOKEN = "correct-horse-battery-staple";
    expect(verifyOperatorToken("wrong-token")).toBe(false);
  });

  it("rejects a token of a different length than the configured one (no throw)", () => {
    process.env.NEXTBOT_OPS_OPERATOR_TOKEN = "correct-horse-battery-staple";
    expect(() => verifyOperatorToken("short")).not.toThrow();
    expect(verifyOperatorToken("short")).toBe(false);
  });

  it("rejects any candidate when unconfigured", () => {
    delete process.env.NEXTBOT_OPS_OPERATOR_TOKEN;
    expect(verifyOperatorToken("anything")).toBe(false);
  });

  it("rejects an empty candidate", () => {
    process.env.NEXTBOT_OPS_OPERATOR_TOKEN = "correct-horse-battery-staple";
    expect(verifyOperatorToken("")).toBe(false);
  });
});

describe("isIpAllowed (hand-rolled IPv4 CIDR matcher)", () => {
  it("matches an exact bare-IP entry", () => {
    expect(isIpAllowed("203.0.113.5", "203.0.113.5")).toBe(true);
    expect(isIpAllowed("203.0.113.6", "203.0.113.5")).toBe(false);
  });

  it("matches a /24 CIDR block", () => {
    expect(isIpAllowed("10.0.0.42", "10.0.0.0/24")).toBe(true);
    expect(isIpAllowed("10.0.1.42", "10.0.0.0/24")).toBe(false);
  });

  it("matches a /32 CIDR entry identically to a bare IP", () => {
    expect(isIpAllowed("10.0.0.1", "10.0.0.1/32")).toBe(true);
    expect(isIpAllowed("10.0.0.2", "10.0.0.1/32")).toBe(false);
  });

  it("a /0 entry matches every valid IPv4 address", () => {
    expect(isIpAllowed("1.2.3.4", "0.0.0.0/0")).toBe(true);
    expect(isIpAllowed("255.255.255.255", "0.0.0.0/0")).toBe(true);
  });

  it("checks every comma-separated entry", () => {
    const allowlist = "203.0.113.5, 10.0.0.0/24, 192.168.1.1/32";
    expect(isIpAllowed("10.0.0.99", allowlist)).toBe(true);
    expect(isIpAllowed("192.168.1.1", allowlist)).toBe(true);
    expect(isIpAllowed("192.168.1.2", allowlist)).toBe(false);
  });

  it("skips a malformed entry rather than failing the whole allowlist", () => {
    expect(isIpAllowed("10.0.0.5", "not-an-ip, 10.0.0.0/24")).toBe(true);
  });

  it("rejects a non-IPv4 (unparseable) caller address, e.g. the 'unknown' fallback", () => {
    expect(isIpAllowed("unknown", "0.0.0.0/0")).toBe(false);
  });

  it("rejects an octet out of range", () => {
    expect(isIpAllowed("10.0.0.5", "10.0.0.999/24")).toBe(false);
  });
});

describe("extractClientIp", () => {
  // QA retry 1, Defect 2 regression coverage: with no trusted reverse proxy
  // configured (this project's actual default — docker-compose exposes apps/web
  // directly, see platform-ops-auth.ts's getTrustedProxyCidrs doc comment),
  // X-Forwarded-For/X-Real-IP must never be trusted, no matter what a caller sets
  // them to — this is the exact mechanism QA used to bypass the IP allowlist
  // entirely (spoofing the header to present an allowed IP from a disallowed real
  // connection).
  describe("with no NEXTBOT_OPS_TRUSTED_PROXY_CIDRS configured (this project's default)", () => {
    it("never trusts a spoofed x-forwarded-for, however plausible-looking", () => {
      const headers = new Headers({ "x-forwarded-for": "203.0.113.5, 10.0.0.1" });
      expect(extractClientIp(headers)).toBe("unknown");
    });

    it("never trusts a spoofed x-real-ip either", () => {
      const headers = new Headers({ "x-real-ip": "203.0.113.9" });
      expect(extractClientIp(headers)).toBe("unknown");
    });

    it("returns 'unknown' when neither header is present", () => {
      expect(extractClientIp(new Headers())).toBe("unknown");
    });
  });

  describe("with NEXTBOT_OPS_TRUSTED_PROXY_CIDRS configured (a real reverse-proxy deployment)", () => {
    it("peels a trailing trusted-proxy hop and resolves the next hop as the real caller", () => {
      process.env.NEXTBOT_OPS_TRUSTED_PROXY_CIDRS = "10.0.0.5/32";
      // The trusted proxy (10.0.0.5) appended its own observed remote address
      // (203.0.113.5) to the right of the chain — standard X-Forwarded-For shape.
      const headers = new Headers({ "x-forwarded-for": "203.0.113.5, 10.0.0.5" });
      expect(extractClientIp(headers)).toBe("203.0.113.5");
    });

    it("fails closed when a trusted proxy is configured but sent neither header", () => {
      process.env.NEXTBOT_OPS_TRUSTED_PROXY_CIDRS = "10.0.0.0/24";
      expect(extractClientIp(new Headers())).toBe("unknown");
    });

    it("fails closed when EVERY hop is a trusted proxy, rather than guessing a caller", () => {
      // No client-supplied hop is present at all (a misconfiguration, or a
      // proxy-to-proxy health check). Returning any of the trusted hops would hand the
      // allowlist a caller IP nobody actually claimed — so this resolves to "unknown",
      // which fails `isIpAllowed` unconditionally.
      process.env.NEXTBOT_OPS_TRUSTED_PROXY_CIDRS = "10.0.0.0/24";
      const headers = new Headers({ "x-forwarded-for": "10.0.0.5, 10.0.0.9" });
      expect(extractClientIp(headers)).toBe("unknown");
    });

    it("peels multiple trailing trusted hops (proxy chain), not just one", () => {
      process.env.NEXTBOT_OPS_TRUSTED_PROXY_CIDRS = "10.0.0.0/24";
      const headers = new Headers({ "x-forwarded-for": "203.0.113.5, 10.0.0.5, 10.0.0.9" });
      expect(extractClientIp(headers)).toBe("203.0.113.5");
    });

    it("never trusts the naive leftmost entry when it isn't preceded only by trusted hops", () => {
      process.env.NEXTBOT_OPS_TRUSTED_PROXY_CIDRS = "10.0.0.5/32";
      // An attacker reaching the trusted proxy could still prepend an arbitrary
      // fake hop *before* their own real, disallowed address — peeling from the
      // right must resolve to their real address (203.0.113.99), never to
      // whatever they prepended (203.0.113.1, an "allowed-looking" spoof).
      const headers = new Headers({ "x-forwarded-for": "203.0.113.1, 203.0.113.99, 10.0.0.5" });
      expect(extractClientIp(headers)).toBe("203.0.113.99");
    });

    it("falls back to x-real-ip when x-forwarded-for is absent", () => {
      process.env.NEXTBOT_OPS_TRUSTED_PROXY_CIDRS = "10.0.0.5/32";
      const headers = new Headers({ "x-real-ip": "203.0.113.9" });
      expect(extractClientIp(headers)).toBe("203.0.113.9");
    });

    it("returns 'unknown' when every hop matches a trusted-proxy CIDR (no client hop present)", () => {
      process.env.NEXTBOT_OPS_TRUSTED_PROXY_CIDRS = "10.0.0.0/24";
      const headers = new Headers({ "x-forwarded-for": "10.0.0.5, 10.0.0.9" });
      expect(extractClientIp(headers)).toBe("unknown");
    });
  });
});

describe("isRequestFromAllowedNetwork", () => {
  it("is false when unconfigured, regardless of IP", () => {
    delete process.env.NEXTBOT_OPS_OPERATOR_TOKEN;
    delete process.env.NEXTBOT_OPS_IP_ALLOWLIST;
    const headers = new Headers({ "x-forwarded-for": "10.0.0.1" });
    expect(isRequestFromAllowedNetwork(headers)).toBe(false);
  });

  // QA retry 1, Defect 2's core regression test: reproduces the exact exploit QA
  // demonstrated (a disallowed real connection sets X-Forwarded-For to an allowed
  // IP directly) against this project's actual default deployment config (no
  // trusted proxy configured) and proves it no longer bypasses the allowlist.
  it("no longer bypasses the allowlist via a spoofed X-Forwarded-For (QA retry 1, Defect 2)", () => {
    process.env.NEXTBOT_OPS_OPERATOR_TOKEN = "secret";
    process.env.NEXTBOT_OPS_IP_ALLOWLIST = "10.0.0.0/24";
    delete process.env.NEXTBOT_OPS_TRUSTED_PROXY_CIDRS;
    // A caller with no legitimate path to 10.0.0.x simply claims to be 10.0.0.5.
    expect(isRequestFromAllowedNetwork(new Headers({ "x-forwarded-for": "10.0.0.5" }))).toBe(false);
  });

  it("is true only for an allowed IP once both the allowlist and a trusted proxy are configured", () => {
    process.env.NEXTBOT_OPS_OPERATOR_TOKEN = "secret";
    process.env.NEXTBOT_OPS_IP_ALLOWLIST = "10.0.0.0/24";
    process.env.NEXTBOT_OPS_TRUSTED_PROXY_CIDRS = "192.168.1.1/32";
    expect(isRequestFromAllowedNetwork(new Headers({ "x-forwarded-for": "10.0.0.5, 192.168.1.1" }))).toBe(true);
    expect(isRequestFromAllowedNetwork(new Headers({ "x-forwarded-for": "10.0.1.5, 192.168.1.1" }))).toBe(false);
  });
});
