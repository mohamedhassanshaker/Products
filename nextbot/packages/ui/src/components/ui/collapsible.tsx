"use client"

import { Collapsible as CollapsiblePrimitive } from "@base-ui/react/collapsible"

/**
 * Batch C hand-authored primitive (same network-access constraint noted
 * throughout this package — see `select.tsx`'s doc comment). Built on Base
 * UI's `Collapsible` (already vendored via `@base-ui/react`), replacing
 * Chakra's `Collapse` + `useDisclosure()` pattern used by the Conversation
 * Trace Viewer's reasoning/tool-call expandable blocks and the Channels
 * screen's embed-snippet disclosure. No custom styling needed beyond what
 * each call site already applies to its trigger/content — this is a thin,
 * unstyled re-export so every call site controls its own layout.
 */
const Collapsible = CollapsiblePrimitive.Root
const CollapsibleTrigger = CollapsiblePrimitive.Trigger
const CollapsibleContent = CollapsiblePrimitive.Panel

export { Collapsible, CollapsibleTrigger, CollapsibleContent }
