/**
 * The web widget embed snippet (B10 tab 2). Locked shape, per this wave's own brief:
 * `<script src=".../embed/widget.js" data-channel-key="{tenant}.WebWidget" async defer>`
 * — matched to whatever the parallel widget-runtime wave's real script path/attribute
 * convention turns out to be if that lands with a different shape; this is the documented
 * placeholder until then. Contains no secret (FR-CHAN-08) — a channel key is not a credential,
 * it is a public routing hint the embed script itself resolves server-side.
 */
export function buildWidgetEmbedSnippet(input: {
  readonly tenantSlug: string;
  readonly scriptOrigin: string;
}): string {
  const channelKey = `${input.tenantSlug}.WebWidget`;
  return `<script src="${input.scriptOrigin}/embed/widget.js" data-channel-key="${channelKey}" async defer></script>`;
}
