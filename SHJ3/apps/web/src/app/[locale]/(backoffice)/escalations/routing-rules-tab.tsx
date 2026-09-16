"use client";

/**
 * B8's routing rules manager + tester, built on `RuleListEditor` (`components/patterns/
 * rule-list-editor/`) — an already-built, already-tested organism whose own doc comment
 * names "B8's routing rules + rule tester" directly, and whose own test suite already
 * proves the canonical case this wave's hard requirement restates ("THE canonical case:
 * reordering rules changes the tester's outcome for the identical ticket, with no save
 * step"). This file's own job is real data + real persistence, not re-proving a
 * mechanism `rule-list-editor.test.tsx` already covers generically.
 *
 * ## Reorder is a genuinely local, unsaved edit — the hard requirement's own shape
 *
 * `onReorder` below only calls `setRules(next)` — it never calls
 * `actions.reorderRoutingRules`. Persisting the new order is a separate, explicit
 * **Save order** action, enabled only while the local order differs from the last-known
 * persisted order (`savedOrder`). This is deliberate: the checklist's own hard
 * requirement is "a rule tester evaluating the live, unsaved rule order" — a component
 * that persisted every reorder immediately would have no *unsaved* state left to prove
 * the distinction against. Enable/disable/edit/delete stay immediate, matching this
 * app's convention everywhere else on this screen.
 *
 * ## Two testers, one real reason for both
 *
 * `RuleListEditor`'s own bundled tester (`matches`/`renderTestForm`/`onRunTest`) runs
 * `ruleMatchesTicket` against the exact local, possibly-unsaved `rules` array — instant,
 * client-only, and what the hard requirement's own UX is actually about. `onRunTest`
 * *also* calls `actions.testRoutingRules` with that same array, which independently
 * re-evaluates it server-side through the identical `evaluateRoutingRules` engine and
 * records a real `RoutingRuleTests` audit row ("so a pre-live check is evidence rather
 * than a transient reassurance," the schema's own words) — the client-only result proves
 * the UX; the server round trip proves the audit trail is real. Both must agree, and
 * `routing-rules-tab.test.tsx` checks that they do.
 */
import * as React from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/form-field";
import { InlineAlert } from "@/components/ui/inline-alert";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/patterns/dialog";
import { RuleListEditor } from "@/components/patterns/rule-list-editor";
import {
  ruleMatchesTicket,
  type RuleAttribute,
  type RuleOperator,
  type RuleTargetKind,
  type TicketSample,
} from "../../../../modules/escalation/domain/routing-rule-engine.js";
import type { TestRoutingRulesResult } from "../../../../modules/escalation/application/test-routing-rules.js";
import type { RoutingRuleRow } from "../../../../modules/escalation/ports/routing-rule-repository.js";
import type { TeamOption } from "../../../../modules/escalation/ports/team-repository.js";
import type { RoutingRuleFormInput } from "./actions.js";
import type { EscalationsScreenActions } from "./escalations-screen.js";

const ATTRIBUTES: readonly RuleAttribute[] = ["Topic", "Priority", "Channel", "WaitTime"];
const TOPICS = ["Billing", "Customs", "Library", "General"] as const;
const PRIORITIES = ["Normal", "High"] as const;
const CHANNELS = ["WebWidget", "WhatsApp", "MobileApp", "KioskIvr"] as const;

function operatorFor(attribute: RuleAttribute): RuleOperator {
  return attribute === "WaitTime" ? "Gt" : "Eq";
}

function conditionSummary(rule: RoutingRuleRow, teams: readonly TeamOption[]): string {
  const attributeLabel = rule.attribute === "WaitTime" ? "Wait time" : rule.attribute;
  const operatorText = rule.attribute === "WaitTime" ? ">" : "=";
  const valueText = rule.attribute === "WaitTime" ? `${rule.value} min` : rule.value;
  const target =
    rule.targetKind === "Team"
      ? (teams.find((team) => team.id === rule.targetTeamId)?.name ?? rule.targetTeamId)
      : `Requeue${rule.alertSupervisor ? " + supervisor alert" : ""}`;
  return `${attributeLabel} ${operatorText} ${valueText} → ${target}`;
}

