'use client';

import { Toaster as ChakraToaster, Toast, Portal, Spinner, Stack, createToaster } from '@chakra-ui/react';

/**
 * Process-wide toast/snackbar singleton (Chakra v3's own documented `Toaster` composition pattern) —
 * this app's equivalent of the legacy Angular app's `MatSnackBar` (`docs/design/UX_GUIDELINES.md`'s
 * repeated "transient confirmation via `MatSnackBar`" pattern, e.g. §3.1/§3.4's "Tenant suspended."/
 * "This tenant's status has changed. Refreshing…"). `toaster.create({...})` is called from any Client
 * Component; `<Toaster />` (mounted once in `components/ui/provider.tsx`) is what actually renders the
 * queued toasts.
 */
export const toaster = createToaster({
  placement: 'bottom-end',
  pauseOnPageIdle: true,
});

export function Toaster() {
  return (
    <Portal>
      <ChakraToaster toaster={toaster} insetInline={{ mdDown: '4' }}>
        {(toast) => (
          <Toast.Root width={{ md: 'sm' }}>
            {toast.type === 'loading' ? <Spinner size="sm" color="brand.solid" /> : <Toast.Indicator />}
            <Stack gap="1" flex="1" maxWidth="100%">
              {toast.title && <Toast.Title>{toast.title}</Toast.Title>}
              {toast.description && <Toast.Description>{toast.description}</Toast.Description>}
            </Stack>
            {toast.closable && <Toast.CloseTrigger />}
          </Toast.Root>
        )}
      </ChakraToaster>
    </Portal>
  );
}
