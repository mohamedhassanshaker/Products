"use client";

import { useEffect, useState } from "react";
import NextLink from "next/link";
import { Alert, AlertDescription } from "@nextbot/ui/components/ui/alert";
import { Skeleton } from "@nextbot/ui/components/ui/skeleton";
import { AccessDeniedState } from "@nextbot/ui";
import { fetchJson } from "@/src/lib/fetch-json";
import { ChatPreviewPanel } from "@/src/components/ChatPreviewPanel";

interface ChannelData {
  id: string;
  type: string;
  name: string;
  publicKey: string;
}

/**
 * "Test this channel" (Phase 6, client-feedback-batch item 9) — a standalone preview
 * of exactly what a real customer sees on this channel right now: the channel's own
 * real, currently-deployed Production version, with **no** sandbox-preview override
 * and **no** admin-token round trip (unlike the version-detail Sandbox tab). This is
 * intentionally the same real widget bundle/session flow any real embed uses.
 */
export function ChannelTest({ channelId }: { channelId: string }) {
  const [data, setData] = useState<{ channel: ChannelData; tenantSlug: string; widgetBaseUrl: string } | null | undefined>(undefined);
  const [forbidden, setForbidden] = useState(false);

  useEffect(() => {
    void (async () => {
      const result = await fetchJson<{ channel: ChannelData; tenantSlug: string; widgetBaseUrl: string }>(
        `/api/v1/admin/channels/${channelId}`,
      );
      if (result.kind === "forbidden") {
        setForbidden(true);
        return;
      }
      setData(result.kind === "ok" ? result.data : null);
    })();
  }, [channelId]);

  if (forbidden) return <AccessDeniedState moduleLabel="Channels" />;

  return (
    <div>
      <p className="mb-2 text-sm text-muted-foreground">
        <NextLink href="/channels" className="hover:underline">
          Channels
        </NextLink>
        {data?.channel ? ` > ${data.channel.name} > Test` : ""}
      </p>
      <h1 className="mb-6 font-heading text-lg font-semibold">Test this channel</h1>

      {data === undefined ? (
        <Skeleton className="h-[600px] w-full max-w-[420px]" role="status" aria-label="Loading channel" />
      ) : data === null ? (
        <Alert variant="destructive">
          <AlertDescription>Channel not found.</AlertDescription>
        </Alert>
      ) : data.channel.type !== "WebWidget" ? (
        <Alert variant="warning">
          <AlertDescription>The chat preview only supports Web Widget channels — this is a {data.channel.type} channel.</AlertDescription>
        </Alert>
      ) : (
        <ChatPreviewPanel tenantSlug={data.tenantSlug} channelPublicKey={data.channel.publicKey} widgetBaseUrl={data.widgetBaseUrl} />
      )}
    </div>
  );
}
