"use client";

import { useCallback, useEffect, useState } from "react";
import { Badge } from "@nextbot/ui/components/ui/badge";
import { Button } from "@nextbot/ui/components/ui/button";
import { Alert, AlertDescription } from "@nextbot/ui/components/ui/alert";
import { Skeleton } from "@nextbot/ui/components/ui/skeleton";
import { WARNING_BADGE_CLASS } from "@nextbot/ui/lib/status-badge";
import { fetchJson } from "@/src/lib/fetch-json";

export interface ChatPreviewPanelProps {
  /** The tenant's slug (matches `NextBot.init({ tenantId })`'s real, documented
   * `tenantId` value — a slug, not the tenant's DB id). */
  tenantSlug: string;
  /** The `WebWidget` channel's `publicKey` this preview mounts against. */
  channelPublicKey: string;
  /** Where this deployment's widget-embed static assets are served from — the same
   * value `GET /api/v1/admin/channels`'s `widgetBaseUrl` already resolves. */
  widgetBaseUrl: string;
  /**
   * Set ONLY for the "test in sandbox before promoting" mount (an agent version's
   * detail page) — omitted entirely for the "test this channel" mount (a channel's
   * own `/test` page), which uses that channel's real, currently-deployed Production
   * version, i.e. exactly what a live customer sees, no override, no admin token
   * needed. When set, this component fetches a fresh, short-lived sandbox-preview
   * token from the Admin Console's own `sandbox-preview-token` endpoint (which
   * re-derives the caller's `agent_platform: Write` permission from their real
   * session — never trusts anything this component itself asserts) before it will
   * mount the iframe at all. The actual authorization enforcement happens
   * server-side, in the Gateway Plane's widget session endpoint — this component
   * cannot itself grant or fake that authorization, it only carries the
   * already-issued proof through.
   */
  previewVersionId?: string;
}

/** Same "unicode-safe base64" encoding `apps/widget-embed`'s own loader uses for its
 * `config` query param (`nextbot-loader.ts`'s `encodeConfig`) — duplicated rather than
 * imported since `apps/web` and `apps/widget-embed` are separate deployables with no
 * shared runtime package for this one helper (same rationale as `apps/gateway`'s
 * duplicated `problemResponse`). */
function encodeWidgetConfig(config: Record<string, unknown>): string {
  const json = JSON.stringify(config);
  return btoa(encodeURIComponent(json).replace(/%([0-9A-F]{2})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16))));
}

/**
 * Phase 6 (client-feedback-batch item 9) — the shared chat-preview surface, mounted
 * both on an agent version's detail page ("Sandbox" tab) and on a channel's own
 * `/test` page. Deliberately an `<iframe>` onto the real, already-built
 * `apps/widget-embed` widget SPA (the exact same static bundle a real customer's
 * embed ultimately loads) rather than a parallel native re-implementation — see
 * `docs/plans/client-feedback-batch-plan.md`'s Phase 6 section for the full
 * rationale (CSS isolation + honest conversation-lifecycle fidelity).
 */
export function ChatPreviewPanel({ tenantSlug, channelPublicKey, widgetBaseUrl, previewVersionId }: ChatPreviewPanelProps) {
  const [nonce, setNonce] = useState(0);
  const [previewToken, setPreviewToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(Boolean(previewVersionId));

  const loadPreviewToken = useCallback(async () => {
    if (!previewVersionId) return;
    setLoading(true);
    setError(null);
    setPreviewToken(null);
    const result = await fetchJson<{ previewToken: string }>(
      `/api/v1/admin/agent-platform/versions/${previewVersionId}/sandbox-preview-token`,
      { method: "POST" },
    );
    setLoading(false);
    if (result.kind !== "ok") {
      setError(result.message);
      return;
    }
    setPreviewToken(result.data.previewToken);
  }, [previewVersionId]);

  useEffect(() => {
    void loadPreviewToken();
  }, [loadPreviewToken]);

  /** "Reload session" (both mount points): remounts the iframe under a fresh `key`
   * (a plain `src` change alone wouldn't force a real conversation restart, since the
   * widget's own resume-token logic could otherwise reconnect it). For a sandbox
   * preview, also fetches a brand-new preview token first — each test run gets its
   * own freshly-authorized, freshly-expiring credential rather than reusing
   * whatever this component happened to mint on first mount. */
  function reloadSession() {
    setNonce((n) => n + 1);
    if (previewVersionId) void loadPreviewToken();
  }

  if (previewVersionId && loading) {
    return <Skeleton className="h-[600px] w-full max-w-[420px]" role="status" aria-label="Preparing sandbox preview" />;
  }
  if (previewVersionId && error) {
    return (
      <Alert variant="destructive">
        <AlertDescription>Couldn&apos;t start a sandbox preview session: {error}</AlertDescription>
      </Alert>
    );
  }
  // Defensive — should not be reachable (loading/error are exhaustive above whenever
  // previewVersionId is set), but never renders a privileged iframe without a token.
  if (previewVersionId && !previewToken) return null;

  const base = widgetBaseUrl.endsWith("/") ? widgetBaseUrl.slice(0, -1) : widgetBaseUrl;
  const configPayload: Record<string, unknown> = previewVersionId ? { previewVersionId, previewToken } : {};
  const params = new URLSearchParams({
    tenantId: tenantSlug,
    channelId: channelPublicKey,
    config: encodeWidgetConfig(configPayload),
  });
  const src = `${base}/widget/index.html?${params.toString()}`;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        {/* Persistent, visually distinct badge — never confusable with a live
            customer's view of the widget, per this phase's explicit requirement. */}
        <Badge className={WARNING_BADGE_CLASS}>
          {previewVersionId ? "Sandbox preview — testing a version, not visible to real customers" : "Sandbox preview — internal test view"}
        </Badge>
        <Button size="xs" variant="outline" onClick={reloadSession}>
          Reload session
        </Button>
      </div>
      <div className="h-[600px] w-full max-w-[420px] overflow-hidden rounded-none border">
        <iframe key={nonce} src={src} title="NextBot chat preview" className="h-full w-full border-0" />
      </div>
    </div>
  );
}
