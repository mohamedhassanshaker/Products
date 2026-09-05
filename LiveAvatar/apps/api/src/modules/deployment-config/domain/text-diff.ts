import type { ConfigVersionDiffResponseDto } from '@liveavatar/contracts';

type DiffLine = ConfigVersionDiffResponseDto['lines'][number];

/**
 * Small hand-rolled line-level LCS diff (Phase 9, BL-035) — no diff-library
 * dependency, since nothing consumes this but a backend-capability test
 * this phase (the diff **UI** is deferred, BL-078). Config YAML documents
 * are small (≤200KB, `SaveConfigRequestSchema`'s own cap), so an O(n·m)
 * dynamic-programming LCS is more than fast enough; revisit with a real
 * unified-diff library only if/when BL-078's UI ships and needs one.
 * @param before - Older version's `yamlText`
 * @param after - Newer version's `yamlText`
 */
export function diffLines(before: string, after: string): DiffLine[] {
  const a = before.split('\n');
  const b = after.split('\n');
  const n = a.length;
  const m = b.length;
  // dp[i][j] = LCS length of a[i:] and b[j:]
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const lines: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      lines.push({ op: 'equal', text: a[i] });
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      lines.push({ op: 'remove', text: a[i] });
      i++;
    } else {
      lines.push({ op: 'add', text: b[j] });
      j++;
    }
  }
  while (i < n) {
    lines.push({ op: 'remove', text: a[i] });
    i++;
  }
  while (j < m) {
    lines.push({ op: 'add', text: b[j] });
    j++;
  }
  return lines;
}
