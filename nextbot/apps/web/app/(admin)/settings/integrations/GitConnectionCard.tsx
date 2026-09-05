"use client";

import { useEffect, useState } from "react";
import { Button } from "@nextbot/ui/components/ui/button";
import { Input } from "@nextbot/ui/components/ui/input";
import { Label } from "@nextbot/ui/components/ui/label";
import { FieldHint } from "@nextbot/ui/components/ui/field-hint";
import { Alert, AlertDescription } from "@nextbot/ui/components/ui/alert";
import { Skeleton } from "@nextbot/ui/components/ui/skeleton";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
} from "@nextbot/ui/components/ui/alert-dialog";
import { StatusBadge, type StatusTone } from "@nextbot/ui";
import { toast } from "@nextbot/ui/lib/toast";
import { fetchJson } from "@/src/lib/fetch-json";

interface GitConnectionView {
  provider: "GitHub" | "GitLab";
  repoOwner: string;
  repoName: string;
  status: "Connected" | "Unreachable" | "Disconnected";
}

const STATUS_TONE: Record<GitConnectionView["status"], StatusTone> = {
  Connected: "connected",
  Unreachable: "degraded",
  Disconnected: "neutral",
};

/** BL-07 Git-connect flow, Settings card half (UX_GUIDELINES.md §6.3). The
 * repo picker/residency-disclosure/token-exchange steps live on the callback
 * page (`git-callback/page.tsx`) that the OAuth provider redirects back to —
 * this card is the "not connected" entry point + the persistent "Connected"
 * status display + disconnect. */
export function GitConnectionCard({ canWrite }: { canWrite: boolean }) {
  const [connection, setConnection] = useState<GitConnectionView | null | undefined>(undefined);
  const [gitlabBaseUrl, setGitlabBaseUrl] = useState("");
  const [showGitlabField, setShowGitlabField] = useState(false);
  const [connecting, setConnecting] = useState<"GitHub" | "GitLab" | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);

  async function load() {
    const result = await fetchJson<{ connection: GitConnectionView | null }>("/api/v1/admin/agent-platform/git/connection");
    if (result.kind === "ok") setConnection(result.data.connection);
  }

  useEffect(() => {
    void load();
  }, []);

  async function connect(provider: "GitHub" | "GitLab") {
    setConnecting(provider);
    // The provider/base-url the user picked is stashed for the callback page to
    // read after the full-page OAuth redirect round trip (a `state` param alone
    // isn't enough to pass this — sessionStorage survives the same-tab redirect).
    sessionStorage.setItem("nextbot.gitConnectProvider", provider);
    if (provider === "GitLab" && gitlabBaseUrl) sessionStorage.setItem("nextbot.gitConnectBaseUrl", gitlabBaseUrl);

    const result = await fetchJson<{ redirectUrl: string }>(`/api/v1/admin/agent-platform/git/connect/${provider}`);
    setConnecting(null);
    if (result.kind !== "ok") {
      toast.error(result.message);
      return;
    }
    window.location.href = result.data.redirectUrl;
  }

  async function disconnect() {
    setConfirmOpen(false);
    await fetchJson("/api/v1/admin/agent-platform/git/connection", { method: "DELETE" });
    await load();
  }

  return (
    <div>
      <h1 className="mb-6 font-heading text-lg font-semibold">Integrations</h1>
      <div className="max-w-[600px] rounded-none border p-6">
        <h2 className="mb-4 font-heading text-sm font-semibold">Git Connection</h2>

        {connection === undefined ? (
          <Skeleton className="h-[60px] w-full" role="status" aria-label="Loading Git connection" />
        ) : connection === null ? (
          <div>
            <p className="mb-4 text-muted-foreground">
              Connect your agent-definition repository to enable versioning, diff, and review (ADR-0009).
            </p>
            {canWrite ? (
              <>
                <div className="mb-4 flex gap-2">
                  <Button onClick={() => void connect("GitHub")} disabled={connecting !== null}>
                    Connect GitHub
                  </Button>
                  <Button onClick={() => setShowGitlabField((v) => !v)} disabled={connecting !== null} variant="outline">
                    Connect GitLab
                  </Button>
                </div>
                {showGitlabField && (
                  <div className="mb-4">
                    <div className="mb-2 flex items-center gap-1">
                      <Label htmlFor="gitlab-base-url">
                        Self-hosted GitLab base URL (optional — blank = gitlab.com)
                      </Label>
                      <FieldHint
                        id="gitlab-base-url-hint"
                        content="Only needed for a self-hosted GitLab instance — leave blank to connect directly to gitlab.com."
                      />
                    </div>
                    <Input
                      id="gitlab-base-url"
                      value={gitlabBaseUrl}
                      onChange={(e) => setGitlabBaseUrl(e.target.value)}
                      placeholder="https://gitlab.example.com"
                      className="mb-3"
                    />
                    <Button onClick={() => void connect("GitLab")} disabled={connecting !== null}>
                      Continue with GitLab
                    </Button>
                  </div>
                )}
              </>
            ) : (
              <p className="text-muted-foreground">Read-only access — an admin with Write access must connect a Git repository.</p>
            )}
          </div>
        ) : (
          <div>
            <div className="mb-2">
              <StatusBadge tone={STATUS_TONE[connection.status]} label={connection.status} />
            </div>
            <p className="mb-4">
              {connection.provider}: {connection.repoOwner}/{connection.repoName}
            </p>
            {connection.status === "Unreachable" && (
              <Alert variant="warning" className="mb-4">
                <AlertDescription>
                  This connection is unreachable — new versions, diffs, and pull requests can&apos;t be created until you reconnect.
                </AlertDescription>
              </Alert>
            )}
            {canWrite && (
              <Button onClick={() => setConfirmOpen(true)} variant="outline" className="text-destructive">
                Disconnect
              </Button>
            )}
          </div>
        )}
      </div>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Disconnect Git repository?</AlertDialogTitle>
            <AlertDialogDescription>
              Existing deployed agent versions keep running normally. New versions, diffs, and pull requests can&apos;t be created until you
              reconnect.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <Button variant="outline" onClick={() => setConfirmOpen(false)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={() => void disconnect()}>
              Disconnect
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
