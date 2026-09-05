import { AccessDeniedState } from "@nextbot/ui";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@nextbot/ui/components/ui/tabs";
import { getModuleAccessLevel } from "@/src/lib/require-module-access";
import { DiffView } from "./DiffView";
import { StructuralDiffView } from "./StructuralDiffView";

/**
 * ADR-0016 §2.2 — two-tab presentation: "Structural diff" (the Git-independent
 * baseline, always available, ADR-0016) and "Git compare" (the real Git-provider
 * compare-API diff, ADR-0009, enriched view). The two are never blended into one
 * result — each tab is explicit about which artifact it's comparing against
 * (NextBot's own stored YAML vs. the tenant's Git history) so a reader always knows
 * which one they're looking at. Structural diff opens first since it's the
 * unconditional baseline every version supports, Git-connected or not.
 */
export default async function DiffPage({ searchParams }: { searchParams: Promise<{ a?: string; b?: string }> }) {
  const level = await getModuleAccessLevel("agent_platform");
  if (level === "None") return <AccessDeniedState moduleLabel="Agent Platform" />;
  const { a, b } = await searchParams;
  if (!a || !b) return <AccessDeniedState moduleLabel="Agent Platform" homeHref="/agent-platform/definitions" />;
  return (
    <div>
      <h1 className="mb-4 font-heading text-lg font-semibold">Compare versions</h1>
      <Tabs defaultValue="structural">
        <TabsList>
          <TabsTrigger id="diff-tab-structural" panelId="diff-panel-structural" value="structural">
            Structural diff
          </TabsTrigger>
          <TabsTrigger id="diff-tab-git" panelId="diff-panel-git" value="git">
            Git compare
          </TabsTrigger>
        </TabsList>
        <TabsContent id="diff-panel-structural" value="structural">
          <StructuralDiffView versionAId={a} versionBId={b} />
        </TabsContent>
        <TabsContent id="diff-panel-git" value="git">
          <DiffView versionAId={a} versionBId={b} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
