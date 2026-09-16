"use client";

/**
 * B3 step 9 — Test (the sandbox chat). Review-comments-3: this step used to be a permanent
 * stub ("the sandbox runtime doesn't exist yet"), which was stale — a real conversation/
 * flow-execution engine has shipped for real citizen channels all along; only this
 * backoffice step was never wired to it. See `sendSandboxTurnAction`'s own doc comment
 * (`agents/actions.ts`) for exactly what that wiring is.
 *
 * Runs against the CURRENT DRAFT flow version, resolved the same way `FlowsStep` already
 * does (`loadFlowsStepData`) — never the last Published version. Writes no real conversation
 * data, and a bound `ApiConnector` tool call is simulated rather than really invoked
 * (`apps/ai`'s `SandboxToolInvoker`) — both stated plainly in the banner below so a tester is
 * never misled about what a sandbox session actually touches.
 *
 * Reuses `ChatThread`/`Composer` exactly like the already-shipped AI flow-editing sidebar
 * (`flows-step.tsx`'s `AiFlowEditSidebar`) — same turn-by-turn shape, same client-minted
 * `crypto.randomUUID()` turn-id convention.
 */

import * as React from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { InlineAlert } from "@/components/ui/inline-alert";
import { ChatThread } from "@/components/patterns/chat-thread/chat-thread";
import type { ChatTurn } from "@/components/patterns/chat-thread/chat-thread-types";
import { Composer } from "@/components/patterns/composer/composer";
import type { loadFlowsStepDataAction, sendSandboxTurnAction } from "../../../actions.js";

export interface TestStepProps {
  readonly agentId: string;
  readonly agentVersionId: string;
  readonly ownerTenantId: string;
  readonly agentName: string;
  readonly locale: string;
  readonly loadFlowsStepData: typeof loadFlowsStepDataAction;
  readonly sendSandboxTurn: typeof sendSandboxTurnAction;
}

export function TestStep({
  agentId,
  agentVersionId,
  ownerTenantId,
  agentName,
  locale,
  loadFlowsStepData,
  sendSandboxTurn,
}: TestStepProps): React.ReactElement {
  const t = useTranslations("agents.wizard.test");
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [flowVersionId, setFlowVersionId] = React.useState<string | null>(null);
  const [sessionId, setSessionId] = React.useState<string>(() => crypto.randomUUID());
  const [turns, setTurns] = React.useState<readonly ChatTurn[]>([]);
  const [composerValue, setComposerValue] = React.useState("");
  const [sending, setSending] = React.useState(false);
  /** The next `turnOrdinal` to send — a plain ref, not state: it never drives a render itself, only what the next `sendSandboxTurn` call carries. */
  const turnOrdinalRef = React.useRef(0);

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const result = await loadFlowsStepData({
        agentVersionId,
        ownerTenantId,
        newFlowName: `${agentName} flow`,
      });
      if (cancelled) return;
      setLoading(false);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setFlowVersionId(result.value.flowVersionId);
    })();
    return () => {
      cancelled = true;
    };
    // Runs once on mount, matching `FlowsStep`'s identical single-load pattern.
  }, []);

  function handleRestart(): void {
    setSessionId(crypto.randomUUID());
    setTurns([]);
    turnOrdinalRef.current = 0;
    setError(null);
  }

  async function handleSend(): Promise<void> {
    const content = composerValue.trim();
    if (!content || !flowVersionId) return;

    const userTurn: ChatTurn = {
      id: crypto.randomUUID(),
      role: "user",
      text: content,
      timestamp: new Date(),
    };
    setTurns((current) => [...current, userTurn]);
    setComposerValue("");
    setSending(true);
    setError(null);

    const turnOrdinal = turnOrdinalRef.current;
    turnOrdinalRef.current += 1;

    const result = await sendSandboxTurn({
      sandboxSessionId: sessionId,
      agentId,
      agentVersionId,
      flowVersionId,
      turnId: crypto.randomUUID(),
      turnOrdinal,
      content,
      locale,
    });
    setSending(false);

    if (!result.ok) {
      setError(result.error);
      return;
    }

    setTurns((current) => [
      ...current,
      {
        id: crypto.randomUUID(),
        role: "assistant",
        text: result.value.message.content,
        timestamp: new Date(),
      },
    ]);
  }

  if (loading) {
    return <p className="text-sm text-muted-foreground">{t("loading")}</p>;
  }

  return (
    <div className="flex flex-col gap-4">
      {error ? <InlineAlert variant="destructive">{error}</InlineAlert> : null}
      <InlineAlert variant="warning">{t("sandboxNotice")}</InlineAlert>

      <div className="flex items-center justify-between gap-4">
        <p className="text-sm text-muted-foreground">{t("intro")}</p>
        <Button type="button" size="sm" variant="outline" onClick={handleRestart}>
          {t("restartAction")}
        </Button>
      </div>

      <ChatThread
        turns={turns}
        variant="transcript"
        state={sending ? "thinking" : "idle"}
        aria-label={t("transcriptAriaLabel")}
        emptyLabel={t("emptyTranscript")}
      />

      <Composer
        value={composerValue}
        onValueChange={setComposerValue}
        onSend={() => void handleSend()}
        status={sending ? { type: "sending" } : { type: "idle" }}
        placeholder={t("composerPlaceholder")}
        ariaLabel={t("composerAriaLabel")}
        sendLabel={t("composerSendLabel")}
      />
    </div>
  );
}
