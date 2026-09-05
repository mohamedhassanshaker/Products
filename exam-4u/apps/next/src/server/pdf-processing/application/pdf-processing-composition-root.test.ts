import { describe, expect, it, vi } from 'vitest';
import type { DataSource } from 'typeorm';
import { PdfProcessingService, buildPdfProcessingService } from './pdf-processing.service';
import type { PdfContentStrategy } from '../domain/content-type-strategy';

/**
 * Composition-root coverage for `buildPdfProcessingService` (migration plan Phase 6, sub-slice "6b").
 *
 * Its most load-bearing property is not any single wire-up but the CONTENT of the
 * `PdfContentStrategy[]` literal: sub-slice "6a" shipped one strategy (`Exam`) and designed the
 * orchestrator so 6b could append `Lesson`/`Reference` without touching that class. This test asserts
 * all three are registered, exactly once each, so a future refactor cannot silently drop a content
 * type's generation branch and leave those sessions completing with zero output (the orchestrator's
 * documented no-strategy fallback would make that failure completely silent).
 *
 * A stub `DataSource` is sufficient: every collaborator this function constructs takes its repositories
 * lazily and performs no I/O at construction time (see `buildPdfProcessingService`'s own doc comment).
 * `AI_ENABLED` is `false` under the unit-test env, so `getAiService()` returns the disabled adapter and
 * never touches the ambient tenant context. The genuinely-wired-up-against-real-infrastructure proof for
 * this same function is the real-MySQL integration test, which drives it through an actual HTTP upload.
 */
function stubDataSource(): DataSource {
  const repo = {
    find: vi.fn(),
    findOne: vi.fn(),
    insert: vi.fn(),
    save: vi.fn(),
    update: vi.fn(),
    count: vi.fn(),
    createQueryBuilder: vi.fn(),
  };
  return { getRepository: vi.fn().mockReturnValue(repo), transaction: vi.fn(), query: vi.fn() } as unknown as DataSource;
}

/** Reads the private `strategies` array off the orchestrator the service was built with — deliberately
 * a reflective read rather than a new public getter: the array is an internal composition detail, and
 * adding production API purely to make a test possible would be the wrong trade. */
function registeredStrategies(service: PdfProcessingService): PdfContentStrategy[] {
  const orchestrator = (service as unknown as { orchestrator: { strategies: PdfContentStrategy[] } }).orchestrator;
  return orchestrator.strategies;
}

describe('buildPdfProcessingService (composition root)', () => {
  it('builds a fully-wired PdfProcessingService from nothing but a tenant DataSource', () => {
    expect(buildPdfProcessingService(stubDataSource())).toBeInstanceOf(PdfProcessingService);
  });

  it('registers a generation branch for ALL THREE recognized content types (6a shipped one; 6b appended two)', () => {
    const strategies = registeredStrategies(buildPdfProcessingService(stubDataSource()));
    expect(strategies.map((s) => s.contentType).sort()).toEqual(['Exam', 'Lesson', 'Reference']);
  });

  it('registers exactly one strategy per content type — a duplicate would make dispatch order-dependent', () => {
    const contentTypes = registeredStrategies(buildPdfProcessingService(stubDataSource())).map((s) => s.contentType);
    expect(new Set(contentTypes).size).toBe(contentTypes.length);
  });

  it('wires every strategy to a real, callable runner', () => {
    for (const strategy of registeredStrategies(buildPdfProcessingService(stubDataSource()))) {
      expect(typeof strategy.run).toBe('function');
    }
  });

  it('builds an independent instance per call (never a shared singleton bound to one tenant’s DataSource)', () => {
    const first = buildPdfProcessingService(stubDataSource());
    const second = buildPdfProcessingService(stubDataSource());
    expect(first).not.toBe(second);
  });
});
