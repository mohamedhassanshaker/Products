import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const incrMock = vi.fn();
const expireMock = vi.fn();
const onMock = vi.fn();
const quitMock = vi.fn().mockResolvedValue(undefined);

vi.mock("ioredis", () => {
  return {
    default: class FakeRedis {
      incr = incrMock;
      expire = expireMock;
      on = onMock;
      quit = quitMock;
    },
  };
});

describe("checkRateLimit (BE2 fix-pass fixed-window rate limiter)", () => {
  beforeEach(() => {
    incrMock.mockReset();
    expireMock.mockReset().mockResolvedValue(1);
    onMock.mockReset();
    quitMock.mockClear();
  });
  afterEach(async () => {
    const { _resetRateLimitClientForTests } = await import("./rate-limit.js");
    await _resetRateLimitClientForTests();
  });

  it("allows a request under the limit and reports remaining capacity", async () => {
    incrMock.mockResolvedValue(3);
    const { checkRateLimit } = await import("./rate-limit.js");
    const result = await checkRateLimit("widget-session:1.2.3.4", 20, 60);
    expect(result).toEqual({ allowed: true, remaining: 17, limit: 20 });
  });

  it("sets a TTL only on the increment that creates the key (count === 1)", async () => {
    incrMock.mockResolvedValue(1);
    const { checkRateLimit } = await import("./rate-limit.js");
    await checkRateLimit("widget-session:1.2.3.4", 20, 60);
    expect(expireMock).toHaveBeenCalledWith(expect.stringContaining("widget-session:1.2.3.4"), 60);
  });

  it("does not re-set the TTL on subsequent increments within the same window", async () => {
    incrMock.mockResolvedValue(5);
    const { checkRateLimit } = await import("./rate-limit.js");
    await checkRateLimit("widget-session:1.2.3.4", 20, 60);
    expect(expireMock).not.toHaveBeenCalled();
  });

  it("denies a request once the count exceeds the limit (the exact defect QA reproduced: 100/100 concurrent creates previously all succeeded)", async () => {
    incrMock.mockResolvedValue(21);
    const { checkRateLimit } = await import("./rate-limit.js");
    const result = await checkRateLimit("widget-session:1.2.3.4", 20, 60);
    expect(result.allowed).toBe(false);
    expect(result.remaining).toBe(0);
  });

  it("fails open (allows the request) when Redis is unreachable, logging the failure rather than throwing into the request path", async () => {
    incrMock.mockRejectedValue(new Error("ECONNREFUSED"));
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { checkRateLimit } = await import("./rate-limit.js");
    const result = await checkRateLimit("widget-session:1.2.3.4", 20, 60);
    expect(result.allowed).toBe(true);
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it("namespaces every key under nextbot:ratelimit: so it's distinguishable from any other Redis use", async () => {
    incrMock.mockResolvedValue(1);
    const { checkRateLimit } = await import("./rate-limit.js");
    await checkRateLimit("widget-message:conv-1", 30, 60);
    expect(incrMock).toHaveBeenCalledWith("nextbot:ratelimit:widget-message:conv-1");
  });
});
