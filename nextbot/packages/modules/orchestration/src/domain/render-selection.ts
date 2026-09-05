import type { MessagePayload } from "@nextbot/contracts";

/**
 * `RENDER` (LLD §6.2 step 9 / §7.5, FR-MCP-07) — maps a validated MCP tool result to
 * one of the four Phase-12 card payload types, with no per-connector UI code: the
 * selection is a structural shape test on the *already output-schema-validated*
 * result object (validation itself happens at the `mcp-client` egress boundary, not
 * here), so any connector whose tool returns one of these shapes renders
 * automatically. Anything that matches none of them degrades to a plain `Text`
 * summary rather than dropping the result silently.
 */
export function selectRenderedCard(toolName: string, output: unknown): MessagePayload {
  if (isRecord(output)) {
    if (Array.isArray(output.columns) && Array.isArray(output.rows)) {
      return {
        contentType: "DataTable",
        title: typeof output.title === "string" ? output.title : undefined,
        columns: output.columns.map(String),
        rows: (output.rows as unknown[]).map((row) => (Array.isArray(row) ? row.map(String) : [String(row)])),
      };
    }
    if (Array.isArray(output.fields) && output.fields.every((f) => isRecord(f) && "label" in f && "value" in f)) {
      return {
        contentType: "DataSummary",
        title: typeof output.title === "string" ? output.title : undefined,
        fields: (output.fields as Array<{ label: unknown; value: unknown }>).map((f) => ({ label: String(f.label), value: String(f.value) })),
      };
    }
    if (typeof output.url === "string" && (typeof output.mimeType === "string" || typeof output.sizeBytes === "number")) {
      return {
        contentType: "Document",
        title: typeof output.title === "string" ? output.title : toolName,
        url: output.url,
        mimeType: typeof output.mimeType === "string" ? output.mimeType : undefined,
        sizeBytes: typeof output.sizeBytes === "number" ? output.sizeBytes : undefined,
      };
    }
    if (typeof output.url === "string") {
      return {
        contentType: "ExternalLink",
        title: typeof output.title === "string" ? output.title : toolName,
        url: output.url,
        description: typeof output.description === "string" ? output.description : undefined,
      };
    }
    // QA Final Review S3: a realistic tool result is very often a generic flat
    // key-value object that matches none of NextBot's own narrow output
    // conventions above (`{columns,rows}`/`{fields:[...]}`/`{url}`) — previously
    // that fell all the way through to a raw `JSON.stringify` text dump, which in
    // the observed QA case surfaced a customer email address to the customer
    // themselves as unstructured text. Render it as the same `DataSummary` card
    // shape as the explicit `{fields:[...]}` case, using the object's own keys as
    // labels, so a nested-object/array-of-objects-free flat shape gets a
    // structured card by default instead of a raw dump. Genuinely nested/complex
    // shapes (containing an object or array value) still fall through to the
    // `Text` summary below, since a flat card can't represent them faithfully.
    const flatEntries = Object.entries(output).filter(([, v]) => v === null || typeof v !== "object");
    if (flatEntries.length > 0 && flatEntries.length === Object.keys(output).length) {
      return {
        contentType: "DataSummary",
        title: toolName,
        fields: flatEntries.map(([label, value]) => ({ label, value: value === null ? "" : String(value) })),
      };
    }
  }
  return { contentType: "Text", text: `Result from ${toolName}: ${JSON.stringify(output)}`.slice(0, 8000) };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
