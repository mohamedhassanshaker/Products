import { useMemo, useState } from "react";
import { Input } from "@nextbot/ui/components/ui/input";
import { Button } from "@nextbot/ui/components/ui/button";
import type { ListPayload } from "@nextbot/contracts";
import { useWidgetStore } from "../../store.js";

const SEARCH_THRESHOLD = 8;

/** A.2.3 — Interactive List / Picker. Search bar for >8 items (spec's own
 * threshold); collapses to a compact summary after selection (`docs/design/
 * UX_GUIDELINES.md` §5.3.3). */
export function ListBubble({ payload, disabled }: { payload: ListPayload; disabled?: boolean }) {
  const send = useWidgetStore((s) => s.send);
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(payload.selectedItemId ?? null);
  const isAnswered = disabled || selectedId !== null;

  const filtered = useMemo(() => {
    if (!query) return payload.items;
    const q = query.toLowerCase();
    return payload.items.filter((i) => i.label.toLowerCase().includes(q));
  }, [payload.items, query]);

  if (isAnswered && selectedId) {
    const selected = payload.items.find((i) => i.id === selectedId);
    return <div className="my-2 rounded-none border p-2 text-sm text-gray-700">You selected: {selected?.label ?? selectedId}</div>;
  }

  function handleSelect(id: string) {
    if (isAnswered) return;
    setSelectedId(id);
    void send("List", { ...payload, selectedItemId: id });
  }

  return (
    <div className="my-2 rounded-none border p-3">
      {payload.title && <p className="mb-2 text-sm font-bold">{payload.title}</p>}
      {payload.items.length > SEARCH_THRESHOLD && (
        <Input placeholder="Search…" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search list options" className="mb-2" />
      )}
      <div role="listbox" aria-live="polite" className="max-h-[200px] overflow-y-auto">
        {filtered.length === 0 ? (
          <p className="text-sm text-gray-500">No matching options</p>
        ) : (
          <div className="flex flex-col gap-1">
            {filtered.map((item) => (
              <div key={item.id} className="flex items-center justify-between" role="option" aria-selected={false}>
                <div>
                  <p className="text-sm">{item.label}</p>
                  {item.subtitle && <p className="text-xs text-gray-500">{item.subtitle}</p>}
                </div>
                <Button type="button" size="xs" variant="outline" onClick={() => handleSelect(item.id)}>
                  Select
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
