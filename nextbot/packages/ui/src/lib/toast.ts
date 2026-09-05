import { Toast } from "@base-ui/react/toast";

/**
 * Module-level toast manager (Batch A deviation, noted per this project's
 * "local/reversible, note it" convention): the dispatch prompt's mapping table
 * calls for a "Sonner-based" toast, but the `sonner` package cannot be added in
 * this environment (no network access to the npm registry during this dispatch)
 * — and Base UI (`@base-ui/react`), already this project's established primitive
 * library since Phase 0's preset resolution, ships its own `Toast` primitive
 * that covers the same need (imperative `toast.success(...)`/`toast.error(...)`
 * call sites, auto-dismiss, stacked viewport). Using it keeps the same call-site
 * ergonomics the plan asks for without a new dependency outside the already-
 * adopted primitive set.
 *
 * `toastManager` is a singleton so any client component can call `toast(...)`
 * without needing a `useToastManager()` hook of its own — `<Toaster />`
 * (mounted once near the root, see `./ui/toast.tsx`) is wired to this same
 * instance via `Toast.Provider`'s `toastManager` prop.
 */
export const toastManager = Toast.createToastManager();

/** Shape accepted by every `toast.*` call — a bare string sets only the title. */
export interface ToastInput {
  title?: string;
  description?: string;
  /** Milliseconds before auto-dismiss; `0` disables auto-dismiss. Defaults to the
   * provider's own default (5000ms) when omitted. */
  timeout?: number;
}

function normalize(input: string | ToastInput): ToastInput {
  return typeof input === "string" ? { title: input } : input;
}

function addToast(type: "success" | "error" | "info" | "warning" | "default", input: string | ToastInput): string {
  const { title, description, timeout } = normalize(input);
  return toastManager.add({ type, title, description, timeout });
}

/**
 * Sonner-shaped imperative toast API backed by Base UI's `Toast` primitive —
 * `toast(...)` for a neutral/default toast, `toast.success`/`toast.error`/
 * `toast.info`/`toast.warning` for the semantic variants `<Toaster />` styles
 * distinctly (see `./ui/toast.tsx`).
 */
export const toast = Object.assign((input: string | ToastInput) => addToast("default", input), {
  success: (input: string | ToastInput) => addToast("success", input),
  error: (input: string | ToastInput) => addToast("error", input),
  info: (input: string | ToastInput) => addToast("info", input),
  warning: (input: string | ToastInput) => addToast("warning", input),
});
