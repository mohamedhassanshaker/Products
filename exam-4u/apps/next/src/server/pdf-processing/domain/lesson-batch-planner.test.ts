import { describe, expect, it } from 'vitest';
import type { PageText } from '@/server/common/util/chunking.util';
import { MAX_QUESTIONS_PER_BATCH, planLessonBatches } from './lesson-batch-planner';

/** A page of `chars` real characters (no paragraph/sentence breaks so chunking is purely size-driven). */
function page(pageNumber: number, chars: number): PageText {
  return { pageNumber, text: 'x'.repeat(chars) };
}

const BASE = { questionsMin: 10, questionsMax: 200, batchSize: 10, resumeFromPage: 0 };

describe('planLessonBatches (FR-PDF-4)', () => {
  it('returns an empty plan when every page is at or before the resume watermark (FR-REL-2)', () => {
    const plans = planLessonBatches({ ...BASE, pages: [page(1, 5000), page(2, 5000)], estimatedQuestionsPerPage: 3, resumeFromPage: 2 });
    expect(plans).toEqual([]);
  });

  it('returns an empty plan when every remaining page is blank', () => {
    const plans = planLessonBatches({ ...BASE, pages: [{ pageNumber: 1, text: '   ' }], estimatedQuestionsPerPage: 3 });
    expect(plans).toEqual([]);
  });

  it('clamps the total planned question count UP to questionsMin for a short document', () => {
    // 1 page * density 1 = 1, clamped up to questionsMin 10 -> one batch of 10.
    const plans = planLessonBatches({ ...BASE, pages: [page(1, 2000)], estimatedQuestionsPerPage: 1 });
    expect(plans.reduce((sum, p) => sum + p.targetQuestionCount, 0)).toBe(10);
  });

  it('clamps the total planned question count DOWN to questionsMax for a huge document', () => {
    const pages = Array.from({ length: 40 }, (_, i) => page(i + 1, 3000));
    const plans = planLessonBatches({ ...BASE, pages, estimatedQuestionsPerPage: 10, questionsMax: 25 });
    expect(plans.reduce((sum, p) => sum + p.targetQuestionCount, 0)).toBeLessThanOrEqual(25);
  });

  it('never exceeds MAX_QUESTIONS_PER_BATCH per batch even when configured batchSize is larger (LLD §7.11)', () => {
    const pages = Array.from({ length: 10 }, (_, i) => page(i + 1, 3000));
    const plans = planLessonBatches({ ...BASE, pages, estimatedQuestionsPerPage: 5, batchSize: 50 });
    expect(plans.length).toBeGreaterThan(0);
    for (const plan of plans) {
      expect(plan.targetQuestionCount).toBeLessThanOrEqual(MAX_QUESTIONS_PER_BATCH);
    }
  });

  it('falls back to a density of 1/page when classification produced no estimate', () => {
    const pages = Array.from({ length: 30 }, (_, i) => page(i + 1, 3000));
    const withNull = planLessonBatches({ ...BASE, pages, estimatedQuestionsPerPage: null });
    const withOne = planLessonBatches({ ...BASE, pages, estimatedQuestionsPerPage: 1 });
    expect(withNull.reduce((s, p) => s + p.targetQuestionCount, 0)).toBe(withOne.reduce((s, p) => s + p.targetQuestionCount, 0));
  });

  it('excludes already-covered pages and tags each plan with its own source page (endPage/pageRange agree)', () => {
    const pages = [page(1, 3000), page(2, 3000), page(3, 3000)];
    const plans = planLessonBatches({ ...BASE, pages, estimatedQuestionsPerPage: 5, resumeFromPage: 1 });
    expect(plans.length).toBeGreaterThan(0);
    for (const plan of plans) {
      expect(plan.endPage).toBeGreaterThan(1);
      expect(plan.pageRange).toBe(String(plan.endPage));
      expect(plan.excerpt.length).toBeGreaterThan(0);
    }
  });

  it('produces a monotonically non-decreasing endPage sequence (the watermark only ever advances)', () => {
    const pages = Array.from({ length: 8 }, (_, i) => page(i + 1, 3000));
    const plans = planLessonBatches({ ...BASE, pages, estimatedQuestionsPerPage: 4 });
    const endPages = plans.map((p) => p.endPage);
    expect([...endPages].sort((a, b) => a - b)).toEqual(endPages);
  });

  it('returns an empty plan when the clamped total is zero (degenerate questionsMax=0 config)', () => {
    const plans = planLessonBatches({ ...BASE, pages: [page(1, 3000)], estimatedQuestionsPerPage: 1, questionsMin: 0, questionsMax: 0 });
    expect(plans).toEqual([]);
  });
});
