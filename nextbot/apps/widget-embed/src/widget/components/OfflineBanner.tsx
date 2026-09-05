/** FR-OC-01 boundary case / `docs/design/UX_GUIDELINES.md` §5.2.5 — verbatim copy,
 * informational (not error) tone since this is an expected, recoverable state. */
export function OfflineBanner() {
  return (
    <div className="bg-blue-50 px-3 py-2 text-xs text-blue-800" role="status">
      <p>You&apos;re offline — messages will send once you&apos;re back online.</p>
    </div>
  );
}
