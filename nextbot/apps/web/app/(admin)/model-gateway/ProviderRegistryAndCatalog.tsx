"use client";

import { useEffect, useState } from "react";
import { Button } from "@nextbot/ui/components/ui/button";
import { Input } from "@nextbot/ui/components/ui/input";
import { Label } from "@nextbot/ui/components/ui/label";
import { FieldHint } from "@nextbot/ui/components/ui/field-hint";
import { Alert, AlertDescription } from "@nextbot/ui/components/ui/alert";
import { Skeleton } from "@nextbot/ui/components/ui/skeleton";
import { Badge } from "@nextbot/ui/components/ui/badge";
import { Checkbox } from "@nextbot/ui/components/ui/checkbox";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@nextbot/ui/components/ui/select";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@nextbot/ui/components/ui/table";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@nextbot/ui/components/ui/tabs";
import { toast } from "@nextbot/ui/lib/toast";
import { fetchJson } from "@/src/lib/fetch-json";
import { RoutesTab } from "./RoutesTab";
import { UsageTab } from "./UsageTab";

const PROVIDER_TYPES = [
  "openai",
  "anthropic",
  "azure-openai",
  "google-vertex",
  "bedrock",
  "openrouter",
  "openai-compatible",
  "ollama",
  "cohere",
  "mistral",
  "custom",
] as const;

// Self-hosted types need no credential and require a base URL (ADR-0011 §2.1) — drives
// which fields the create form shows/requires.
const SELF_HOSTED_TYPES = new Set(["openai-compatible", "ollama", "custom"]);
// Types with no discovery API — "Sync Catalog" is hidden, manual declaration is the
// only path (ADR-0011 §2.1's table).
const NO_CATALOG_SYNC_TYPES = new Set(["anthropic", "azure-openai", "google-vertex", "bedrock", "cohere", "mistral", "custom", "gemini"]);

const MODALITIES = ["Text", "Vision", "Audio", "Embedding", "Rerank", "Multimodal"] as const;

interface ProviderItem {
  id: string;
  tenantId: string | null;
  type: string;
  name: string;
  baseUrl: string | null;
  status: "Active" | "Unreachable" | "Disabled" | "CredentialInvalid";
  enabled: boolean;
  regionsServed: string[];
  lastProbeAt: string | null;
}

interface CatalogItem {
  id: string;
  providerId: string;
  modelId: string;
  displayName: string;
  modality: string;
  contextWindow: number;
  maxOutput: number;
  capabilitiesJson: Record<string, boolean>;
  status: "Available" | "Preview" | "Deprecating" | "Retired";
  source: "Synced" | "Manual";
  needsReview: boolean;
}

/** Target Architecture Blueprint Phase 1 (BL-32, ADR-0011, LLD §14.8) — Provider
 * Registry + Model Catalog management. Separate screen from the pre-existing v1
 * "Model Gateway" (Routes/Provider Registry tabs), which keeps working unchanged. */
