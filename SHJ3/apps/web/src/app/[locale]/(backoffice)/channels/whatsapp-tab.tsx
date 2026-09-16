"use client";

/** B10 tab 3 — WhatsApp. Number/BSP/opt-in/session-window settings (session window is
 *  read-only in effect — pinned at 24 by `CK_WhatsAppConfigs_sessionWindow`, a Meta platform
 *  rule) and the template registry with `+ Submit new template`. */
import * as React from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { InlineAlert } from "@/components/ui/inline-alert";
import { Label } from "@/components/ui/label";
import { StatusCell, type StatusFamily } from "@/components/ui/status-cell";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { DataTable } from "@/components/patterns/data-table/data-table";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/patterns/dialog";
import type { ColumnDef } from "@tanstack/react-table";
import type { WhatsAppSettingsSnapshot } from "../../../../modules/channels/application/get-whatsapp-settings.js";
import type { MessageTemplateRow } from "../../../../modules/channels/ports/message-template-repository.js";
import type { TemplateApprovalStatus } from "../../../../modules/channels/domain/vocabulary.js";
import type { ChannelsScreenActions } from "./channels-screen.js";

const APPROVAL_FAMILY: Readonly<Record<TemplateApprovalStatus, StatusFamily>> = {
  Draft: "neutral",
  Pending: "warning",
  Approved: "success",
  Rejected: "destructive",
};
const APPROVAL_RANK: Readonly<Record<TemplateApprovalStatus, number>> = {
  Approved: 0,
  Pending: 1,
  Draft: 2,
  Rejected: 3,
};

export interface WhatsAppTabProps {
  readonly channelId: string;
  readonly settings: WhatsAppSettingsSnapshot;
  /** `agents:publish` — gates Approve/Reject below (`actions.ts`'s own real permission
   *  check for both). Never rendered for a principal who lacks it, matching this app's
   *  established separation-of-duties convention (`agents-screen.tsx`'s Publish/Unpublish
   *  row actions) — found missing here by a real E2E run as an `agents:manage`-only
   *  principal, whose click reached a real, correctly-enforced server-side denial only
   *  after the control was already shown. */
  readonly canPublish: boolean;
  readonly actions: ChannelsScreenActions;
}

