"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@nextbot/ui/components/ui/button";
import { Input } from "@nextbot/ui/components/ui/input";
import { Label } from "@nextbot/ui/components/ui/label";
import { FieldHint } from "@nextbot/ui/components/ui/field-hint";
import { Alert, AlertDescription } from "@nextbot/ui/components/ui/alert";
import { Skeleton } from "@nextbot/ui/components/ui/skeleton";
import { toast } from "@nextbot/ui/lib/toast";
import { fetchJson } from "@/src/lib/fetch-json";

interface RepoOption {
  owner: string;
  name: string;
}

/**
 * BL-07 Git-connect flow, callback half (UX_GUIDELINES.md §6.3 steps 4-6). The
 * provider redirects the browser here directly (full-page redirect, not a popup —
 * a deliberate choice per the guidance, distinct from the widget's popup-based OAuth
 * pattern which had a different constraint). Reads `code`/`provider` from the URL,
 * exchanges the code server-side, then shows the repo picker + the mandatory
 * ADR-0009 residency disclosure before the final `POST /connection` call.
 */
export default function GitCallbackPage() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const provider = (searchParams.get("provider") as "GitHub" | "GitLab" | null) ?? sessionStorage.getItem("nextbot.gitConnectProvider");
  const code = searchParams.get("code");
  const errorParam = searchParams.get("error");

  const [state, setState] = useState<"loading" | "picking" | "error" | "cancelled">("loading");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [refreshToken, setRefreshToken] = useState<string | undefined>(undefined);
  const [repos, setRepos] = useState<RepoOption[]>([]);
  const [selectedRepo, setSelectedRepo] = useState<RepoOption | null>(null);
  const [search, setSearch] = useState("");
  const [connecting, setConnecting] = useState(false);

  useEffect(() => {
    if (errorParam) {
      // The user cancelled/denied the OAuth prompt — a normal choice, not a failure
      // (UX_GUIDELINES.md §6.3: "neutral (not alarming) message").
      setState("cancelled");
      return;
    }
    if (!provider || !code) {
      setState("error");
      setErrorMessage("Missing OAuth callback parameters.");
      return;
    }
    fetchJson<{ accessToken: string; refreshToken?: string; repos: RepoOption[] }>(
      `/api/v1/admin/agent-platform/git/connect/${provider}/callback?code=${encodeURIComponent(code)}`,
    ).then((result) => {
      if (result.kind !== "ok") {
        setState("error");
        setErrorMessage(result.message);
        return;
      }
      setAccessToken(result.data.accessToken);
      setRefreshToken(result.data.refreshToken);
      setRepos(result.data.repos);
      setState("picking");
    });
    // Intentionally runs once on mount only — `provider`/`code` come from the URL
    // this page was loaded with and never change during its lifetime.
  }, []);

  async function handleConnect() {
    if (!selectedRepo || !accessToken || !provider) return;
    setConnecting(true);
    const baseUrl = sessionStorage.getItem("nextbot.gitConnectBaseUrl") ?? undefined;
    const result = await fetchJson("/api/v1/admin/agent-platform/git/connection", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ provider, repoOwner: selectedRepo.owner, repoName: selectedRepo.name, baseUrl, accessToken, refreshToken }),
    });
    setConnecting(false);
    sessionStorage.removeItem("nextbot.gitConnectProvider");
    sessionStorage.removeItem("nextbot.gitConnectBaseUrl");
    if (result.kind !== "ok") {
      toast.error(result.message);
      return;
    }
    router.push("/settings/integrations");
  }

  if (state === "cancelled") {
    return (
      <div className="mx-auto mt-16 max-w-lg text-center">
        <h1 className="sr-only">Git repository connect flow: cancelled</h1>
        <p className="mb-6">Connection cancelled — you can try again anytime.</p>
        <Button onClick={() => router.push("/settings/integrations")}>Back to Integrations</Button>
      </div>
    );
  }

  if (state === "loading") {
    return (
      <div className="mx-auto mt-16 max-w-lg text-center">
        {/* axe-core's `page-has-heading-one` rule (Batch A a11y audit): every
            state of this page needs a real level-one heading, not only the
            "picking" state below — visually redundant with the "Finishing
            connection…" text here, so kept screen-reader-only. */}
        <h1 className="sr-only">Finishing Git connection</h1>
        <Skeleton className="mx-auto mb-4 h-8 w-8 rounded-full" role="status" aria-label="Finishing connection" />
        <p>Finishing connection…</p>
      </div>
    );
  }

  if (state === "error") {
    return (
      <div className="mx-auto mt-16 max-w-lg">
        <h1 className="sr-only">Git connection failed</h1>
        <Alert variant="destructive" className="mb-4">
          <AlertDescription>{errorMessage}</AlertDescription>
        </Alert>
        <Button onClick={() => router.push("/settings/integrations")}>Back to Integrations</Button>
      </div>
    );
  }

  const filteredRepos = repos.filter((r) => `${r.owner}/${r.name}`.toLowerCase().includes(search.toLowerCase()));

  return (
    <div className="mx-auto mt-12 max-w-lg">
      <h1 className="mb-4 font-heading text-base font-semibold">Choose a repository</h1>
      <Label htmlFor="git-callback-search" className="sr-only">
        Search repositories
      </Label>
      <FieldHint
        id="git-callback-search-hint"
        content="Filters the repository list below by owner/name — the repository you select here is the one agent definitions will be committed to."
      />
      <Input
        id="git-callback-search"
        placeholder="Search repositories…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="mb-4"
        aria-label="Search repositories"
      />
      <div className="mb-4 flex max-h-[300px] flex-col items-stretch gap-1 overflow-y-auto" role="listbox" aria-label="Repositories">
        {filteredRepos.map((repo) => (
          <Button
            key={`${repo.owner}/${repo.name}`}
            variant={selectedRepo?.name === repo.name && selectedRepo?.owner === repo.owner ? "default" : "outline"}
            className="justify-start"
            role="option"
            aria-selected={selectedRepo?.name === repo.name}
            onClick={() => setSelectedRepo(repo)}
          >
            {repo.owner}/{repo.name}
          </Button>
        ))}
      </div>

      {selectedRepo && (
        <div>
          <Alert className="mb-4">
            <AlertDescription>
              Agent definition content (not customer conversation data) will be stored in this repository, which sits outside NextBot&apos;s
              regional data-residency guarantee for your tenant. Customer and conversation data are unaffected.
            </AlertDescription>
          </Alert>
          <Button onClick={() => void handleConnect()} disabled={connecting}>
            Connect
          </Button>
        </div>
      )}
    </div>
  );
}
