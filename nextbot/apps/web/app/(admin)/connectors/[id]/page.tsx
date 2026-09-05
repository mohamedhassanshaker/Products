import { AccessDeniedState } from "@nextbot/ui";
import { getSession, getSessionTenantContext } from "@/src/lib/session";
import { getModuleAccessLevel } from "@/src/lib/require-module-access";
import { isUuid } from "@/src/lib/is-uuid";
import { redirect } from "next/navigation";
import { handleGetConnector } from "@nextbot/connectors";

export default async function ConnectorDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) redirect("/login");
  // QA Defect U3: same fail-closed deep-link guard as the Connectors list — a
  // direct link to a specific connector must not bypass the None-access check.
  const level = await getModuleAccessLevel("connectors");
  if (level === "None") return <AccessDeniedState moduleLabel="Connectors" />;
  const ctx = await getSessionTenantContext(session);
  const { id } = await params;

  // QA Final Review minor item: a non-UUID `id` (e.g. a typo'd or hand-edited
  // URL) previously reached `handleGetConnector` -> a `uuid`-typed DB column
  // comparison, throwing an unhandled Postgres error (a raw 500) instead of a
  // clean "not found." Treated identically to a real-but-unknown id below.
  const connector = isUuid(id) ? await handleGetConnector(ctx, id) : null;

  if (!connector) {
    return <p>Connector not found.</p>;
  }

  return (
    <>
      <h1 className="mb-2 font-heading text-lg font-semibold">{connector.name}</h1>
      <p className="text-muted-foreground">
        {connector.backendType} · {connector.environment} · {connector.transport}
      </p>
      <p className="mt-4 text-muted-foreground">
        View the discovered tool catalog from the Tool Catalog screen, filtered by this connector.
      </p>
    </>
  );
}
