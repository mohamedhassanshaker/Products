"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@nextbot/ui/components/ui/button";
import { Input } from "@nextbot/ui/components/ui/input";
import { Label } from "@nextbot/ui/components/ui/label";
import { FieldHint } from "@nextbot/ui/components/ui/field-hint";
import { Textarea } from "@nextbot/ui/components/ui/textarea";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@nextbot/ui/components/ui/select";
import { Alert, AlertDescription, AlertTitle } from "@nextbot/ui/components/ui/alert";
import { toast } from "@nextbot/ui/lib/toast";
import { fetchJson } from "@/src/lib/fetch-json";

/**
 * Knowledge Collection creation form — a routine structured form (no Text/YAML
 * mode toggle, same reasoning `SkillForm` already recorded for its own flat
 * shape: every field here is a scalar or a simple route-name reference, nothing a
 * form can't represent cleanly).
 */
export function NewCollectionForm() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [region, setRegion] = useState<"UAE" | "EU" | "US">("US");
  const [extractionRouteKey, setExtractionRouteKey] = useState("knowledge.extract.default");
  const [embeddingRouteKey, setEmbeddingRouteKey] = useState("knowledge.embed.default");
  const [errors, setErrors] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErrors([]);
    setSubmitting(true);
    try {
      const result = await fetchJson<{ collection: { id: string } }>("/api/v1/admin/knowledge/collections", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, description: description || undefined, region, extractionRouteKey, embeddingRouteKey }),
      });
      if (result.kind === "ok") {
        toast.success("Collection created.");
        router.push(`/knowledge/${result.data.collection.id}`);
        return;
      }
      setErrors([result.message]);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="max-w-2xl">
      <h1 className="font-heading mb-6 text-lg font-semibold">New Knowledge Collection</h1>
      {errors.length > 0 && (
        <Alert variant="destructive" className="mb-4">
          <AlertTitle>Could not create collection</AlertTitle>
          <AlertDescription>
            <ul className="list-disc pl-4">
              {errors.map((err) => (
                <li key={err}>{err}</li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      )}
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <div>
          <Label htmlFor="collection-name">Name</Label>
          <FieldHint id="collection-name-hint" content="A short, descriptive name shown throughout the console." />
          <Input id="collection-name" value={name} onChange={(e) => setName(e.target.value)} required />
        </div>
        <div>
          <Label htmlFor="collection-description">Description</Label>
          <Textarea id="collection-description" value={description} onChange={(e) => setDescription(e.target.value)} />
        </div>
        <div>
          <Label htmlFor="collection-region">Region</Label>
          <FieldHint id="collection-region-hint" content="Must match the tenant's configured storage region unless out-of-region inference is explicitly enabled in Settings > Retention & Residency." />
          <Select value={region} onValueChange={(v) => setRegion(v as "UAE" | "EU" | "US")}>
            <SelectTrigger id="collection-region" aria-label="Region">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="UAE">UAE</SelectItem>
              <SelectItem value="EU">EU</SelectItem>
              <SelectItem value="US">US</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label htmlFor="extraction-route-key">Extraction model route</Label>
          <FieldHint id="extraction-route-key-hint" content="A Model Gateway route name for the cheap entity-extraction pass. If it doesn't exist yet, a conservative placeholder route is created automatically." />
          <Input id="extraction-route-key" value={extractionRouteKey} onChange={(e) => setExtractionRouteKey(e.target.value)} required />
        </div>
        <div>
          <Label htmlFor="embedding-route-key">Embedding model route</Label>
          <FieldHint id="embedding-route-key-hint" content="A Model Gateway route name pinning the embedding model. Changing this later requires an explicit re-embed confirmation — it never silently changes an already-built index." />
          <Input id="embedding-route-key" value={embeddingRouteKey} onChange={(e) => setEmbeddingRouteKey(e.target.value)} required />
        </div>
        <div className="mt-2 flex gap-2">
          <Button type="submit" disabled={submitting}>
            {submitting ? "Creating…" : "Create collection"}
          </Button>
          <Button type="button" variant="outline" onClick={() => router.push("/knowledge")}>
            Cancel
          </Button>
        </div>
      </form>
    </div>
  );
}
