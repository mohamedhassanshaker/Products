"use client";

import { useState } from "react";
import { Card, CardHeader, CardTitle, CardDescription } from "@nextbot/ui/components/ui/card";
import { Badge } from "@nextbot/ui/components/ui/badge";
import { CreateChannelForm } from "./CreateChannelForm";
import { CreateWhatsAppChannelForm } from "./CreateWhatsAppChannelForm";

/**
 * FR-OC-03's "Add Channel" type-selection step (UX_GUIDELINES.md §7.1) — a card
 * grid mirroring the Add Connector Wizard's "Choose Type" step (§3.1) exactly.
 * Messenger/Instagram/other unbuilt types are shown as visible, disabled "Coming
 * soon" cards per the explicit instruction that admins should see the roadmap
 * rather than a silently-shorter list; X/Twitter is omitted entirely (dropped from
 * spec scope by user decision, not merely deferred).
 */
const COMING_SOON_TYPES = ["Messenger", "Instagram", "Voice", "Email", "Sms", "Slack", "Teams"] as const;

export function ChannelTypePicker() {
  const [selected, setSelected] = useState<"WebWidget" | "WhatsApp" | null>(null);

  if (selected === "WebWidget") return <CreateChannelForm />;
  if (selected === "WhatsApp") return <CreateWhatsAppChannelForm />;

  return (
    <div className="max-w-3xl">
      <h1 className="mb-6 font-heading text-lg font-semibold">Add Channel</h1>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3">
        <button type="button" onClick={() => setSelected("WebWidget")} className="text-start">
          <Card className="hover:ring-2 hover:ring-primary">
            <CardHeader>
              <CardTitle role="heading" aria-level={2}>
                Web Widget
              </CardTitle>
              <CardDescription>Embed a chat launcher on your website or app.</CardDescription>
            </CardHeader>
          </Card>
        </button>

        <button type="button" onClick={() => setSelected("WhatsApp")} className="text-start">
          <Card className="hover:ring-2 hover:ring-primary">
            <CardHeader>
              <CardTitle role="heading" aria-level={2}>
                WhatsApp
              </CardTitle>
              <CardDescription>Connect via Meta Business Manager — WABA, templates, opt-in tracking.</CardDescription>
            </CardHeader>
          </Card>
        </button>

        {COMING_SOON_TYPES.map((type) => (
          <Card key={type} className="relative opacity-60" aria-disabled="true" aria-label={`${type} — coming soon`} tabIndex={0}>
            <Badge variant="secondary" className="absolute top-2 end-2">
              Coming soon
            </Badge>
            <CardHeader>
              <CardTitle role="heading" aria-level={2} className="text-muted-foreground">
                {type}
              </CardTitle>
            </CardHeader>
          </Card>
        ))}
      </div>
    </div>
  );
}
