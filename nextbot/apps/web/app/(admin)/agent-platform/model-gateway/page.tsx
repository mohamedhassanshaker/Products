import { redirect } from "next/navigation";

/**
 * Target Architecture Blueprint Phase 2 (BL-33, LLD §14.8/§14.9.6) — RETIRED. Route
 * management (previously this page's "Routes" tab) and Provider Registry management
 * (previously its "Provider Registry" tab, already read-only here) both now live on
 * the unified `/model-gateway` console (Routes/Providers/Model Catalog/Usage tabs),
 * which Phase 1 already introduced for the Provider Registry + Model Catalog. This
 * page is kept only as a redirect so an existing bookmark/link still lands
 * somewhere useful, rather than a bare 404.
 */
export default function LegacyModelGatewayPage() {
  redirect("/model-gateway");
}
