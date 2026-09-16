/**
 * Next.js server instrumentation hook.
 *
 * Next.js calls `register()` once per server instance, before any route handler,
 * middleware or server action runs — see
 * https://nextjs.org/docs/app/building-your-application/optimizing/open-telemetry.
 * This is the explicit boot path for shj3-web's OpenTelemetry SDK
 * (architecture.md §10, deployment.md §13.1): starting it here means every request
 * is traced from the first one served, rather than the first one that happens to
 * touch the auth middleware or the AI client.
 *
 * `platform/observability/trace-context.ts`'s extraction and injection functions also
 * call `startTracing()` lazily on first use, so a request is never left untraced even
 * in a runner (a unit test, a script) that never calls `register()` — this hook is the
 * eager path, not the only one.
 */
export async function register(): Promise<void> {
  // Next.js loads instrumentation.ts in every runtime (nodejs, edge) it might run the
  // app in, but the OpenTelemetry Node SDK — and the mTLS/HTTP machinery its OTLP
  // exporter depends on — is Node-only. Guarding the import, rather than the call, is
  // what keeps an edge bundle from ever pulling the SDK in at all.
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startTracing } = await import("./modules/platform/observability/tracing.js");
    startTracing();
  }
}
