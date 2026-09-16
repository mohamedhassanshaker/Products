import type { GuidePageContent } from "../../../modules/userguide/domain/guide-content.js";

interface HelpEntryViewLabels {
  readonly featureWalkthroughHeading: string;
  readonly howToHeading: string;
  readonly permissionsHeading: string;
  readonly lastVerifiedLabel: string;
}

/**
 * Renders one resolved guide entry's content — purpose, feature walkthrough, how-to
 * steps, and the permissions note (design-system.md §5.5 #56's own mandated shape,
 * mirrored from CLAUDE.md's Phase F spec: "purpose, feature walkthrough, step-by-step
 * how-to, permission notes"). A plain server-renderable function component, not a
 * "use client" one — nothing here is interactive, so it stays as cheap as the content
 * it renders.
 *
 * All prose is data (`content.*`), never a literal JSX text node — the h1/h2/h3/p/li
 * structure and the section labels are the only English/Arabic strings this file
 * itself owns, and those come through `labels` (already resolved via `getTranslations`
 * by the caller), keeping this file itself clean against `no-hardcoded-user-string.mjs`.
 */
export function HelpEntryView({
  content,
  labels,
}: {
  content: GuidePageContent;
  labels: HelpEntryViewLabels;
}) {
  return (
    <article className="flex flex-col" style={{ gap: "var(--space-6)" }}>
      <header className="flex flex-col" style={{ gap: "var(--space-2)" }}>
        <h1 className="text-xl font-semibold text-foreground">{content.title}</h1>
        <p className="text-sm text-muted-foreground">{content.purpose}</p>
      </header>

      <section className="flex flex-col" style={{ gap: "var(--space-3)" }}>
        <h2 className="text-base font-semibold text-foreground">
          {labels.featureWalkthroughHeading}
        </h2>
        <dl className="flex flex-col" style={{ gap: "var(--space-3)" }}>
          {content.featureWalkthrough.map((section, index) => (
            <div key={index}>
              <dt className="text-sm font-medium text-foreground">{section.heading}</dt>
              <dd className="text-sm text-muted-foreground">{section.body}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="flex flex-col" style={{ gap: "var(--space-3)" }}>
        <h2 className="text-base font-semibold text-foreground">{labels.howToHeading}</h2>
        <div className="flex flex-col" style={{ gap: "var(--space-3)" }}>
          {content.howTo.map((howTo, index) => (
            <div key={index}>
              <h3 className="text-sm font-medium text-foreground">{howTo.title}</h3>
              <ol
                className="list-decimal text-sm text-muted-foreground"
                style={{ paddingInlineStart: "var(--space-5)" }}
              >
                {howTo.steps.map((step, stepIndex) => (
                  <li key={stepIndex}>{step}</li>
                ))}
              </ol>
            </div>
          ))}
        </div>
      </section>

      <section
        className="rounded-md border border-border bg-card"
        style={{ padding: "var(--space-4)" }}
      >
        <h2 className="text-sm font-semibold text-foreground">{labels.permissionsHeading}</h2>
        <p className="text-sm text-muted-foreground">{content.permissionsNote}</p>
      </section>

      <p className="text-xs text-muted-foreground">
        {labels.lastVerifiedLabel} {content.lastVerifiedAgainst}
      </p>
    </article>
  );
}
