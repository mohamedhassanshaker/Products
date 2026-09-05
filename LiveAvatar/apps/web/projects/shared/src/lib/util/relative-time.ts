const DIVISIONS: { amount: number; unit: Intl.RelativeTimeFormatUnit }[] = [
  { amount: 60, unit: 'seconds' },
  { amount: 60, unit: 'minutes' },
  { amount: 24, unit: 'hours' },
  { amount: 7, unit: 'days' },
  { amount: 4.34524, unit: 'weeks' },
  { amount: 12, unit: 'months' },
  { amount: Number.POSITIVE_INFINITY, unit: 'years' },
];

const formatter = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });

/**
 * "2 hours ago" style text for the Deployments "Last modified" column
 * (UX_GUIDELINES §5.2). Callers pair this with the absolute ISO timestamp
 * in a `title`/tooltip.
 */
export function formatRelativeTime(iso: string, now: Date = new Date()): string {
  let durationSeconds = (new Date(iso).getTime() - now.getTime()) / 1000;

  if (Number.isNaN(durationSeconds)) {
    return '';
  }

  if (Math.abs(durationSeconds) < 5) {
    return 'just now';
  }

  // The last division's amount is Infinity, so this loop always returns
  // from inside — there is no case that falls through.
  for (const division of DIVISIONS) {
    if (Math.abs(durationSeconds) < division.amount) {
      return formatter.format(Math.round(durationSeconds), division.unit);
    }
    durationSeconds /= division.amount;
  }

  /* istanbul ignore next -- unreachable: DIVISIONS always terminates the loop above */
  throw new Error('unreachable');
}
