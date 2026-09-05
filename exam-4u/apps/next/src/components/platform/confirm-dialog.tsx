'use client';

import { useState } from 'react';
import { Button, Dialog, Field, Input, Portal, Stack, Text } from '@chakra-ui/react';

export interface ConfirmDialogProps {
  open: boolean;
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel?: string;
  /** `'danger'` renders the confirm button in the destructive (`red`) palette — reserved for the
   * soft-delete flow (`docs/design/UX_GUIDELINES.md` §3.4 extension, this dispatch's own judgment
   * call on graduated confirmation strength by reversibility). Suspend uses the default palette —
   * real but reversible impact, not a destructive one. */
  tone?: 'default' | 'danger';
  loading?: boolean;
  /**
   * When set, the confirm button stays disabled until the admin types this exact string into a
   * confirmation input (industry-standard "type the resource name to confirm" pattern) — this
   * dispatch's deliberately *stronger* confirmation for soft-delete specifically, on top of the
   * ordinary confirm dialog every other destructive-ish action here uses. See
   * `docs/plans/nextjs-rewrite-phase2-plan.md`'s "Decisions made" for the full reversibility-based
   * reasoning (soft-delete starts a purge countdown and blocks all tenant access, a materially larger
   * behavioral impact than a reversible suspend).
   */
  requireTypedConfirmation?: string;
  onConfirm(): void;
  onCancel(): void;
}

/**
 * Generic, reusable confirm dialog (`docs/design/UX_GUIDELINES.md` §3.4's "lightweight confirm
 * dialog" pattern, this app's Chakra-v3 equivalent of legacy's `shared/ui/confirm-dialog`) — every
 * platform-console action needing confirmation (suspend, soft-delete) renders this component rather
 * than a bespoke one per screen.
 *
 * Escape-to-close and outside-click-to-close are both disabled while `loading` is true (mirrors
 * §3.3's identical rule for the create-tenant modal: an in-flight mutating request should never be
 * silently abandoned mid-flight from the admin's point of view).
 */
export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel,
  cancelLabel = 'Cancel',
  tone = 'default',
  loading = false,
  requireTypedConfirmation,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const [typedValue, setTypedValue] = useState('');

  const confirmDisabled = loading || (requireTypedConfirmation !== undefined && typedValue !== requireTypedConfirmation);

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(details) => {
        if (!details.open && !loading) {
          setTypedValue('');
          onCancel();
        }
      }}
      role="alertdialog"
      closeOnInteractOutside={!loading}
      closeOnEscape={!loading}
    >
      <Portal>
        <Dialog.Backdrop />
        <Dialog.Positioner>
          <Dialog.Content>
            <Dialog.Header>
              <Dialog.Title>{title}</Dialog.Title>
            </Dialog.Header>
            <Dialog.Body>
              <Stack gap="3">
                <Text>{message}</Text>
                {requireTypedConfirmation !== undefined && (
                  <Field.Root>
                    <Field.Label>
                      Type <Text as="span" fontWeight="bold">{requireTypedConfirmation}</Text> to confirm
                    </Field.Label>
                    <Input
                      value={typedValue}
                      onChange={(e) => setTypedValue(e.target.value)}
                      disabled={loading}
                      autoComplete="off"
                      data-testid="confirm-dialog-typed-input"
                    />
                  </Field.Root>
                )}
              </Stack>
            </Dialog.Body>
            <Dialog.Footer>
              <Button variant="outline" onClick={onCancel} disabled={loading}>
                {cancelLabel}
              </Button>
              <Button
                colorPalette={tone === 'danger' ? 'red' : 'brand'}
                onClick={onConfirm}
                loading={loading}
                disabled={confirmDisabled}
                data-testid="confirm-dialog-confirm"
              >
                {confirmLabel}
              </Button>
            </Dialog.Footer>
          </Dialog.Content>
        </Dialog.Positioner>
      </Portal>
    </Dialog.Root>
  );
}
