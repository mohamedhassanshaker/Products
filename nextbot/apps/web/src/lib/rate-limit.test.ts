import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

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

describe("checkRateLimit (apps/web — conversation export rate limiter, Phase 13/BL-06)", () => {
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
    const result = await checkRateLimit("conversation-export:user-1", 10, 60);
    expect(result).toEqual({ allowed: true, remaining: 7, limit: 10 });
  });

  it("denies a request once the count exceeds the limit", async () => {
    incrMock.mockResolvedValue(11);
    const { checkRateLimit } = await import("./rate-limit.js");
    const result = await checkRateLimit("conversation-export:user-1", 10, 60);
    expect(result.allowed).toBe(false);
    expect(result.remaining).toBe(0);
  });

  it("fails open (allows the request) when Redis is unreachable, logging rather than throwing", async () => {
    incrMock.mockRejectedValue(new Error("ECONNREFUSED"));
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { checkRateLimit } = await import("./rate-limit.js");
    const result = await checkRateLimit("conversation-export:user-1", 10, 60);
    expect(result.allowed).toBe(true);
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it("namespaces every key under nextbot:ratelimit:", async () => {
    incrMock.mockResolvedValue(1);
    const { checkRateLimit } = await import("./rate-limit.js");
    await checkRateLimit("conversation-export:user-1", 10, 60);
    expect(incrMock).toHaveBeenCalledWith("nextbot:ratelimit:conversation-export:user-1");
  });
});