export interface RoutingRulesTabProps {
  readonly initialRules: readonly RoutingRuleRow[];
  readonly teams: readonly TeamOption[];
  readonly actions: EscalationsScreenActions;
}

export function RoutingRulesTab({
  initialRules,
  teams,
  actions,
}: RoutingRulesTabProps): React.ReactElement {
  const t = useTranslations("escalations.routingRules");
  const router = useRouter();

  const [rules, setRules] = React.useState<RoutingRuleRow[]>([...initialRules]);
  const [savedOrder, setSavedOrder] = React.useState<readonly string[]>(
    initialRules.map((r) => r.id),
  );
  const [error, setError] = React.useState<string | null>(null);
  const [savingOrder, setSavingOrder] = React.useState(false);
  const [editing, setEditing] = React.useState<RoutingRuleRow | "new" | null>(null);
  const [testInput, setTestInput] = React.useState<TicketSample>({
    topicKey: "Billing",
    priority: "High",
    channelKey: "WebWidget",
    waitTimeMinutes: 2,
  });
  const [serverResult, setServerResult] = React.useState<TestRoutingRulesResult | null>(null);

  React.useEffect(() => {
    setRules([...initialRules]);
    setSavedOrder(initialRules.map((r) => r.id));
  }, [initialRules]);

  const currentOrder = rules.map((r) => r.id);
  const orderIsDirty = currentOrder.join("|") !== savedOrder.join("|");

  async function handleSaveOrder(): Promise<void> {
    setSavingOrder(true);
    setError(null);
    const result = await actions.reorderRoutingRules(currentOrder, savedOrder);
    setSavingOrder(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setSavedOrder(currentOrder);
    router.refresh();
  }

  function handleDiscardOrder(): void {
    setRules(
      savedOrder
        .map(
          (id) =>
            rules.find((rule) => rule.id === id) ?? initialRules.find((rule) => rule.id === id),
        )
        .filter((rule): rule is RoutingRuleRow => rule !== undefined),
    );
  }

  async function handleToggleEnabled(rule: RoutingRuleRow): Promise<void> {
    setError(null);
    const next = !rule.isEnabled;
    setRules((prev) => prev.map((r) => (r.id === rule.id ? { ...r, isEnabled: next } : r)));
    const result = await actions.setRoutingRuleEnabled(rule.id, next);
    if (!result.ok) {
      setRules((prev) => prev.map((r) => (r.id === rule.id ? { ...r, isEnabled: !next } : r)));
      setError(result.error);
      return;
    }
    router.refresh();
  }

  async function handleDelete(rule: RoutingRuleRow): Promise<void> {
    setError(null);
    const result = await actions.deleteRoutingRule(rule.id);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setRules((prev) => prev.filter((r) => r.id !== rule.id));
    setSavedOrder((prev) => prev.filter((id) => id !== rule.id));
    router.refresh();
  }

  async function handleSaveRule(input: RoutingRuleFormInput): Promise<void> {
    setError(null);
    const result =
      editing === "new"
        ? await actions.createRoutingRule(input)
        : await actions.updateRoutingRule((editing as RoutingRuleRow).id, input);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setEditing(null);
    router.refresh();
  }

  async function handleRunTest(
    result: { rule: RoutingRuleRow; index: number } | null,
  ): Promise<void> {
    void result;
    const response = await actions.testRoutingRules(testInput, {
      mode: "provided",
      rules,
    });
    if (response.ok) setServerResult(response.value);
  }

  return (
    <div className="flex flex-col gap-4">
      {error ? <InlineAlert variant="destructive">{error}</InlineAlert> : null}

      <div className="flex justify-end gap-2">
        {orderIsDirty ? (
          <>
            <Button
              type="button"
              variant="outline"
              onClick={handleDiscardOrder}
              disabled={savingOrder}
            >
              {t("discardOrder")}
            </Button>
            <Button type="button" onClick={() => void handleSaveOrder()} loading={savingOrder}>
              {t("saveOrder")}
            </Button>
          </>
        ) : null}
        <Button type="button" variant="secondary" onClick={() => setEditing("new")}>
          {t("addRule")}
        </Button>
      </div>

      <RuleListEditor<RoutingRuleRow, TicketSample>
        aria-label={t("listAriaLabel")}
        rules={rules}
        onReorder={(next) => setRules([...next])}
        renderRule={(rule) => <p>{conditionSummary(rule, teams)}</p>}
        getRuleName={(rule) => conditionSummary(rule, teams)}
        isEnabled={(rule) => rule.isEnabled}
        onToggleEnabled={(rule) => void handleToggleEnabled(rule)}
        onEdit={(rule) => setEditing(rule)}
        editLabel={t("edit")}
        onDelete={(rule) => void handleDelete(rule)}
        deleteLabel={t("delete")}
        deleteDialogTitle={t("deleteDialogTitle")}
        matches={(rule, ticket) => ruleMatchesTicket(rule, ticket)}
        testInput={testInput}
        onTestInputChange={setTestInput}
        renderTestForm={({ input, onChange }) => (
          <fieldset className="flex flex-wrap gap-3">
            <legend className="sr-only">{t("testFormLegend")}</legend>
            <FormField label={t("testTopic")}>
              {(field) => (
                <Select
                  value={input.topicKey}
                  onValueChange={(value) => onChange({ ...input, topicKey: value })}
                >
                  <SelectTrigger {...field}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {TOPICS.map((topic) => (
                      <SelectItem key={topic} value={topic}>
                        {topic}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </FormField>
            <FormField label={t("testPriority")}>
              {(field) => (
                <Select
                  value={input.priority}
                  onValueChange={(value) => onChange({ ...input, priority: value })}
                >
                  <SelectTrigger {...field}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PRIORITIES.map((priority) => (
                      <SelectItem key={priority} value={priority}>
                        {priority}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </FormField>
            <FormField label={t("testChannel")}>
              {(field) => (
                <Select
                  value={input.channelKey}
                  onValueChange={(value) => onChange({ ...input, channelKey: value })}
                >
                  <SelectTrigger {...field}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CHANNELS.map((channel) => (
                      <SelectItem key={channel} value={channel}>
                        {channel}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </FormField>
            <FormField label={t("testWaitTime")}>
              {(field) => (
                <Select
                  value={String(input.waitTimeMinutes)}
                  onValueChange={(value) => onChange({ ...input, waitTimeMinutes: Number(value) })}
                >
                  <SelectTrigger {...field}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {[2, 6, 10].map((minutes) => (
                      <SelectItem key={minutes} value={String(minutes)}>
                        {minutes}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </FormField>
          </fieldset>
        )}
        onRunTest={(result) => void handleRunTest(result)}
        renderMatchedRuleSummary={(rule) =>
          t("firedSummary", { condition: conditionSummary(rule, teams) })
        }
        noMatchMessage={t("noMatch")}
        runTestLabel={t("runTest")}
        testerAriaLabel={t("testerAriaLabel")}
      />

      {serverResult ? (
        <div role="status" className="rounded-md border border-border p-3 text-sm">
          <p className="font-medium text-foreground">
            {serverResult.matched
              ? t("serverFired", { route: serverResult.firedRule?.routeToLabel ?? "" })
              : t("serverDefault", { route: serverResult.defaultQueueLabel ?? "" })}
          </p>
          {serverResult.differsFromSaved ? (
            <p className="text-warning-foreground">{t("differsFromSaved")}</p>
          ) : null}
        </div>
      ) : null}

      {editing ? (
        <RuleFormDialog
          initial={editing === "new" ? null : editing}
          teams={teams}
          onOpenChange={(open) => !open && setEditing(null)}
          onSubmit={handleSaveRule}
        />
      ) : null}
    </div>
  );
}

interface RuleFormDialogProps {
  readonly initial: RoutingRuleRow | null;
  readonly teams: readonly TeamOption[];
  readonly onOpenChange: (open: boolean) => void;
  readonly onSubmit: (input: RoutingRuleFormInput) => Promise<void>;
}

function RuleFormDialog({
  initial,
  teams,
  onOpenChange,
  onSubmit,
}: RuleFormDialogProps): React.ReactElement {
  const t = useTranslations("escalations.routingRules");
  const [attribute, setAttribute] = React.useState<RuleAttribute>(initial?.attribute ?? "Topic");
  const [value, setValue] = React.useState(initial?.value ?? "");
  const [targetKind, setTargetKind] = React.useState<RuleTargetKind>(initial?.targetKind ?? "Team");
  const [targetTeamId, setTargetTeamId] = React.useState<string | null>(
    initial?.targetTeamId ?? null,
  );
  const [alertSupervisor, setAlertSupervisor] = React.useState(initial?.alertSupervisor ?? false);
  const [pending, setPending] = React.useState(false);

  return (
    <Dialog open onOpenChange={(open) => !open && onOpenChange(false)}>
      <DialogContent size="md" closeLabel={t("closeLabel")}>
        <DialogHeader>
          <DialogTitle>{initial ? t("editDialogTitle") : t("addDialogTitle")}</DialogTitle>
        </DialogHeader>
        <form
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            void (async () => {
              setPending(true);
              await onSubmit({
                attribute,
                operator: operatorFor(attribute),
                value,
                targetKind,
                targetTeamId: targetKind === "Team" ? targetTeamId : null,
                alertSupervisor: targetKind === "Requeue" && alertSupervisor,
              });
              setPending(false);
            })();
          }}
        >
          <FormField label={t("fieldAttribute")}>
            {(field) => (
              <Select value={attribute} onValueChange={(v) => setAttribute(v as RuleAttribute)}>
                <SelectTrigger {...field}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ATTRIBUTES.map((a) => (
                    <SelectItem key={a} value={a}>
                      {a}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </FormField>
          <FormField
            label={t("fieldValue")}
            help={attribute === "WaitTime" ? t("fieldValueHelpMinutes") : undefined}
          >
            {(field) => (
              <Input
                {...field}
                value={value}
                onChange={(e) => setValue(e.target.value)}
                required
                dir="ltr"
              />
            )}
          </FormField>
          <FormField label={t("fieldTargetKind")}>
            {(field) => (
              <Select value={targetKind} onValueChange={(v) => setTargetKind(v as RuleTargetKind)}>
                <SelectTrigger {...field}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Team">{t("targetKindTeam")}</SelectItem>
                  <SelectItem value="Requeue">{t("targetKindRequeue")}</SelectItem>
                </SelectContent>
              </Select>
            )}
          </FormField>
          {targetKind === "Team" ? (
            <FormField label={t("fieldTargetTeam")}>
              {(field) => (
                <Select value={targetTeamId ?? ""} onValueChange={setTargetTeamId}>
                  <SelectTrigger {...field}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {teams.map((team) => (
                      <SelectItem key={team.id} value={team.id}>
                        {team.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </FormField>
          ) : (
            <label className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={alertSupervisor}
                onCheckedChange={(c) => setAlertSupervisor(c === true)}
              />
              {t("fieldAlertSupervisor")}
            </label>
          )}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={pending}
            >
              {t("cancel")}
            </Button>
            <Button type="submit" loading={pending}>
              {t("save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
