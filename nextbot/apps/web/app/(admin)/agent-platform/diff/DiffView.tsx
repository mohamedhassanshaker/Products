"use client";

import { useEffect, useState } from "react";
import { Button } from "@nextbot/ui/components/ui/button";
import { Alert, AlertDescription } from "@nextbot/ui/components/ui/alert";
import { Skeleton } from "@nextbot/ui/components/ui/skeleton";
import { Badge } from "@nextbot/ui/components/ui/badge";
import { cn } from "@nextbot/ui/lib/utils";
import { fetchJson } from "@/src/lib/fetch-json";

interface DiffFile {
  path: string;
  patch: string;
  additions: number;
  deletions: number;
}

/**
 * BL-07 Version diff view (UX_GUIDELINES.md §6.2) — a real git-provider compare-API
 * diff (FR-AGT-02), never a local `git diff`. Implements the required accessibility
 * treatment explicitly, not left to a bare colored-line render: a textual summary
 * announced once via `aria-live`, and each diff line carries a visually-hidden
 * "Added:"/"Removed:" prefix inside a `role="list"`/`role="listitem"` structure.
 */
export function DiffView({ versionAId, versionBId }: { versionAId: string; versionBId: string }) {
  const [files, setFiles] = useState<DiffFile[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setError(null);
    setFiles(null);
    const result = await fetchJson<{ files: DiffFile[] }>(`/api/v1/admin/agent-platform/versions/diff?a=${versionAId}&b=${versionBId}`);
    if (result.kind === "ok") setFiles(result.data.files);
    else setError(result.message);
  }

  useEffect(() => {
    void load();
  }, [versionAId, versionBId]);

  const totalAdditions = files?.reduce((sum, f) => sum + f.additions, 0) ?? 0;
  const totalDeletions = files?.reduce((sum, f) => sum + f.deletions, 0) ?? 0;

  return (
    <div>
      {error && (
        <Alert variant={error.includes("Git connection unavailable") ? "warning" : "destructive"} className="mb-4">
          <AlertDescription className="flex items-center gap-4">
            {error}
            <Button size="sm" onClick={() => void load()}>
              Retry
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {!error && files === null && <Skeleton className="h-[300px] w-full" role="status" aria-label="Loading version diff" />}

      {!error && files && files.length === 0 && <p>No differences between these two versions.</p>}

      {!error && files && files.length > 0 && (
        <>
          <p aria-live="polite" className="mb-4 font-medium">
            {files.length} file{files.length === 1 ? "" : "s"} changed, {totalAdditions} addition{totalAdditions === 1 ? "" : "s"}, {totalDeletions}{" "}
            deletion{totalDeletions === 1 ? "" : "s"}
          </p>
          <div className="flex flex-col gap-6">
            {files.map((file) => (
              <div key={file.path} className="overflow-hidden rounded-none border">
                <div className="flex items-center gap-2 border-b bg-muted/50 px-3 py-2">
                  <p className="font-mono text-sm">{file.path}</p>
                  <Badge className="bg-emerald-700 text-white">+{file.additions}</Badge>
                  <Badge variant="destructive">−{file.deletions}</Badge>
                </div>
                <ul
                  role="list"
                  tabIndex={0}
                  className="max-h-[500px] list-none overflow-x-auto overflow-y-auto p-3 font-mono text-sm"
                  aria-label={`Diff for ${file.path}`}
                >
                  {file.patch.split("\n").map((line, idx) => {
                    const isAdded = line.startsWith("+") && !line.startsWith("+++");
                    const isRemoved = line.startsWith("-") && !line.startsWith("---");
                    return (
                      <li
                        role="listitem"
                        key={idx}
                        className={cn("whitespace-pre-wrap", isAdded && "bg-emerald-50", isRemoved && "bg-red-50")}
                      >
                        <span className="sr-only">{isAdded ? "Added: " : isRemoved ? "Removed: " : ""}</span>
                        {line}
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
