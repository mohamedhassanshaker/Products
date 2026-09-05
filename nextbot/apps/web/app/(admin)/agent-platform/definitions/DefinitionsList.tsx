"use client";

import { useEffect, useState } from "react";
import NextLink from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@nextbot/ui/components/ui/button";
import { Input } from "@nextbot/ui/components/ui/input";
import { Label } from "@nextbot/ui/components/ui/label";
import { FieldHint } from "@nextbot/ui/components/ui/field-hint";
import { Textarea } from "@nextbot/ui/components/ui/textarea";
import { Alert, AlertDescription } from "@nextbot/ui/components/ui/alert";
import { Skeleton } from "@nextbot/ui/components/ui/skeleton";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@nextbot/ui/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogBody, DialogFooter } from "@nextbot/ui/components/ui/dialog";
import { AccessDeniedState } from "@nextbot/ui";
import { toast } from "@nextbot/ui/lib/toast";
import { fetchJson } from "@/src/lib/fetch-json";

interface DefinitionListItem {
  id: string;
  name: string;
  description: string | null;
  updatedAt: string;
  /** U8 fix (QA 2026-08-15 UI pass, low — UX_GUIDELINES.md §6.1 step 2). */
  versionCount: number;
  productionVersion: string | null;
}

/**
 * BL-07 Agent Definition Registry list (UX_GUIDELINES.md §6.1).
 */
export function DefinitionsList({ canWrite }: { canWrite: boolean }) {
  const router = useRouter();
  const [definitions, setDefinitions] = useState<DefinitionListItem[] | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function load() {
    const result = await fetchJson<{ definitions: DefinitionListItem[] }>("/api/v1/admin/agent-platform/definitions");
    if (result.kind === "forbidden") {
      setForbidden(true);
      return;
    }
    if (result.kind === "error") {
      setError(result.message);
      return;
    }
    setDefinitions(result.data.definitions ?? []);
  }

  useEffect(() => {
    void load();
  }, []);

  async function handleCreate() {
    setSubmitting(true);
    const result = await fetchJson<{ definition: DefinitionListItem }>("/api/v1/admin/agent-platform/definitions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name, description: description || undefined }),
    });
    setSubmitting(false);
    if (result.kind !== "ok") {
      toast.error(result.message);
      return;
    }
    setIsOpen(false);
    setName("");
    setDescription("");
    // U4 fix (QA 2026-08-15 UI pass, medium — UX_GUIDELINES.md §6.1 step 3 requires
    // landing directly on the new Definition Detail, not back on the list).
    router.push(`/agent-platform/definitions/${result.data.definition.id}`);
  }

  if (forbidden) return <AccessDeniedState moduleLabel="Agent Platform" />;

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="font-heading text-lg font-semibold">Agent Definitions</h1>
        {canWrite && <Button onClick={() => setIsOpen(true)}>+ New Agent Definition</Button>}
      </div>

      {error && (
        <Alert variant="destructive" className="mb-4">
          <AlertDescription className="flex items-center gap-4">
            {error}
            <Button size="sm" onClick={() => void load()}>
              Retry
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {definitions === null && !error ? (
        <div className="flex flex-col gap-2">
          <Skeleton className="h-10 w-full" role="status" aria-label="Loading agent definitions" />
          <Skeleton className="h-10 w-full" role="status" aria-label="Loading agent definitions" />
          <Skeleton className="h-10 w-full" role="status" aria-label="Loading agent definitions" />
        </div>
      ) : definitions && definitions.length === 0 ? (
        <div className="py-12 text-center">
          <p className="mb-4 text-muted-foreground">No agent definitions yet</p>
          {canWrite && <Button onClick={() => setIsOpen(true)}>+ New Agent Definition</Button>}
        </div>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Description</TableHead>
              <TableHead>Versions</TableHead>
              <TableHead>Production version</TableHead>
              <TableHead>Last updated</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {definitions?.map((d) => (
              <TableRow key={d.id}>
                <TableCell>
                  <NextLink href={`/agent-platform/definitions/${d.id}`} className="font-medium text-primary underline-offset-4 hover:underline">
                    {d.name}
                  </NextLink>
                </TableCell>
                <TableCell>
                  <span className="block max-w-[280px] truncate" title={d.description ?? undefined}>
                    {d.description ?? "—"}
                  </span>
                </TableCell>
                <TableCell>{d.versionCount}</TableCell>
                <TableCell>{d.productionVersion ?? "—"}</TableCell>
                <TableCell>{new Date(d.updatedAt).toLocaleString()}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      <Dialog open={isOpen} onOpenChange={(open) => !open && setIsOpen(false)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New Agent Definition</DialogTitle>
          </DialogHeader>
          <DialogBody className="flex flex-col gap-4">
            <div>
              <div className="mb-1 flex items-center gap-1">
                <Label htmlFor="new-definition-name" className="font-bold">
                  Name
                </Label>
                <FieldHint
                  id="new-definition-name-hint"
                  content="This definition's name — pre-fills the metadata.name field in the YAML scaffold the first time you create a version for it, and is how it's identified throughout the console."
                />
              </div>
              <Input id="new-definition-name" value={name} onChange={(e) => setName(e.target.value)} required />
            </div>
            <div>
              <div className="mb-1 flex items-center gap-1">
                <Label htmlFor="new-definition-description" className="font-bold">
                  Description
                </Label>
                <FieldHint
                  id="new-definition-description-hint"
                  content="Optional context shown (truncated, with the full text on hover) in the Agent Definitions list to help teammates tell definitions apart — not used in the agent's actual runtime configuration."
                />
              </div>
              <Textarea id="new-definition-description" value={description} onChange={(e) => setDescription(e.target.value)} />
            </div>
          </DialogBody>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setIsOpen(false)}>
              Cancel
            </Button>
            <Button onClick={() => void handleCreate()} disabled={submitting || !name.trim()}>
              {submitting ? "Creating…" : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
