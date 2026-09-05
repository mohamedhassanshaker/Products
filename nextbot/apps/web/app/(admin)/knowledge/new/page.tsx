import { redirect } from "next/navigation";
import { getModuleAccessLevel } from "@/src/lib/require-module-access";
import { NewCollectionForm } from "../NewCollectionForm";

/** Creating a collection sets both general fields (`knowledge`) and the
 *  embedding/extraction route pins (`knowledge_config`) in one call — gated on
 *  BOTH being Write, same as the API route itself requires. */
export default async function NewKnowledgeCollectionPage() {
  const level = await getModuleAccessLevel("knowledge");
  const configLevel = await getModuleAccessLevel("knowledge_config");
  if (level !== "Write" || configLevel !== "Write") redirect("/knowledge");
  return <NewCollectionForm />;
}
