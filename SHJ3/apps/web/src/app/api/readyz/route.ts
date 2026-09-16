import { NextResponse } from "next/server";
import { ConfigurationError, loadConfig } from "../../../modules/platform/config.js";

/**
 * Readiness probe.
 *
 * `shj3-web` has no equivalent of `shj3-ai`'s concurrency ceiling — checked
 * before writing this, not assumed: there is no `SHJ3_WEB_MAX_CONCURRENT_*`
 * (or similarly-named) config constant anywhere in this codebase, and
 * deployment.md never asks for one. That asymmetry is real, not an
 * oversight — `shj3-web` serves short request/response BFF traffic (§7.3:
 * "sub-100 ms, CPU-light"), not the long-held, streamed conversation turns
 * `shj3-ai` shed load for; there is no per-pod "turn" concept here to count.
 * So this readiness check is deliberately simpler, per the Kubernetes/Helm
 * brief's own suggestion: "just confirming the process can reach its own
 * config."
 *
 * `loadConfig()` (`modules/platform/config.ts`) is a real, non-trivial check
 * here, not a rubber stamp — it is the same boot-time validator that already
 * refuses to start the process on a missing secret or an illegal
 * mock-verification-adapter-in-production combination (ADR-0006 rule 6), and
 * nothing in this app currently calls it eagerly at process start (no
 * `instrumentation.ts` hook does — confirmed by search). So the first real
 * request to this route in a freshly started process may be the first time
 * `loadConfig()` genuinely runs, which is exactly what a readiness probe
 * should be proving: not "did some unrelated request happen to warm this
 * path," but "can this process actually do the one config-dependent thing
 * every other route needs." The result is memoised (`loadConfig`'s own
 * contract), so this costs nothing on every probe after the first.
 *
 * `ConfigurationError.problems` is safe to return here: by `config.ts`'s own
 * documented contract it carries only variable *names*, never values — "an
 * operator at 2am needs `SHJ3_SESSION_SECRET is missing`... not a formatted
 * issue tree" containing the secret it is complaining about. A caller other
 * than the Kubernetes readinessProbe (which only reads the status code)
 * hitting this directly gets a genuinely diagnosable body, not a generic 503.
 *
 * Any error that is NOT a `ConfigurationError` is rethrown rather than
 * swallowed into a 503 — an unexpected exception here is a real bug in this
 * route or in `loadConfig()` itself, and reporting it as an ordinary
 * "not ready" would hide that behind the one error shape this route already
 * expects and knows how to explain.
 */
export function GET(): NextResponse {
  try {
    loadConfig();
  } catch (error) {
    if (error instanceof ConfigurationError) {
      return NextResponse.json({ status: "not_ready", problems: error.problems }, { status: 503 });
    }
    throw error;
  }
  return NextResponse.json({ status: "ok" });
}
