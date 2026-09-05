"use client";

import { useEffect, useState } from "react";
import yaml from "js-yaml";
import { Skeleton } from "@nextbot/ui/components/ui/skeleton";
import { Alert, AlertDescription } from "@nextbot/ui/components/ui/alert";
import { fetchJson } from "@/src/lib/fetch-json";
import { SkillForm, type SkillFormValues } from "../../../SkillForm";

interface SkillRow {
  id: string;
  name: string;
}

interface SkillVersionRow {
  id: string;
  version: number;
  yaml: string;
}

/** Loads the skill's latest version's YAML and pre-fills the shared `SkillForm` in
 * "version" mode — every edit creates version N+1, this screen never mutates the
 * source version it prefilled from (LLD §14.5.1). */
export function NewSkillVersionForm({ skillId }: { skillId: string }) {
  const [initial, setInitial] = useState<Partial<SkillFormValues> | null>(null);
  const [nextVersion, setNextVersion] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const [skillResult, versionsResult] = await Promise.all([
        fetchJson<{ skill: SkillRow }>(`/api/v1/admin/skills/${skillId}`),
        fetchJson<{ versions: SkillVersionRow[] }>(`/api/v1/admin/skills/${skillId}/versions`),
      ]);
      if (skillResult.kind !== "ok" || versionsResult.kind !== "ok") {
        setError(skillResult.kind === "error" ? skillResult.message : "Failed to load skill.");
        return;
      }
      const latest = [...versionsResult.data.versions].sort((a, b) => b.version - a.version)[0];
      setNextVersion((latest?.version ?? 0) + 1);
      if (!latest) {
        setInitial({ name: skillResult.data.skill.name });
        return;
      }
      const parsed = yaml.load(latest.yaml) as {
        trigger?: string;
        scope?: { capabilityGroups?: string[]; tools?: string[]; knowledge?: string[] };
        instructions?: string;
        successCriteria?: string;
        escalateWhen?: string[];
        evalCases?: string[];
      };
      setInitial({
        name: skillResult.data.skill.name,
        trigger: parsed.trigger ?? "",
        capabilityGroups: (parsed.scope?.capabilityGroups ?? []).join(", "),
        tools: (parsed.scope?.tools ?? []).join(", "),
        knowledge: (parsed.scope?.knowledge ?? []).join(", "),
        instructions: parsed.instructions ?? "",
        successCriteria: parsed.successCriteria ?? "",
        escalateWhen: (parsed.escalateWhen ?? []).join("\n"),
        evalCases: (parsed.evalCases ?? []).join(", "),
      });
    })();
  }, [skillId]);

  if (error) {
    return (
      <Alert variant="destructive">
        <AlertDescription>{error}</AlertDescription>
      </Alert>
    );
  }

  if (!initial || nextVersion === null) {
    return <Skeleton className="h-[400px] w-full" role="status" aria-label="Loading skill version" />;
  }

  return <SkillForm mode="version" skillId={skillId} nextVersion={nextVersion} initial={initial} />;
}