export function ProviderRegistryAndCatalog({ canWrite }: { canWrite: boolean }) {
  const [providers, setProviders] = useState<ProviderItem[] | null>(null);
  const [catalog, setCatalog] = useState<CatalogItem[] | null>(null);
  const [catalogProviderFilter, setCatalogProviderFilter] = useState<string>("all");

  const [newType, setNewType] = useState<(typeof PROVIDER_TYPES)[number]>("openai-compatible");
  const [newName, setNewName] = useState("");
  const [newBaseUrl, setNewBaseUrl] = useState("");
  const [newApiKey, setNewApiKey] = useState("");
  const [creating, setCreating] = useState(false);

  const [declareProviderId, setDeclareProviderId] = useState("");
  const [declareModelId, setDeclareModelId] = useState("");
  const [declareDisplayName, setDeclareDisplayName] = useState("");
  const [declareModality, setDeclareModality] = useState<(typeof MODALITIES)[number]>("Text");
  const [declareContextWindow, setDeclareContextWindow] = useState(8192);
  const [declareMaxOutput, setDeclareMaxOutput] = useState(4096);
  const [declareTokenizer, setDeclareTokenizer] = useState("cl100k_base");
  const [declareToolCalling, setDeclareToolCalling] = useState(false);
  const [declareStreaming, setDeclareStreaming] = useState(true);
  const [declaring, setDeclaring] = useState(false);

  async function load() {
    const [providersResult, catalogResult] = await Promise.all([
      fetchJson<{ providers: ProviderItem[] }>("/api/v1/admin/model-gateway/providers"),
      fetchJson<{ entries: CatalogItem[] }>("/api/v1/admin/model-gateway/catalog"),
    ]);
    if (providersResult.kind === "ok") setProviders(providersResult.data.providers);
    if (catalogResult.kind === "ok") setCatalog(catalogResult.data.entries);
  }

  useEffect(() => {
    void load();
  }, []);

  // Default the manual-declaration form's provider picker to the first available
  // provider once the list loads, rather than leaving it on an empty selection a user
  // must always change first — a small UX convenience, not required for correctness
  // (the declare handler still validates a provider is selected either way).
  useEffect(() => {
    if (providers && providers.length > 0 && declareProviderId === "") {
      setDeclareProviderId(providers[0]!.id);
    }
  }, [providers, declareProviderId]);

  async function createProvider() {
    if (newName.trim().length === 0) {
      toast.error("Name is required");
      return;
    }
    if (SELF_HOSTED_TYPES.has(newType) && newBaseUrl.trim().length === 0) {
      toast.error("Base URL is required for a self-hosted provider type");
      return;
    }
    setCreating(true);
    const result = await fetchJson("/api/v1/admin/model-gateway/providers", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        type: newType,
        name: newName,
        baseUrl: newBaseUrl || undefined,
        apiKeyPlaintext: newApiKey || undefined,
      }),
    });
    setCreating(false);
    if (result.kind !== "ok") {
      toast.error(result.message);
      return;
    }
    toast.success("Provider registered");
    setNewName("");
    setNewBaseUrl("");
    setNewApiKey("");
    await load();
  }

  async function probeProvider(id: string) {
    const result = await fetchJson(`/api/v1/admin/model-gateway/providers/${id}/probe`, { method: "POST" });
    if (result.kind !== "ok") {
      toast.error(result.message);
      return;
    }
    toast.success("Probe complete");
    await load();
  }

  async function syncCatalog(id: string) {
    const result = await fetchJson(`/api/v1/admin/model-gateway/providers/${id}/sync-catalog`, { method: "POST" });
    if (result.kind !== "ok") {
      toast.error(result.message);
      return;
    }
    toast.success("Catalog sync complete");
    await load();
  }

  async function deactivateProvider(id: string) {
    const result = await fetchJson(`/api/v1/admin/model-gateway/providers/${id}`, { method: "DELETE" });
    if (result.kind !== "ok") {
      toast.error(result.message);
      return;
    }
    toast.success("Provider deactivated");
    await load();
  }

  async function declareEntry() {
    if (!declareProviderId) {
      toast.error("Select a provider");
      return;
    }
    if (declareModelId.trim().length === 0 || declareDisplayName.trim().length === 0) {
      toast.error("Model id and display name are required");
      return;
    }
    setDeclaring(true);
    const result = await fetchJson("/api/v1/admin/model-gateway/catalog", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        providerId: declareProviderId,
        modelId: declareModelId,
        displayName: declareDisplayName,
        modality: declareModality,
        contextWindow: declareContextWindow,
        maxOutput: declareMaxOutput,
        tokenizer: declareTokenizer,
        capabilities: {
          toolCalling: declareToolCalling,
          vision: false,
          streaming: declareStreaming,
          structuredOutput: false,
          extendedThinking: false,
          promptCaching: false,
          jsonMode: false,
        },
      }),
    });
    setDeclaring(false);
    if (result.kind !== "ok") {
      toast.error(result.message);
      return;
    }
    toast.success("Model catalog entry declared");
    setDeclareModelId("");
    setDeclareDisplayName("");
    await load();
  }

  async function removeCatalogEntry(id: string) {
    const result = await fetchJson(`/api/v1/admin/model-gateway/catalog/${id}`, { method: "DELETE" });
    if (result.kind !== "ok") {
      toast.error(result.message);
      return;
    }
    toast.success("Catalog entry removed");
    await load();
  }

  const filteredCatalog = catalog?.filter((c) => catalogProviderFilter === "all" || c.providerId === catalogProviderFilter) ?? null;

  return (
    <div>
      <h1 className="mb-6 font-heading text-lg font-semibold">Model Gateway — Provider Registry &amp; Catalog</h1>

      {/* `defaultValue` stays "providers" — Phase 1's already-QA-approved
          `ProviderRegistryAndCatalog.test.tsx` renders this component and asserts on
          Providers-tab content with no tab click first; changing the default away
          from it would silently regress that suite even though this phase only adds
          tabs, never removes/reorders existing behavior. */}
      <Tabs defaultValue="providers">
        <TabsList aria-label="Model Gateway v2 sections" className="mb-4">
          <TabsTrigger id="model-gateway-v2-tab-routes" panelId="model-gateway-v2-panel-routes" value="routes">
            Routes
          </TabsTrigger>
          <TabsTrigger id="model-gateway-v2-tab-providers" panelId="model-gateway-v2-panel-providers" value="providers">
            Providers
          </TabsTrigger>
          <TabsTrigger id="model-gateway-v2-tab-catalog" panelId="model-gateway-v2-panel-catalog" value="catalog">
            Model Catalog
          </TabsTrigger>
          <TabsTrigger id="model-gateway-v2-tab-usage" panelId="model-gateway-v2-panel-usage" value="usage">
            Usage
          </TabsTrigger>
        </TabsList>

        {/* Target Architecture Blueprint Phase 2 (BL-33) — Route v2 + usage/cost. */}
        <TabsContent id="model-gateway-v2-panel-routes" value="routes">
          <RoutesTab canWrite={canWrite} />
        </TabsContent>

        <TabsContent id="model-gateway-v2-panel-usage" value="usage">
          <UsageTab />
        </TabsContent>

        <TabsContent id="model-gateway-v2-panel-providers" value="providers">
          <h2 className="mb-2 font-heading text-base font-semibold">Provider Registry</h2>
          {providers === null ? (
            <Skeleton className="mb-6 h-20 w-full" role="status" aria-label="Loading providers" />
          ) : (
            <>
              {providers.length === 0 && (
                <Alert className="mb-4">
                  <AlertDescription>No providers registered yet.</AlertDescription>
                </Alert>
              )}
              <Table className="mb-6">
                <TableHeader>
                  <TableRow>
                    <TableHead>Type</TableHead>
                    <TableHead>Name</TableHead>
                    <TableHead>Base URL</TableHead>
                    <TableHead>Scope</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Enabled</TableHead>
                    <TableHead>
                      <span className="sr-only">Actions</span>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {providers.map((p) => (
                    <TableRow key={p.id}>
                      <TableCell>
                        <code>{p.type}</code>
                      </TableCell>
                      <TableCell>{p.name}</TableCell>
                      <TableCell>{p.baseUrl ?? "—"}</TableCell>
                      <TableCell>{p.tenantId === null ? "Platform" : "This tenant"}</TableCell>
                      <TableCell>
                        <Badge
                          variant={p.status === "Active" ? undefined : "secondary"}
                          className={p.status === "Active" ? "bg-emerald-700 text-white" : p.status === "Unreachable" ? "bg-red-700 text-white" : undefined}
                        >
                          {p.status}
                        </Badge>
                      </TableCell>
                      <TableCell>{p.enabled ? "Yes" : "No"}</TableCell>
                      <TableCell>
                        {p.tenantId !== null && canWrite && (
                          <div className="flex flex-wrap gap-1">
                            <Button size="xs" onClick={() => void probeProvider(p.id)}>
                              Probe
                            </Button>
                            {!NO_CATALOG_SYNC_TYPES.has(p.type) && (
                              <Button size="xs" variant="outline" onClick={() => void syncCatalog(p.id)}>
                                Sync Catalog
                              </Button>
                            )}
                            {p.enabled && (
                              <Button size="xs" variant="ghost" onClick={() => void deactivateProvider(p.id)}>
                                Deactivate
                              </Button>
                            )}
                          </div>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </>
          )}

          {canWrite && (
            <div className="mb-8 rounded-none border p-4">
              <h3 className="mb-4 font-heading text-sm font-semibold">Register a provider</h3>
              <div className="mb-4 flex flex-wrap items-end gap-4">
                <div className="max-w-[220px]">
                  <div className="mb-1 flex items-center gap-1">
                    <Label htmlFor="mgv2-provider-type" className="text-sm">
                      Type
                    </Label>
                    <FieldHint id="mgv2-provider-type-hint" content="Which adapter handles this provider's wire format — self-hosted types (openai-compatible, ollama, custom) need no credential, just a reachable base URL." />
                  </div>
                  <Select value={newType} onValueChange={(v) => v !== null && setNewType(v as (typeof PROVIDER_TYPES)[number])}>
                    <SelectTrigger id="mgv2-provider-type" aria-label="Provider type" className="w-[220px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {PROVIDER_TYPES.map((t) => (
                        <SelectItem key={t} value={t}>
                          {t}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="max-w-[240px]">
                  <Label htmlFor="mgv2-provider-name" className="mb-1 block text-sm">
                    Name
                  </Label>
                  <Input id="mgv2-provider-name" value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="My OpenAI account" />
                </div>
                <div className="max-w-[280px]">
                  <div className="mb-1 flex items-center gap-1">
                    <Label htmlFor="mgv2-provider-base-url" className="text-sm">
                      Base URL{SELF_HOSTED_TYPES.has(newType) ? " (required)" : " (optional)"}
                    </Label>
                    <FieldHint id="mgv2-provider-base-url-hint" content="Required for self-hosted/OpenAI-compatible endpoints (vLLM, TGI, LiteLLM, Ollama, or a custom gateway); optional for hosted providers with a default endpoint." />
                  </div>
                  <Input id="mgv2-provider-base-url" value={newBaseUrl} onChange={(e) => setNewBaseUrl(e.target.value)} placeholder="https://my-endpoint.example.com/v1" />
                </div>
                {!SELF_HOSTED_TYPES.has(newType) && (
                  <div className="max-w-[240px]">
                    <div className="mb-1 flex items-center gap-1">
                      <Label htmlFor="mgv2-provider-api-key" className="text-sm">
                        API key
                      </Label>
                      <FieldHint id="mgv2-provider-api-key-hint" content="Vaulted on save (envelope-encrypted) and never displayed again in plaintext." />
                    </div>
                    <Input id="mgv2-provider-api-key" type="password" value={newApiKey} onChange={(e) => setNewApiKey(e.target.value)} placeholder="sk-…" />
                  </div>
                )}
              </div>
              <Button onClick={() => void createProvider()} disabled={creating}>
                {creating ? "Registering…" : "Register Provider"}
              </Button>
            </div>
          )}
        </TabsContent>

        <TabsContent id="model-gateway-v2-panel-catalog" value="catalog">
          <h2 className="mb-2 font-heading text-base font-semibold">Model Catalog</h2>
          <div className="mb-4 max-w-[260px]">
            <Label htmlFor="mgv2-catalog-provider-filter" className="mb-1 block text-sm">
              Filter by provider
            </Label>
            <Select value={catalogProviderFilter} onValueChange={(v) => v !== null && setCatalogProviderFilter(v)}>
              <SelectTrigger id="mgv2-catalog-provider-filter" aria-label="Filter by provider" className="w-[260px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All providers</SelectItem>
                {(providers ?? []).map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {filteredCatalog === null ? (
            <Skeleton className="mb-6 h-20 w-full" role="status" aria-label="Loading model catalog" />
          ) : (
            <>
              {filteredCatalog.length === 0 && (
                <Alert className="mb-4">
                  <AlertDescription>No catalog entries yet.</AlertDescription>
                </Alert>
              )}
              <Table className="mb-6">
                <TableHeader>
                  <TableRow>
                    <TableHead>Model id</TableHead>
                    <TableHead>Display name</TableHead>
                    <TableHead>Modality</TableHead>
                    <TableHead>Context</TableHead>
                    <TableHead>Capabilities</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Source</TableHead>
                    <TableHead>
                      <span className="sr-only">Actions</span>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredCatalog.map((c) => (
                    <TableRow key={c.id}>
                      <TableCell>
                        <code>{c.modelId}</code>
                        {c.needsReview && (
                          <Badge variant="secondary" className="ms-2">
                            Needs review
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell>{c.displayName}</TableCell>
                      <TableCell>{c.modality}</TableCell>
                      <TableCell>{c.contextWindow.toLocaleString()}</TableCell>
                      <TableCell>
                        {Object.entries(c.capabilitiesJson)
                          .filter(([, v]) => v)
                          .map(([k]) => k)
                          .join(", ") || "—"}
                      </TableCell>
                      <TableCell>{c.status}</TableCell>
                      <TableCell>{c.source}</TableCell>
                      <TableCell>
                        {canWrite && (
                          <Button size="xs" variant="ghost" onClick={() => void removeCatalogEntry(c.id)}>
                            {c.source === "Manual" ? "Delete" : "Retire"}
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </>
          )}

          {canWrite && (
            <div className="mb-8 rounded-none border p-4">
              <h3 className="mb-4 font-heading text-sm font-semibold">Manually declare a model</h3>
              <div className="mb-4 flex flex-wrap items-end gap-4">
                <div className="max-w-[220px]">
                  <Label htmlFor="mgv2-declare-provider" className="mb-1 block text-sm">
                    Provider
                  </Label>
                  <Select value={declareProviderId} onValueChange={(v) => v !== null && setDeclareProviderId(v)}>
                    <SelectTrigger id="mgv2-declare-provider" aria-label="Provider" className="w-[220px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {(providers ?? []).map((p) => (
                        <SelectItem key={p.id} value={p.id}>
                          {p.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="max-w-[180px]">
                  <Label htmlFor="mgv2-declare-model-id" className="mb-1 block text-sm">
                    Model id
                  </Label>
                  <Input id="mgv2-declare-model-id" value={declareModelId} onChange={(e) => setDeclareModelId(e.target.value)} placeholder="llama-3.1-70b" />
                </div>
                <div className="max-w-[220px]">
                  <Label htmlFor="mgv2-declare-display-name" className="mb-1 block text-sm">
                    Display name
                  </Label>
                  <Input id="mgv2-declare-display-name" value={declareDisplayName} onChange={(e) => setDeclareDisplayName(e.target.value)} placeholder="Llama 3.1 70B Instruct" />
                </div>
                <div className="max-w-[160px]">
                  <Label htmlFor="mgv2-declare-modality" className="mb-1 block text-sm">
                    Modality
                  </Label>
                  <Select value={declareModality} onValueChange={(v) => v !== null && setDeclareModality(v as (typeof MODALITIES)[number])}>
                    <SelectTrigger id="mgv2-declare-modality" aria-label="Modality" className="w-[160px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {MODALITIES.map((m) => (
                        <SelectItem key={m} value={m}>
                          {m}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="max-w-[140px]">
                  <Label htmlFor="mgv2-declare-context-window" className="mb-1 block text-sm">
                    Context window
                  </Label>
                  <Input
                    id="mgv2-declare-context-window"
                    type="number"
                    min={1}
                    value={declareContextWindow}
                    onChange={(e) => setDeclareContextWindow(Number(e.target.value))}
                  />
                </div>
                <div className="max-w-[140px]">
                  <Label htmlFor="mgv2-declare-max-output" className="mb-1 block text-sm">
                    Max output
                  </Label>
                  <Input id="mgv2-declare-max-output" type="number" min={1} value={declareMaxOutput} onChange={(e) => setDeclareMaxOutput(Number(e.target.value))} />
                </div>
                <div className="max-w-[160px]">
                  <Label htmlFor="mgv2-declare-tokenizer" className="mb-1 block text-sm">
                    Tokenizer
                  </Label>
                  <Input id="mgv2-declare-tokenizer" value={declareTokenizer} onChange={(e) => setDeclareTokenizer(e.target.value)} />
                </div>
                <div className="flex items-center gap-2">
                  <Checkbox id="mgv2-declare-tool-calling" checked={declareToolCalling} onCheckedChange={(c) => setDeclareToolCalling(c === true)} />
                  <Label htmlFor="mgv2-declare-tool-calling">Tool calling</Label>
                </div>
                <div className="flex items-center gap-2">
                  <Checkbox id="mgv2-declare-streaming" checked={declareStreaming} onCheckedChange={(c) => setDeclareStreaming(c === true)} />
                  <Label htmlFor="mgv2-declare-streaming">Streaming</Label>
                </div>
              </div>
              <Button onClick={() => void declareEntry()} disabled={declaring}>
                {declaring ? "Declaring…" : "Declare Model"}
              </Button>
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
