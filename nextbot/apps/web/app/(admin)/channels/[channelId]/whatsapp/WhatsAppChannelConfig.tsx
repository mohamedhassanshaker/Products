"use client";

import { useCallback, useEffect, useState } from "react";
import { Button, buttonVariants } from "@nextbot/ui/components/ui/button";
import { Input } from "@nextbot/ui/components/ui/input";
import { Label } from "@nextbot/ui/components/ui/label";
import { FieldHint } from "@nextbot/ui/components/ui/field-hint";
import { Switch } from "@nextbot/ui/components/ui/switch";
import { Textarea } from "@nextbot/ui/components/ui/textarea";
import { Alert, AlertDescription } from "@nextbot/ui/components/ui/alert";
import { Skeleton } from "@nextbot/ui/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@nextbot/ui/components/ui/tabs";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@nextbot/ui/components/ui/table";
import { StatusBadge, AccessDeniedState, type StatusTone } from "@nextbot/ui";
import { cn } from "@nextbot/ui/lib/utils";
import { fetchJson } from "../../../../../src/lib/fetch-json";
import type {
  ConsentRecordDto,
  MetaBusinessAccountDto,
  WhatsAppNumberDto,
  WhatsAppTemplateDto,
  ConsentImportResult,
  WhatsAppWebhookStatusDto,
} from "@nextbot/contracts";

const ACCOUNT_STATUS_TONE: Record<MetaBusinessAccountDto["status"], StatusTone> = {
  Connected: "connected",
  Unreachable: "degraded",
  Disconnected: "offline",
};

const TEMPLATE_STATUS_TONE: Record<WhatsAppTemplateDto["status"], StatusTone> = {
  Approved: "connected",
  Pending: "degraded",
  Rejected: "offline",
};

const TIER_INDEX: Record<WhatsAppNumberDto["messagingTier"], number> = { Tier1: 1, Tier2: 2, Tier3: 3, Tier4: 4 };

/** QA D1 fix: Webhook tab's verification-status badge tones. */
const WEBHOOK_VERIFICATION_TONE: Record<WhatsAppWebhookStatusDto["verificationStatus"], StatusTone> = {
  Verified: "connected",
  Pending: "degraded",
  Failed: "offline",
};

/**
 * WhatsApp Channel Connector Config (screen inventory B.2.3, FR-META-01 through
 * META-13, UX_GUIDELINES.md §7.2). One scrollable screen with independently
 * loadable/saveable tabs — mirrors how a real WABA gets configured incrementally.
 */
