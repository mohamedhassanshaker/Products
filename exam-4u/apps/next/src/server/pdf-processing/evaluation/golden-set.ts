/**
 * The fixed, version-controlled "golden set" the generation-evaluation harness runs on every
 * invocation (migration plan Phase 6, sub-slice "6d") — ported verbatim from
 * `legacy/api/src/modules/pdf-processing/evaluation/golden-set.ts`. Deliberately hand-authored,
 * in-repo, typed fixtures (not live tenant PDFs): golden-set regression testing requires the *same*
 * inputs across runs so a metric change can only be attributed to a prompt/model change, never to a
 * shifting corpus.
 *
 * Every item's `grounding` is always supplied as `[]` at the call site (see
 * `GenerationEvaluationService`) — this harness deliberately isolates *generation* quality from
 * *retrieval* quality (`RetrievalService`'s own, separately-tracked concern).
 */

/** One golden-set item — either a `LessonGenerationService`-shaped excerpt or an
 * `ExamExtractionService`-shaped single page, mirroring each service's own real input contract minus
 * the `grounding` field this harness always supplies as `[]`. */
export type GoldenSetItem =
  | {
      id: string;
      contentType: 'Lesson';
      excerpt: string;
      targetQuestionCount: number;
      pageRange?: string;
    }
  | {
      id: string;
      contentType: 'Exam';
      pageText: string;
      pageNumber: number;
      answerKeyHints?: string;
    };

/**
 * The fixed golden set. Kept intentionally small (a handful of items per branch) — this is a manually
 * invoked, real-model-calling tool (never run on a schedule or from application code), so every item
 * run costs real tokens; a larger corpus can be added later without changing this harness's own shape.
 */
export const GOLDEN_SET: GoldenSetItem[] = [
  {
    id: 'lesson-photosynthesis-basic',
    contentType: 'Lesson',
    excerpt:
      'Photosynthesis is the process by which green plants and some other organisms use sunlight to ' +
      'synthesize nutrients from carbon dioxide and water. Photosynthesis in plants generally involves ' +
      'the green pigment chlorophyll and generates oxygen as a byproduct. The overall reaction can be ' +
      'summarized as: carbon dioxide + water + light energy -> glucose + oxygen. This reaction takes ' +
      'place mainly in the chloroplasts of plant cells, specifically within structures called thylakoids.',
    targetQuestionCount: 3,
    pageRange: '1',
  },
  {
    id: 'lesson-french-revolution-causes',
    contentType: 'Lesson',
    excerpt:
      'The French Revolution began in 1789 and was driven by a combination of financial crisis, social ' +
      'inequality between the estates, widespread famine, and the spread of Enlightenment ideas about ' +
      'liberty and popular sovereignty. The storming of the Bastille on 14 July 1789 became a symbolic ' +
      'turning point, marking the collapse of royal authority in Paris.',
    targetQuestionCount: 3,
    pageRange: '4',
  },
  {
    id: 'exam-algebra-linear-equations-with-key',
    contentType: 'Exam',
    pageText:
      '1. Solve for x: 2x + 5 = 17.\nA) 5   B) 6   C) 7   D) 8\nAnswer Key: B\n' +
      '2. What is the slope of the line y = 3x - 4?\nA) -4   B) 3   C) 4   D) -3\nAnswer Key: B',
    pageNumber: 1,
  },
  {
    id: 'exam-world-geography-no-key',
    contentType: 'Exam',
    pageText:
      '1. Which of the following is the longest river in the world?\nA) Amazon   B) Nile   C) Yangtze   D) Mississippi\n' +
      '2. Mount Everest is located on the border of which two countries?\nA) India and China   B) Nepal and China   ' +
      'C) India and Nepal   D) Bhutan and China',
    pageNumber: 1,
  },
];
