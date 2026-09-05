import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@nextbot/ui/components/ui/table";
import type { DataTablePayload } from "@nextbot/contracts";

/** Phase 12 (BL-05) — Data Table Card: tabular MCP tool output. Scrolls horizontally
 * inside its own container rather than the whole widget window. */
export function DataTableBubble({ payload }: { payload: DataTablePayload }) {
  return (
    <div className="my-2 rounded-none border p-3">
      {payload.title && <p className="mb-2 text-sm font-bold">{payload.title}</p>}
      <div className="max-w-full overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              {payload.columns.map((col, i) => (
                <TableHead key={i}>{col}</TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {payload.rows.map((row, i) => (
              <TableRow key={i}>
                {row.map((cell, j) => (
                  <TableCell key={j}>{cell}</TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
