"use client";

import { useEffect, useState } from "react";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@nextbot/ui/components/ui/select";
import { fetchJson } from "@/src/lib/fetch-json";

type PresenceState = "Available" | "Busy" | "Away" | "Offline";

interface AgentPresence {
  state: PresenceState;
  maxConcurrent: number;
  currentLoad: number;
}

const STATE_OPTIONS: PresenceState[] = ["Available", "Busy", "Away", "Offline"];

/**
 * Target Architecture Blueprint Phase 13 (BL-45, FR-ESC-05) — the self-service
 * presence status toggle. Deliberately minimal (a select, not a full workforce
 * dashboard) per this phase's own scope: "a status toggle is enough". Auto-provisions
 * (`Offline`/3/0) on first load via `GET .../agent-presence/me`, which the server
 * side (`getOrCreateAgentPresence`) guarantees never 404s.
 */
export function PresenceToggle() {
  const [presence, setPresence] = useState<AgentPresence | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void (async () => {
      const result = await fetchJson<AgentPresence>("/api/v1/admin/agent-presence/me");
      if (result.kind === "ok") setPresence(result.data);
    })();
  }, []);

  async function changeState(next: PresenceState) {
    setBusy(true);
    try {
      const result = await fetchJson<AgentPresence>("/api/v1/admin/agent-presence/me", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ state: next }),
      });
      if (result.kind === "ok") setPresence(result.data);
    } finally {
      setBusy(false);
    }
  }

  if (!presence) return null;

  return (
    <div className="mb-4 flex items-center gap-2 text-sm">
      <span className="text-muted-foreground">Your status:</span>
      <Select value={presence.state} onValueChange={(v) => v && changeState(v as PresenceState)} disabled={busy}>
        <SelectTrigger aria-label="Your presence status" className="w-[140px]">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {STATE_OPTIONS.map((s) => (
            <SelectItem key={s} value={s}>
              {s}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <span className="text-xs text-muted-foreground">
        ({presence.currentLoad}/{presence.maxConcurrent} active)
      </span>
    </div>
  );
}