export function WhatsAppChannelConfig({ channelId, canWrite }: { channelId: string; canWrite: boolean }) {
  const [account, setAccount] = useState<MetaBusinessAccountDto | null>(null);
  const [readiness, setReadiness] = useState<{ ready: boolean; reasons: string[] } | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    const result = await fetchJson<{ account: MetaBusinessAccountDto | null; readiness: { ready: boolean; reasons: string[] } }>(
      `/api/v1/admin/channels/${channelId}/whatsapp`,
    );
    if (result.kind === "forbidden") {
      setForbidden(true);
      setLoading(false);
      return;
    }
    if (result.kind === "ok") {
      setAccount(result.data.account);
      setReadiness(result.data.readiness);
    }
    setLoading(false);
  }, [channelId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  if (forbidden) return <AccessDeniedState moduleLabel="Channels" />;
  if (loading) return <Skeleton className="h-32 w-full" role="status" aria-label="Loading WhatsApp channel config" />;

  const connected = account?.status === "Connected";

  return (
    <div className="max-w-4xl">
      <h1 className="mb-2 font-heading text-lg font-semibold">WhatsApp Channel</h1>
      {readiness && !readiness.ready && (
        <Alert variant="warning" className="mb-4">
          <AlertDescription>Not ready to activate: {readiness.reasons.join(" ")}</AlertDescription>
        </Alert>
      )}
      {readiness?.ready && (
        <Alert className="mb-4">
          <AlertDescription className="flex items-center justify-between">
            <span>Ready to activate.</span>
            <Button
              size="sm"
              disabled={!canWrite}
              onClick={async () => {
                await fetch(`/api/v1/admin/channels/${channelId}/whatsapp/activate`, { method: "POST" });
                await reload();
              }}
            >
              Activate channel
            </Button>
          </AlertDescription>
        </Alert>
      )}

      <Tabs defaultValue="meta">
        <TabsList className="overflow-x-auto">
          <TabsTrigger id="whatsapp-config-tab-meta" panelId="whatsapp-config-panel-meta" value="meta">Meta Connection</TabsTrigger>
          <TabsTrigger id="whatsapp-config-tab-waba" panelId="whatsapp-config-panel-waba" value="waba">WABA &amp; Numbers</TabsTrigger>
          <TabsTrigger id="whatsapp-config-tab-credentials" panelId="whatsapp-config-panel-credentials" value="credentials">Credentials</TabsTrigger>
          <TabsTrigger id="whatsapp-config-tab-webhook" panelId="whatsapp-config-panel-webhook" value="webhook">Webhook</TabsTrigger>
          <TabsTrigger id="whatsapp-config-tab-templates" panelId="whatsapp-config-panel-templates" value="templates">Templates</TabsTrigger>
          <TabsTrigger id="whatsapp-config-tab-consent" panelId="whatsapp-config-panel-consent" value="consent">Consent</TabsTrigger>
        </TabsList>
        <TabsContent id="whatsapp-config-panel-meta" value="meta">
          <MetaConnectionSection channelId={channelId} account={account} canWrite={canWrite} onChange={reload} />
        </TabsContent>
        <TabsContent id="whatsapp-config-panel-waba" value="waba">
          {connected ? <WabaSection channelId={channelId} account={account} canWrite={canWrite} onChange={reload} /> : <NotConnectedGate />}
        </TabsContent>
        <TabsContent id="whatsapp-config-panel-credentials" value="credentials">
          {connected ? <CredentialsSection channelId={channelId} account={account} canWrite={canWrite} /> : <NotConnectedGate />}
        </TabsContent>
        <TabsContent id="whatsapp-config-panel-webhook" value="webhook">{connected ? <WebhookSection channelId={channelId} canWrite={canWrite} /> : <NotConnectedGate />}</TabsContent>
        <TabsContent id="whatsapp-config-panel-templates" value="templates">
          {connected ? <TemplatesSection channelId={channelId} canWrite={canWrite} /> : <NotConnectedGate />}
        </TabsContent>
        <TabsContent id="whatsapp-config-panel-consent" value="consent">{connected ? <ConsentSection channelId={channelId} canWrite={canWrite} /> : <NotConnectedGate />}</TabsContent>
      </Tabs>
    </div>
  );
}

