import { redirect } from "next/navigation";

/**
 * Plan Phase 3 (client-feedback-batch item 11) — Connector Alerts moved from
 * this standalone screen into MCP Health as an "Alert Configuration" tab (its
 * real spec home per screen B.3A.4; the standalone page was a reactive QA
 * patch, not a deliberate design decision). This route is kept as a permanent
 * redirect rather than deleted so a bookmarked/old link to
 * `/settings/connector-alerts` never resolves to a 404 — it lands on the same
 * screen, just on its new host and tab.
 */
export default function ConnectorAlertsRedirectPage() {
  redirect("/mcp-health?tab=alerts");
}
