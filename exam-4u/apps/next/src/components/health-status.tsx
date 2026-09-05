'use client';

import { Badge, Spinner, Text } from '@chakra-ui/react';
import { useEffect, useState } from 'react';
import type { HealthLivenessResponse } from '@examland/contracts';

type FetchState =
  | { kind: 'loading' }
  | { kind: 'ok'; body: HealthLivenessResponse }
  | { kind: 'error'; message: string };

/**
 * Client-side proof that the placeholder page is wired to a real, working `GET /api/health` (not
 * just static markup) — fetches on mount and renders the result via Chakra's `Badge`/`Spinner`/
 * `Text`, giving Phase 0's manual/Playwright verification something concrete to assert against
 * beyond "the page returned HTTP 200".
 */
export function HealthStatus() {
  const [state, setState] = useState<FetchState>({ kind: 'loading' });

  useEffect(() => {
    let cancelled = false;
    fetch('/api/health')
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return (await res.json()) as HealthLivenessResponse;
      })
      .then((body) => {
        if (!cancelled) setState({ kind: 'ok', body });
      })
      .catch((err: unknown) => {
        if (!cancelled) setState({ kind: 'error', message: err instanceof Error ? err.message : String(err) });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (state.kind === 'loading') {
    return (
      <Text data-testid="health-status" display="flex" alignItems="center" gap="2">
        <Spinner size="sm" /> Checking API health…
      </Text>
    );
  }

  if (state.kind === 'error') {
    return (
      <Text data-testid="health-status">
        <Badge colorPalette="red">unreachable</Badge> {state.message}
      </Text>
    );
  }

  return (
    <Text data-testid="health-status">
      <Badge colorPalette="green">{state.body.status}</Badge> uptime {state.body.uptimeSeconds}s
    </Text>
  );
}
