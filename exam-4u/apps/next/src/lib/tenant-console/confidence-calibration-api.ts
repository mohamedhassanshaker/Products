import { tenantFetch } from './http-client';

/**
 * Confidence-threshold recalibration analytics client (migration plan Phase 6, sub-slice "6d"). Local
 * mirrors of `server/pdf-processing`'s `domain/confidence-calibration.ts`/
 * `application/confidence-calibration.service.ts` wire types.
 */

export interface CalibrationBandStats {
  bandLabel: string;
  bandMin: number;
  bandMax: number;
  count: number;
  humanEditedRate: number;
  finalizedRate: number;
  belowThreshold: boolean;
  advisory: string;
}

export interface CalibrationMethodReport {
  generationMethod: string;
  bands: CalibrationBandStats[];
}

export interface CalibrationReport {
  currentThreshold: number;
  generationMethods: CalibrationMethodReport[];
}

/** `GET /api/pdf-processing/analytics/confidence-calibration`. */
export function getConfidenceCalibrationReport(): Promise<CalibrationReport> {
  return tenantFetch<CalibrationReport>('/api/pdf-processing/analytics/confidence-calibration', { method: 'GET' });
}