function NotConnectedGate() {
  return (
    <div className="rounded-none bg-muted p-4">
      <p className="text-muted-foreground">Connect Meta Business Manager above to configure this section.</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 7.2.1 Meta Business Manager OAuth link
// ---------------------------------------------------------------------------

function MetaConnectionSection({
  channelId,
  account,
  canWrite,
  onChange,
}: {
  channelId: string;
  account: MetaBusinessAccountDto | null;
  canWrite: boolean;
  onChange: () => void;
}) {
  const [form, setForm] = useState({ businessId: "", businessName: "", systemUserToken: "", appId: "", appSecret: "" });
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function connect() {
    setSubmitting(true);
    setError(null);
    const res = await fetch(`/api/v1/admin/channels/${channelId}/whatsapp`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(form),
    });
    setSubmitting(false);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.title ?? "Failed to connect.");
      return;
    }
    onChange();
  }

  async function disconnect() {
    await fetch(`/api/v1/admin/channels/${channelId}/whatsapp`, { method: "DELETE" });
    onChange();
  }

  if (!account) {
    return (
      <div className="flex max-w-md flex-col gap-4">
        <p className="text-muted-foreground">
          Links your WhatsApp Business Account, Messenger Page, and Instagram professional account through one Meta
          OAuth grant.
        </p>
        <p className="text-sm text-muted-foreground">
          No real Meta App is configured in this environment — connect using a System User token issued directly from
          Meta Business Manager (Business Settings → System Users), plus your App ID/Secret from Meta&apos;s Developer
          Console.
        </p>
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-1">
            <Label htmlFor="whatsapp-meta-business-id">Meta Business ID*</Label>
            <FieldHint
              id="whatsapp-meta-business-id-hint"
              content="The numeric Business ID from Meta Business Manager (Business Settings > Business Info) that owns the WABA this channel will connect to — not the WABA ID itself, which is set separately once connected."
            />
          </div>
          <Input
            id="whatsapp-meta-business-id"
            value={form.businessId}
            onChange={(e) => setForm({ ...form, businessId: e.target.value })}
            disabled={!canWrite}
          />
        </div>
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-1">
            <Label htmlFor="whatsapp-meta-business-name">Business name*</Label>
            <FieldHint
              id="whatsapp-meta-business-name-hint"
              content="A display-only label for this connection shown back to admins on this screen — not sent to Meta and not required to match the business name registered on the Meta side."
            />
          </div>
          <Input
            id="whatsapp-meta-business-name"
            value={form.businessName}
            onChange={(e) => setForm({ ...form, businessName: e.target.value })}
            disabled={!canWrite}
          />
        </div>
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-1">
            <Label htmlFor="whatsapp-meta-system-user-token">System User access token*</Label>
            <FieldHint
              id="whatsapp-meta-system-user-token-hint"
              content="A long-lived token issued from Meta Business Manager's Business Settings > System Users — used for every server-to-server call this channel makes to the WhatsApp Cloud API (numbers, templates, messages). Vaulted on save; rotate it from the Credentials tab once connected."
            />
          </div>
          <Input
            id="whatsapp-meta-system-user-token"
            type="password"
            value={form.systemUserToken}
            onChange={(e) => setForm({ ...form, systemUserToken: e.target.value })}
            disabled={!canWrite}
          />
        </div>
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-1">
            <Label htmlFor="whatsapp-meta-app-id">App ID*</Label>
            <FieldHint
              id="whatsapp-meta-app-id-hint"
              content="The Meta Developer Console App ID paired with the App Secret below — identifies which Meta app this channel's webhook and API calls are attributed to."
            />
          </div>
          <Input id="whatsapp-meta-app-id" value={form.appId} onChange={(e) => setForm({ ...form, appId: e.target.value })} disabled={!canWrite} />
        </div>
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-1">
            <Label htmlFor="whatsapp-meta-app-secret">App Secret*</Label>
            <FieldHint
              id="whatsapp-meta-app-secret-hint"
              content="Used to verify that inbound webhook payloads genuinely came from Meta (signature check) — vaulted on save and never displayed again in plaintext; rotate it from the Credentials tab once connected."
            />
          </div>
          <Input
            id="whatsapp-meta-app-secret"
            type="password"
            value={form.appSecret}
            onChange={(e) => setForm({ ...form, appSecret: e.target.value })}
            disabled={!canWrite}
          />
        </div>
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        <Button onClick={connect} disabled={submitting || !canWrite} className="self-start">
          {submitting ? "Connecting…" : "Connect Meta Business Manager"}
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div>
        <StatusBadge tone={ACCOUNT_STATUS_TONE[account.status]} label={account.status} />
      </div>
      <p>
        <strong>{account.businessName}</strong> · <code>{account.businessId}</code>
      </p>
      {account.status === "Unreachable" && (
        <Alert variant="warning">
          <AlertDescription>The last health check against Meta failed. Reconnect to restore this connection.</AlertDescription>
        </Alert>
      )}
      <div className="flex gap-2">
        <Button size="sm" onClick={connect} disabled={!canWrite}>
          Reconnect
        </Button>
        <Button size="sm" variant="outline" className="text-destructive" onClick={disconnect} disabled={!canWrite}>
          Disconnect
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 7.2.2 WABA config + phone numbers + messaging tier + 24h toggle
// ---------------------------------------------------------------------------

function WabaSection({
  channelId,
  account,
  canWrite,
  onChange,
}: {
  channelId: string;
  account: MetaBusinessAccountDto | null;
  canWrite: boolean;
  onChange: () => void;
}) {
  const [wabaId, setWabaId] = useState(account?.wabaId ?? "");
  const [warningEnabled, setWarningEnabled] = useState(account?.sessionWindowWarningEnabled ?? true);
  const [numbers, setNumbers] = useState<WhatsAppNumberDto[] | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadNumbers = useCallback(async () => {
    const result = await fetchJson<{ numbers: WhatsAppNumberDto[] }>(`/api/v1/admin/channels/${channelId}/whatsapp/numbers`);
    if (result.kind === "ok") setNumbers(result.data.numbers);
  }, [channelId]);

  useEffect(() => {
    void loadNumbers();
  }, [loadNumbers]);

  async function saveWaba() {
    setError(null);
    const res = await fetch(`/api/v1/admin/channels/${channelId}/whatsapp`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ wabaId, sessionWindowWarningEnabled: warningEnabled }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.title ?? "Failed to save WABA config.");
      return;
    }
    onChange();
  }

  async function syncNumbers() {
    setSyncing(true);
    setError(null);
    const res = await fetch(`/api/v1/admin/channels/${channelId}/whatsapp/numbers`, { method: "POST" });
    setSyncing(false);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.title ?? "Sync failed.");
      return;
    }
    await loadNumbers();
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex max-w-sm flex-col gap-1">
        <div className="flex items-center gap-1">
          <Label htmlFor="whatsapp-waba-id">WABA ID</Label>
          <FieldHint
            id="whatsapp-waba-id-hint"
            content="The WhatsApp Business Account ID (from Meta Business Manager) this channel sends and receives messages through — determines which registered phone numbers appear below when you sync."
          />
        </div>
        <div className="flex gap-2">
          <Input id="whatsapp-waba-id" value={wabaId} onChange={(e) => setWabaId(e.target.value)} disabled={!canWrite} />
          <Button onClick={saveWaba} disabled={!canWrite}>
            Save
          </Button>
        </div>
      </div>

      <div className="flex max-w-lg items-center gap-2">
        <Switch id="whatsapp-24h-window" checked={warningEnabled} onCheckedChange={(checked) => setWarningEnabled(checked)} disabled={!canWrite} />
        <Label htmlFor="whatsapp-24h-window">Enforce 24-hour session window</Label>
        <FieldHint
          id="whatsapp-24h-window-hint"
          content="When on, the console warns before sending a free-form message outside WhatsApp's 24-hour customer-service window and steers you toward an approved template instead — WhatsApp itself always enforces the window regardless of this setting."
        />
      </div>
      <p className="max-w-lg text-sm text-muted-foreground">
        WhatsApp only allows free-form messages within 24 hours of the customer&apos;s last message. Outside that
        window, only an approved template can be sent. If violated, the exact message shown is: &ldquo;This message
        requires an approved WhatsApp template outside the 24-hour session window&rdquo;.
      </p>

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <div>
        <div className="mb-2 flex items-center justify-between">
          <h2 className="font-heading text-sm font-semibold">Phone numbers</h2>
          <Button size="sm" onClick={syncNumbers} disabled={syncing || !canWrite}>
            {syncing ? "Syncing…" : "Sync phone numbers from Meta"}
          </Button>
        </div>
        {!numbers ? (
          <Skeleton className="h-16 w-full" role="status" aria-label="Loading phone numbers" />
        ) : numbers.length === 0 ? (
          <p className="text-muted-foreground">No phone numbers yet — sync from Meta after registering a number in Business Manager.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Number</TableHead>
                <TableHead>Display name</TableHead>
                <TableHead>Verification</TableHead>
                <TableHead>Messaging tier</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {numbers.map((n) => (
                <TableRow key={n.id}>
                  <TableCell>
                    <code>{n.e164}</code>
                  </TableCell>
                  <TableCell>{n.displayName ?? "—"}</TableCell>
                  <TableCell>
                    <StatusBadge
                      tone={n.verificationStatus === "Verified" ? "connected" : n.verificationStatus === "Pending" ? "degraded" : "offline"}
                      label={n.verificationStatus}
                    />
                  </TableCell>
                  <TableCell>
                    <TierGauge tier={n.messagingTier} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>
    </div>
  );
}

function TierGauge({ tier }: { tier: WhatsAppNumberDto["messagingTier"] }) {
  const current = TIER_INDEX[tier];
  return (
    <div aria-label={`Tier ${current} of 4`} role="img" className="flex items-center gap-1">
      {[1, 2, 3, 4].map((i) => (
        <span key={i} className={`inline-block size-[10px] rounded-sm ${i <= current ? "bg-primary" : "bg-muted"}`} aria-hidden="true" />
      ))}
      <span className="ms-1 text-xs text-muted-foreground">Tier {current}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 7.2.3 Credentials
// ---------------------------------------------------------------------------

function CredentialsSection({ channelId, account, canWrite }: { channelId: string; account: MetaBusinessAccountDto | null; canWrite: boolean }) {
  const [rotating, setRotating] = useState<"systemUserToken" | "appSecret" | null>(null);
  const [value, setValue] = useState("");
  const [message, setMessage] = useState<string | null>(null);

  async function rotate(which: "systemUserToken" | "appSecret") {
    const res = await fetch(`/api/v1/admin/channels/${channelId}/whatsapp/credentials`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ which, value }),
    });
    if (res.ok) {
      setMessage(`${which === "systemUserToken" ? "System User token" : "App Secret"} rotated.`);
      setRotating(null);
      setValue("");
    }
  }

  return (
    <div className="flex max-w-md flex-col gap-4">
      {message && (
        <Alert>
          <AlertDescription>{message}</AlertDescription>
        </Alert>
      )}
      <div>
        <Label>System User token</Label>
        <p className="font-mono text-sm text-muted-foreground">{account?.systemUserTokenMaskedHint ?? "••••••••"}</p>
        {rotating === "systemUserToken" ? (
          <div className="mt-2 flex gap-2">
            <Input
              type="password"
              aria-label="New System User token"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder="New token"
            />
            <Button onClick={() => rotate("systemUserToken")}>Save</Button>
          </div>
        ) : (
          <Button size="sm" className="mt-2" onClick={() => setRotating("systemUserToken")} disabled={!canWrite}>
            Rotate
          </Button>
        )}
      </div>

      <div>
        <Label>App ID</Label>
        <p>{account?.appId ?? "—"}</p>
      </div>

      <div>
        <Label>App Secret</Label>
        <p className="font-mono text-sm text-muted-foreground">{account?.appSecretMaskedHint ?? "••••••••"}</p>
        {rotating === "appSecret" ? (
          <div className="mt-2 flex gap-2">
            <Input type="password" aria-label="New App Secret" value={value} onChange={(e) => setValue(e.target.value)} placeholder="New secret" />
            <Button onClick={() => rotate("appSecret")}>Save</Button>
          </div>
        ) : (
          <Button size="sm" className="mt-2" onClick={() => setRotating("appSecret")} disabled={!canWrite}>
            Rotate
          </Button>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// QA D1 fix: Webhook tab (screen inventory B.2.3) — webhook URL, verification
// status/re-verify, per-event-type subscription status, last-event-received.
// ---------------------------------------------------------------------------

function WebhookSection({ channelId, canWrite }: { channelId: string; canWrite: boolean }) {
  const [status, setStatus] = useState<WhatsAppWebhookStatusDto | null>(null);
  const [reverifying, setReverifying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const result = await fetchJson<{ status: WhatsAppWebhookStatusDto }>(`/api/v1/admin/channels/${channelId}/whatsapp/webhook`);
    if (result.kind === "ok") setStatus(result.data.status);
  }, [channelId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function reverify() {
    setReverifying(true);
    setError(null);
    const res = await fetch(`/api/v1/admin/channels/${channelId}/whatsapp/webhook/reverify`, { method: "POST" });
    setReverifying(false);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.title ?? "Re-verify failed.");
      return;
    }
    const data = await res.json();
    setStatus(data.status);
    if (data.status.verificationStatus !== "Verified") {
      setError("The webhook challenge did not verify — check that this deployment's Gateway Plane is reachable and try again.");
    }
  }

  if (!status) return <Skeleton className="h-16 w-full" role="status" aria-label="Loading webhook status" />;

  return (
    <div className="flex max-w-2xl flex-col gap-5">
      <p className="text-sm text-muted-foreground">
        Meta delivers every inbound message/status update to this URL. It&apos;s already registered — this tab is for
        checking its health, not re-entering it in Meta Business Manager.
      </p>

      <div>
        <Label>Webhook URL</Label>
        <code className="mt-1 block wrap-break-word rounded-none border bg-muted p-2 text-sm">{status.webhookUrl}</code>
      </div>

      <div>
        <Label>Verify token</Label>
        <p className="font-mono text-sm text-muted-foreground">•••••••• (vaulted — rotate from Credentials if Meta ever needs a new one)</p>
      </div>

      <div>
        <div className="mb-2 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="font-semibold">Verification status</span>
            <StatusBadge tone={WEBHOOK_VERIFICATION_TONE[status.verificationStatus]} label={status.verificationStatus} />
          </div>
          <Button size="sm" onClick={reverify} disabled={reverifying || !canWrite}>
            {reverifying ? "Re-verifying…" : "Re-verify Challenge"}
          </Button>
        </div>
        <p className="text-sm text-muted-foreground">
          {status.verifiedAt
            ? `Last verified ${new Date(status.verifiedAt).toLocaleString()}.`
            : "Never verified — Meta will verify automatically when it registers this webhook, or click “Re-verify Challenge” to check it now."}
        </p>
        {error && (
          <Alert variant="destructive" className="mt-2">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
      </div>

      <div>
        <h2 className="mb-2 font-heading text-sm font-semibold">Event subscriptions</h2>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Event type</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {status.eventSubscriptions.map((e) => (
              <TableRow key={e.eventType}>
                <TableCell>{e.label}</TableCell>
                <TableCell>
                  <StatusBadge tone={e.subscribed ? "connected" : "offline"} label={e.subscribed ? "Subscribed" : "Not subscribed"} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <div>
        <Label>Last event received</Label>
        <p className="text-foreground/80">{status.lastEventReceivedAt ? new Date(status.lastEventReceivedAt).toLocaleString() : "No events received yet."}</p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 7.2.4 Template sync
// ---------------------------------------------------------------------------

function TemplatesSection({ channelId, canWrite }: { channelId: string; canWrite: boolean }) {
  const [templates, setTemplates] = useState<WhatsAppTemplateDto[] | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<string | null>(null);

  const load = useCallback(async () => {
    const result = await fetchJson<{ templates: WhatsAppTemplateDto[] }>(`/api/v1/admin/channels/${channelId}/whatsapp/templates`);
    if (result.kind === "ok") setTemplates(result.data.templates);
  }, [channelId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function sync() {
    setSyncing(true);
    setError(null);
    setConfirmation(null);
    const res = await fetch(`/api/v1/admin/channels/${channelId}/whatsapp/templates`, { method: "POST" });
    setSyncing(false);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.title ?? "Sync failed.");
      return;
    }
    const data = await res.json();
    setConfirmation(`${data.synced} template(s) synced.`);
    await load();
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <Button onClick={sync} disabled={syncing || !canWrite}>
          {syncing ? "Syncing…" : "Sync from Meta"}
        </Button>
        <div aria-live="polite">{syncing && <p className="text-sm">Syncing templates…</p>}</div>
      </div>
      {confirmation && (
        <Alert>
          <AlertDescription>{confirmation}</AlertDescription>
        </Alert>
      )}
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      {!templates ? (
        <Skeleton className="h-16 w-full" role="status" aria-label="Loading templates" />
      ) : templates.length === 0 ? (
        <p className="text-muted-foreground">No templates synced yet — click &ldquo;Sync from Meta&rdquo; to pull your approved message templates.</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Language</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Variables</TableHead>
              <TableHead>Last synced</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {templates.map((t) => (
              <TableRow key={t.id}>
                <TableCell>{t.name}</TableCell>
                <TableCell>{t.language}</TableCell>
                <TableCell>
                  <StatusBadge tone={TEMPLATE_STATUS_TONE[t.status]} label={t.status} />
                </TableCell>
                <TableCell>{t.variables.join(", ") || "—"}</TableCell>
                <TableCell>{new Date(t.syncedAt).toLocaleString()}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// 7.2.5 Opt-in / consent tracking
// ---------------------------------------------------------------------------

function ConsentSection({ channelId, canWrite }: { channelId: string; canWrite: boolean }) {
  const [records, setRecords] = useState<ConsentRecordDto[] | null>(null);
  const [importRows, setImportRows] = useState("");
  const [preview, setPreview] = useState<ConsentImportResult | null>(null);
  const [committing, setCommitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const result = await fetchJson<{ records: ConsentRecordDto[] }>(`/api/v1/admin/channels/${channelId}/whatsapp/consent`);
    if (result.kind === "ok") setRecords(result.data.records);
  }, [channelId]);

  useEffect(() => {
    void load();
  }, [load]);

  function parseCsv(): { rows: { customerIdentifier: string; state: "OptedIn" | "OptedOut"; source?: string }[] } {
    const rows = importRows
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean)
      .map((line) => {
        const [customerIdentifier, state, source] = line.split(",").map((s) => s.trim());
        return { customerIdentifier: customerIdentifier ?? "", state: (state as "OptedIn" | "OptedOut") ?? "OptedIn", source };
      });
    return { rows };
  }

  async function dryRun() {
    setError(null);
    const { rows } = parseCsv();
    const res = await fetch(`/api/v1/admin/channels/${channelId}/whatsapp/consent/import`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ rows }),
    });
    if (!res.ok) {
      setError("Failed to validate import.");
      return;
    }
    setPreview(await res.json());
  }

  async function commitImport() {
    setCommitting(true);
    const { rows } = parseCsv();
    const res = await fetch(`/api/v1/admin/channels/${channelId}/whatsapp/consent/import?commit=true`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ rows }),
    });
    setCommitting(false);
    if (res.ok) {
      setPreview(null);
      setImportRows("");
      await load();
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="mb-2 font-heading text-sm font-semibold">Consent log</h2>
        {!records ? (
          <Skeleton className="h-16 w-full" role="status" aria-label="Loading consent records" />
        ) : records.length === 0 ? (
          <p className="text-muted-foreground">No consent records yet — import a list or wait for customer-initiated opt-ins to appear here automatically.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Phone</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Source</TableHead>
                <TableHead>Recorded</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {records.map((r) => (
                <TableRow key={r.id}>
                  <TableCell>
                    <code>{r.customerIdentifierMasked}</code>
                  </TableCell>
                  <TableCell>
                    <StatusBadge tone={r.state === "OptedIn" ? "connected" : "offline"} label={r.state} />
                  </TableCell>
                  <TableCell>{r.source}</TableCell>
                  <TableCell>{new Date(r.recordedAt).toLocaleString()}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
        <a href={`/api/v1/admin/channels/${channelId}/whatsapp/consent/export`} className={cn(buttonVariants({ size: "sm" }), "mt-2")}>
          Export
        </a>
      </div>

      <div>
        <h2 className="mb-2 font-heading text-sm font-semibold">Bulk import</h2>
        <p className="mb-2 text-sm text-muted-foreground">One row per line: phone,state,source (e.g. +15551234567,OptedIn,BulkImport)</p>
        <Textarea aria-label="Bulk import rows" value={importRows} onChange={(e) => setImportRows(e.target.value)} rows={5} disabled={!canWrite} />
        <div className="mt-2 flex gap-2">
          <Button size="sm" onClick={dryRun} disabled={!canWrite || !importRows.trim()}>
            Preview import
          </Button>
          {preview && (
            <Button size="sm" onClick={commitImport} disabled={committing || !canWrite}>
              {committing ? "Committing…" : "Commit import"}
            </Button>
          )}
        </div>
        {error && (
          <Alert variant="destructive" className="mt-2">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        {preview && (
          <div className="mt-3">
            <p className="mb-1 font-bold">
              {preview.succeededRows} of {preview.totalRows} rows valid — {preview.failedRows} error(s)
            </p>
            {preview.errors.length > 0 && (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Row</TableHead>
                    <TableHead>Reason</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {preview.errors.map((e) => (
                    <TableRow key={e.row}>
                      <TableCell>{e.row + 1}</TableCell>
                      <TableCell>{e.reason}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
