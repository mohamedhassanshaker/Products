"use client"

import { Toast } from "@base-ui/react/toast"
import { HugeiconsIcon } from "@hugeicons/react"
import { Cancel01Icon } from "@hugeicons/core-free-icons"

import { cn } from "@nextbot/ui/lib/utils"
import { toastManager } from "@nextbot/ui/lib/toast"

/** Per-`type` accent classes — mirrors `alert.tsx`'s default/destructive/warning
 * palette so a toast and an inline `Alert` read as the same severity language. */
const TOAST_TYPE_CLASSES: Record<string, string> = {
  success: "border-emerald-300 bg-emerald-50 text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-100",
  error: "border-destructive/40 bg-card text-destructive",
  warning: "border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100",
  info: "border-border bg-card text-card-foreground",
  default: "border-border bg-card text-card-foreground",
}

/** Renders the current stack of toasts from the shared `toastManager` (see
 * `../../lib/toast.ts`). Must run inside a `Toast.Provider` — split out from
 * `Toaster` only because `useToastManager()` needs that provider context. */
function ToastList() {
  const { toasts } = Toast.useToastManager()
  return (
    <>
      {toasts.map((t) => (
        <Toast.Root
          key={t.id}
          toast={t}
          className={cn(
            "pointer-events-auto w-full max-w-sm rounded-none border p-3 text-xs shadow-md transition-all data-[ending-style]:opacity-0 data-[starting-style]:opacity-0",
            TOAST_TYPE_CLASSES[t.type ?? "default"] ?? TOAST_TYPE_CLASSES.default,
          )}
        >
          <Toast.Content className="flex items-start gap-2">
            <div className="flex-1">
              {t.title && <Toast.Title className="font-medium" />}
              {t.description && <Toast.Description className="mt-0.5 text-muted-foreground" />}
            </div>
            <Toast.Close
              aria-label="Dismiss notification"
              className="shrink-0 rounded-none text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
            >
              <HugeiconsIcon icon={Cancel01Icon} size={14} strokeWidth={2} />
            </Toast.Close>
          </Toast.Content>
        </Toast.Root>
      ))}
    </>
  )
}

/**
 * Mount once near the app root (alongside `TooltipProvider`) — every screen's
 * `toast.success(...)`/`toast.error(...)` call (from `../../lib/toast.ts`)
 * renders here via the shared `toastManager` singleton.
 */
function Toaster() {
  return (
    <Toast.Provider toastManager={toastManager}>
      <Toast.Portal>
        <Toast.Viewport className="fixed bottom-4 end-4 z-50 flex w-full max-w-sm flex-col gap-2 outline-none">
          <ToastList />
        </Toast.Viewport>
      </Toast.Portal>
    </Toast.Provider>
  )
}

export { Toaster }
