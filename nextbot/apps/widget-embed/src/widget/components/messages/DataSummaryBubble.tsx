import type { DataSummaryPayload } from "@nextbot/contracts";

/** Phase 12 (BL-05) — Data Summary Card: a small set of labeled key/value facts
 * (e.g. an order-status lookup result), FR-MCP-07's simplest MCP-result rendering. */
export function DataSummaryBubble({ payload }: { payload: DataSummaryPayload }) {
  return (
    <div className="my-2 rounded-none border p-3">
      {payload.title && <p className="mb-2 text-sm font-bold">{payload.title}</p>}
      <div className="flex flex-col gap-1">
        {payload.fields.map((field, i) => (
          <div key={i} className="flex justify-between text-sm">
            <span className="text-gray-600">{field.label}</span>
            <span className="font-medium">{field.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