export function WhatsAppTab({
  channelId,
  settings,
  canPublish,
  actions,
}: WhatsAppTabProps): React.ReactElement {
  const t = useTranslations("channels.whatsapp");
  const router = useRouter();

  const [phoneNumber, setPhoneNumber] = React.useState(settings.config.phoneNumber);
  const [wabaId, setWabaId] = React.useState(settings.config.wabaId);
  const [optInRequired, setOptInRequired] = React.useState(settings.config.optInRequired);
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [showSubmitDialog, setShowSubmitDialog] = React.useState(false);
  const optInId = React.useId();

  async function handleSaveConfig(): Promise<void> {
    setPending(true);
    setError(null);
    const result = await actions.updateWhatsAppConfig({
      channelId,
      phoneNumber,
      wabaId,
      optInRequired,
    });
    setPending(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    router.refresh();
  }

  async function handleApprove(templateId: string): Promise<void> {
    setError(null);
    const bspTemplateId = window.prompt(t("bspTemplateIdPrompt")) ?? "";
    if (!bspTemplateId) return;
    const result = await actions.approveMessageTemplate({ id: templateId, bspTemplateId });
    if (!result.ok) {
      setError(result.error);
      return;
    }
    router.refresh();
  }

  async function handleReject(templateId: string): Promise<void> {
    setError(null);
    const reason = window.prompt(t("rejectionReasonPrompt")) ?? "";
    if (!reason) return;
    const result = await actions.rejectMessageTemplate({ id: templateId, reason });
    if (!result.ok) {
      setError(result.error);
      return;
    }
    router.refresh();
  }

  const columns = React.useMemo<ColumnDef<MessageTemplateRow, unknown>[]>(
    () => [
      { id: "name", accessorKey: "name", header: t("columnTemplate"), meta: { identifying: true } },
      {
        id: "approvalStatus",
        accessorKey: "approvalStatus",
        header: t("columnStatus"),
        cell: ({ row }) => (
          <StatusCell
            label={t(`status.${row.original.approvalStatus}` as "status.Approved")}
            family={APPROVAL_FAMILY[row.original.approvalStatus]}
            rank={APPROVAL_RANK[row.original.approvalStatus]}
          />
        ),
        sortingFn: (a, b) =>
          APPROVAL_RANK[a.original.approvalStatus] - APPROVAL_RANK[b.original.approvalStatus],
      },
    ],
    [t],
  );

  return (
    <div className="flex flex-col gap-6">
      {error ? <InlineAlert variant="destructive">{error}</InlineAlert> : null}

      <div className="flex flex-col gap-4 rounded-md border border-border p-4">
        <h2 className="text-sm font-medium text-foreground">{t("settingsHeading")}</h2>
        <FormField label={t("fieldPhoneNumber")}>
          {(field) => (
            <Input
              {...field}
              dir="ltr"
              value={phoneNumber}
              onChange={(event) => setPhoneNumber(event.target.value)}
            />
          )}
        </FormField>
        <FormField label={t("fieldWabaId")}>
          {(field) => (
            <Input
              {...field}
              dir="ltr"
              value={wabaId}
              onChange={(event) => setWabaId(event.target.value)}
            />
          )}
        </FormField>
        <div className="flex items-center justify-between gap-4">
          <Label htmlFor={optInId}>{t("fieldOptInRequired")}</Label>
          <Switch id={optInId} checked={optInRequired} onCheckedChange={setOptInRequired} />
        </div>
        <p className="text-sm text-muted-foreground">
          {t("sessionWindowReadOnly", { hours: settings.config.sessionWindowHours })}
        </p>
        <div>
          <Button type="button" loading={pending} onClick={() => void handleSaveConfig()}>
            {t("saveAction")}
          </Button>
        </div>
      </div>

      <div className="flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium text-foreground">{t("templatesHeading")}</h2>
          <Button type="button" size="sm" onClick={() => setShowSubmitDialog(true)}>
            {t("submitTemplateAction")}
          </Button>
        </div>
        <DataTable
          columns={columns}
          data={settings.templates}
          getRowId={(row) => row.id}
          getRowLabel={(row) => row.name}
          caption={t("templatesHeading")}
          captionVisuallyHidden
          renderRowActions={(row) =>
            row.approvalStatus === "Pending" && canPublish ? (
              <div className="flex items-center gap-1">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => void handleApprove(row.id)}
                >
                  {t("approveAction")}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => void handleReject(row.id)}
                >
                  {t("rejectAction")}
                </Button>
              </div>
            ) : null
          }
        />
      </div>

      {showSubmitDialog ? (
        <SubmitTemplateDialog
          onOpenChange={setShowSubmitDialog}
          onSubmit={async (input) => {
            const result = await actions.submitMessageTemplate(input);
            if (!result.ok) {
              setError(result.error);
              return;
            }
            if (!result.value.ok) {
              setError(
                result.value.reason === "channels.template_duplicate_name"
                  ? t("templateDuplicateNameError")
                  : t("templatePlaceholderMismatchError"),
              );
              return;
            }
            setShowSubmitDialog(false);
            router.refresh();
          }}
        />
      ) : null}
    </div>
  );
}

interface SubmitTemplateDialogProps {
  readonly onOpenChange: (open: boolean) => void;
  readonly onSubmit: (input: {
    readonly name: string;
    readonly channelKey: string;
    readonly category: string;
    readonly bodySample: string;
    readonly variables: readonly string[];
    readonly localeCode: string;
  }) => Promise<void>;
}

function SubmitTemplateDialog({
  onOpenChange,
  onSubmit,
}: SubmitTemplateDialogProps): React.ReactElement {
  const t = useTranslations("channels.whatsapp");
  const [name, setName] = React.useState("");
  const [bodySample, setBodySample] = React.useState("");
  const [pending, setPending] = React.useState(false);

  return (
    <Dialog open onOpenChange={(open) => !open && onOpenChange(false)}>
      <DialogContent size="md" closeLabel={t("closeLabel")}>
        <DialogHeader>
          <DialogTitle>{t("submitDialogTitle")}</DialogTitle>
        </DialogHeader>
        <form
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            const placeholderCount = (bodySample.match(/\{\{\d+\}\}/g) ?? []).length;
            void (async () => {
              setPending(true);
              await onSubmit({
                name,
                channelKey: "WhatsApp",
                category: "Utility",
                bodySample,
                variables: Array.from({ length: placeholderCount }, (_value, i) => {
                  void _value;
                  return `var${String(i + 1)}`;
                }),
                localeCode: "en",
              });
              setPending(false);
            })();
          }}
        >
          <FormField label={t("fieldTemplateName")}>
            {(field) => (
              <Input
                {...field}
                dir="ltr"
                value={name}
                onChange={(event) => setName(event.target.value)}
                required
              />
            )}
          </FormField>
          <FormField label={t("fieldSampleBody")} help={t("fieldSampleBodyHelp")}>
            {(field) => (
              <Textarea
                {...field}
                dir="ltr"
                value={bodySample}
                onChange={(event) => setBodySample(event.target.value)}
                required
              />
            )}
          </FormField>
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
              {t("submitDialogSubmit")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
