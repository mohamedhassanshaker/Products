"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@nextbot/ui/components/ui/button";
import { Card } from "@nextbot/ui/components/ui/card";
import { Alert, AlertDescription } from "@nextbot/ui/components/ui/alert";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@nextbot/ui/components/ui/select";
import { fetchJson } from "@/src/lib/fetch-json";

interface BlueprintRow {
  id: string;
  name: string;
  description: string | null;
  createdAt: string;
}
interface DefinitionRow {
  id: string;
  name: string;
}

/**
 * Target Architecture Blueprint Phase 12 (BL-43, FR-AGT-15) — the Blueprints
 * Gallery, **descoped to tenant-local starter templates** (no cross-tenant
 * sharing, no platform-curated library — `agent_blueprint.tenant_id` is NOT
 * NULL, mirroring `skill.tenant_id`'s own precedent). Selecting one instantiates
 * a fresh Studio draft pre-populated at the Review step against the chosen
 * agent definition, then hands off to the Studio wizard (`?draftId=…`) —
 * editable before save, never a direct write.
 */
export function BlueprintsGallery() {
  const router = useRouter();
  const [blueprints, setBlueprints] = useState<BlueprintRow[]>([]);
  const [definitions, setDefinitions] = useState<DefinitionRow[]>([]);
  const [selectedDefinitionId, setSelectedDefinitionId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void (async () => {
      const [bpResult, defResult] = await Promise.all([
        fetchJson<{ blueprints: BlueprintRow[] }>("/api/v1/admin/agent-platform/blueprints"),
        fetchJson<{ definitions: DefinitionRow[] }>("/api/v1/admin/agent-platform/definitions"),
      ]);
      if (bpResult.kind === "ok") setBlueprints(bpResult.data.blueprints);
      if (defResult.kind === "ok") {
        setDefinitions(defResult.data.definitions);
        if (defResult.data.definitions[0]) setSelectedDefinitionId(defResult.data.definitions[0].id);
      }
    })();
  }, []);

  async function useBlueprint(blueprintId: string) {
    if (!selectedDefinitionId) {
      setError("Choose an agent definition to apply this blueprint to first.");
      return;
    }
    setBusy(true);
    setError(null);
    const result = await fetchJson<{ draft: { id: string } }>(`/api/v1/admin/agent-platform/blueprints/${blueprintId}/instantiate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ agentDefinitionId: selectedDefinitionId }),
    });
    setBusy(false);
    if (result.kind !== "ok") {
      setError(result.message);
      return;
    }
    router.push(`/agent-platform/definitions/${selectedDefinitionId}/versions/studio?draftId=${result.data.draft.id}`);
  }

  return (
    <div>
      <h1 className="mb-2 font-heading text-lg font-semibold">Blueprints Gallery</h1>
      <p className="mb-6 text-sm text-muted-foreground">
        Tenant-local starter templates your own admins have composed — no cross-tenant sharing.
      </p>

      {error && (
        <Alert variant="destructive" className="mb-4">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <div className="mb-6 max-w-xs">
        <label className="text-sm font-medium">Apply to agent definition</label>
        <Select value={selectedDefinitionId} onValueChange={(v) => v !== null && setSelectedDefinitionId(v)}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            {definitions.map((d) => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      {blueprints.length === 0 && (
        <p className="text-sm text-muted-foreground">
          No blueprints saved yet — save one from the Design Studio's Review step ("Save as blueprint").
        </p>
      )}

      <div className="flex flex-col gap-3">
        {blueprints.map((bp) => (
          <Card key={bp.id} className="flex items-center justify-between p-4">
            <div>
              <p className="font-medium">{bp.name}</p>
              {bp.description && <p className="text-sm text-muted-foreground">{bp.description}</p>}
            </div>
            <Button disabled={busy} onClick={() => void useBlueprint(bp.id)}>
              Use this blueprint
            </Button>
          </Card>
        ))}
      </div>
    </div>
  );
}
