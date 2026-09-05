import { tenantFetch } from './http-client';

/** Local mirror of `server/practice`'s `PromptPracticeQuestion` (FR-CUR-5) — deliberately no
 * confidence field, matching the server's own "never surfaced to the Member" wire shape. */
export interface PromptPracticeQuestion {
  questionText: string;
  options: { key: string; text: string }[];
  correctAnswer: string;
  explanation: string;
  bloomsLevel: number;
}

/** Local mirror of `PromptPracticeResult` — a discriminated union so the client can never confuse a
 * "zero questions, no comment" bug with the genuine, actionable failed-session outcome FR-CUR-5
 * calls for. */
export type PromptPracticeResult = { status: 'completed'; questions: PromptPracticeQuestion[] } | { status: 'failed'; message: string };

export function generatePromptPractice(input: { curriculumId: string; prompt: string; count: number }): Promise<PromptPracticeResult> {
  return tenantFetch<PromptPracticeResult>('/api/practice/prompt', { method: 'POST', body: JSON.stringify(input) });
}
