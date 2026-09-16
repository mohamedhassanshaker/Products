import { buildWidgetEmbedSnippet } from "../domain/embed-snippet.js";
import type {
  WidgetAllowedDomainRow,
  WidgetConfigRepository,
  WidgetConfigRow,
} from "../ports/widget-config-repository.js";

export interface WidgetStudioSnapshot {
  readonly config: WidgetConfigRow;
  readonly allowedDomains: readonly WidgetAllowedDomainRow[];
  readonly embedSnippet: string;
}

/** `GET /channels/web-widget` + `.../allowed-domains` + `.../embed-snippet` (B10 tab 2), read
 *  together since the studio screen renders all three at once. */
export class GetWidgetStudio {
  constructor(private readonly deps: { readonly widgetConfig: WidgetConfigRepository }) {}

  async execute(input: {
    readonly channelId: string;
    readonly tenantSlug: string;
    readonly scriptOrigin: string;
  }): Promise<WidgetStudioSnapshot | null> {
    const config = await this.deps.widgetConfig.findByChannelId(input.channelId);
    if (!config) return null;
    const allowedDomains = await this.deps.widgetConfig.listAllowedDomains(input.channelId);
    return {
      config,
      allowedDomains,
      embedSnippet: buildWidgetEmbedSnippet({
        tenantSlug: input.tenantSlug,
        scriptOrigin: input.scriptOrigin,
      }),
    };
  }
}
