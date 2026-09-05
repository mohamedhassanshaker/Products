import { AccessDeniedState } from "@nextbot/ui";
import { getModuleAccessLevel } from "@/src/lib/require-module-access";
import { RetrievalPlayground } from "./RetrievalPlayground";

/**
 * Retrieval Playground entry page (Target Architecture Blueprint Phase 9, BL-40,
 * FR-KB-05). Gated on the `knowledge` module at `Read` — same boundary the Graph
 * Explorer (Phase 8) uses: comparing retrieval strategies is a read-only action over
 * already-ingested data (it makes real Model Gateway calls, but mutates nothing
 * persistent), so `Read` is sufficient, never requiring `Write`.
 */
export default async function RetrievalPlaygroundPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const level = await getModuleAccessLevel("knowledge");
  if (level === "None") return <AccessDeniedState moduleLabel="Knowledge" />;
  return <RetrievalPlayground collectionId={id} />;
}
