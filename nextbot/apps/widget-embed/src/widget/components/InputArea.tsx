import { useState, type FormEvent } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { Sent02Icon } from "@hugeicons/core-free-icons";
import { Input } from "@nextbot/ui/components/ui/input";
import { Button } from "@nextbot/ui/components/ui/button";
import { useWidgetStore } from "../store.js";

/** A.1.2 input area — text field + send button (attachment/voice-input toggles are
 * out of scope this phase, since file upload and voice mode are deferred). */
export function InputArea() {
  const send = useWidgetStore((s) => s.send);
  const [value, setValue] = useState("");

  function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const text = value.trim();
    if (!text) return;
    void send("Text", { contentType: "Text", text });
    setValue("");
  }

  return (
    <form onSubmit={handleSubmit}>
      <div className="flex items-center gap-2 border-t p-2">
        <Input
          placeholder="Type a message…"
          aria-label="Message"
          value={value}
          onChange={(e) => setValue(e.target.value)}
        />
        <Button type="submit" aria-label="Send message" size="icon-sm" className="shrink-0">
          <HugeiconsIcon icon={Sent02Icon} size={16} strokeWidth={2} aria-hidden="true" />
        </Button>
      </div>
    </form>
  );
}
