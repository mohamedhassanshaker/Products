'use client';

import { useEffect, useState } from 'react';
import { Badge, Box, Heading, Spinner, Table, Text } from '@chakra-ui/react';
import * as calibrationApi from '@/lib/tenant-console/confidence-calibration-api';
import { useTenantAuthContext } from '@/lib/tenant-console/auth-context';

type LoadState = 'loading' | 'loaded' | 'error';

/**
 * Confidence-threshold recalibration analytics dashboard (`docs/design/UX_GUIDELINES.md` §16,
 * migration plan Phase 6, sub-slice "6d") — `/settings/confidence-calibration`, gated by `pdf.review`
 * (route-level; same permission the review screen itself requires).
 *
 * **One table, not a chart** (§16's own layout decision): 5 generation methods as row-groups × 4
 * confidence bands as rows within each group, columns Band / Total questions / Human-edit rate % /
 * Finalize-acceptance rate % / Advisory. The currently-active threshold boundary is annotated visually
 * (a "flagged" badge on every band whose entire range sits below the live threshold).
 *
 * **Two distinct empty states**, per §16: (a) no `generated_question` rows exist at all — a plain
 * "nothing generated yet" message, no table skeleton; (b) rows exist but every method/band combination
 * has zero reviewer-feedback signal — the table itself renders (so the operator sees the real 5×4
 * shape and every band's "Insufficient data" advisory), but a banner above it explains why every rate
 * reads as 0%. These are visually distinct, not just differently worded: (a) is a single centered
 * message box with no table; (b) is a full table with a top banner.
 */
export default function ConfidenceCalibrationPage() {
  const { hasPermission } = useTenantAuthContext();
  const [state, setState] = useState<LoadState>('loading');
  const [report, setReport] = useState<calibrationApi.CalibrationReport | null>(null);

  useEffect(() => {
    if (!hasPermission('pdf.review')) return;
    let cancelled = false;
    calibrationApi
      .getConfidenceCalibrationReport()
      .then((result) => {
        if (cancelled) return;
        setReport(result);
        setState('loaded');
      })
      .catch(() => {
        if (cancelled) return;
        setState('error');
      });
    return () => {
      cancelled = true;
    };
  }, [hasPermission]);

  if (!hasPermission('pdf.review')) {
    return (
      <Box>
        <Heading size="md" mb="2">
          Confidence calibration
        </Heading>
        <Text color="gray.600">You do not have permission to view this page.</Text>
      </Box>
    );
  }

  return (
    <Box>
      <Heading size="md" mb="2">
        Confidence calibration
      </Heading>
      <Text color="gray.600" mb="4" fontSize="sm">
        Read-only advisory analytics — the review-flag threshold below is never adjusted automatically.
      </Text>

      {state === 'loading' && <Spinner size="sm" />}

      {state === 'error' && (
        <Box role="alert" bg="red.subtle" color="red.fg" borderRadius="md" px="4" py="3">
          <Text>We couldn&apos;t load the calibration report. Try again later.</Text>
        </Box>
      )}

      {state === 'loaded' && report && report.generationMethods.length === 0 && (
        // Empty state (a): no `generated_question` rows exist for any generation method at all.
        <Box
          textAlign="center"
          borderWidth="1px"
          borderStyle="dashed"
          borderRadius="md"
          py="12"
          data-testid="calibration-empty-no-questions"
        >
          <Text fontWeight="semibold" mb="1">
            No generated questions yet
          </Text>
          <Text color="gray.600" fontSize="sm">
            Once at least one PDF processing session has produced questions, this dashboard will show
            per-generation-method calibration data.
          </Text>
        </Box>
      )}

      {state === 'loaded' && report && report.generationMethods.length > 0 && (
        <Box data-testid="calibration-table-container">
          <Text mb="3" fontSize="sm">
            Live review-flag threshold: <Badge colorPalette="brand">{report.currentThreshold.toFixed(2)}</Badge>
          </Text>

          {report.generationMethods.every((method) => method.bands.every((band) => band.count === 0)) && (
            // Empty state (b): rows/methods exist in the report shape, but zero reviewer-feedback
            // signal has accumulated in any band yet — visually distinct from (a) via a banner ABOVE
            // the still-rendered, real 5×4 table shape (not a replacement for it).
            <Box bg="gray.subtle" color="gray.fg" borderRadius="md" px="4" py="3" mb="4" data-testid="calibration-empty-no-feedback">
              <Text fontSize="sm">
                No reviewer-feedback signal has accumulated yet for any generation method — every band below
                shows 0 questions until at least one session&apos;s output is reviewed/finalized.
              </Text>
            </Box>
          )}

          {report.generationMethods.map((method) => (
            <Box key={method.generationMethod} mb="6">
              <Heading size="sm" mb="2">
                {method.generationMethod}
              </Heading>
              <Table.Root variant="outline" size="sm" data-testid={`calibration-method-${method.generationMethod}`}>
                <Table.Header>
                  <Table.Row>
                    <Table.ColumnHeader>Band</Table.ColumnHeader>
                    <Table.ColumnHeader>Total questions</Table.ColumnHeader>
                    <Table.ColumnHeader>Human-edit rate</Table.ColumnHeader>
                    <Table.ColumnHeader>Finalize/acceptance rate</Table.ColumnHeader>
                    <Table.ColumnHeader>Advisory</Table.ColumnHeader>
                  </Table.Row>
                </Table.Header>
                <Table.Body>
                  {method.bands.map((band) => (
                    <Table.Row key={band.bandLabel}>
                      <Table.Cell>
                        {band.bandLabel}{' '}
                        {band.belowThreshold && (
                          <Badge colorPalette="orange" size="sm" ml="1">
                            flagged
                          </Badge>
                        )}
                      </Table.Cell>
                      <Table.Cell>{band.count}</Table.Cell>
                      <Table.Cell>{(band.humanEditedRate * 100).toFixed(0)}%</Table.Cell>
                      <Table.Cell>{(band.finalizedRate * 100).toFixed(0)}%</Table.Cell>
                      <Table.Cell fontSize="xs">{band.advisory}</Table.Cell>
                    </Table.Row>
                  ))}
                </Table.Body>
              </Table.Root>
            </Box>
          ))}
        </Box>
      )}
    </Box>
  );
}
