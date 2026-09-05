import { randomUUID } from 'node:crypto';
import { ExamModuleEntity, ExamTypeQuestionEntity, GeneratedQuestionEntity } from '@/server/infrastructure/database';
import type { FinalizeExamModuleInput } from './pdf-processing.types';

/** LLD §4 DDL: `generated_question.source_section VARCHAR(200) NULL` — the module name a question
 * with no detected source section falls back into (both finalize and append cannot literally group a
 * `null` into a real module name). Shared between finalize and append so the two call sites never
 * drift on this fallback value. */
export const UNCATEGORIZED_MODULE_NAME = 'General';

/**
 * Shared "group eligible questions into named modules" algorithm (FR-PDF-9's finalize, FR-PDF-10's
 * append). Ported from `legacy/api/src/modules/pdf-processing/domain/group-into-modules.ts` — extracted
 * there (Dev-24/BL-23) so `AppendExamService` reuses the exact same grouping rules `FinalizeExamService`
 * uses, rather than re-implementing an equivalent pass.
 *
 * **Declared `modules[]` vs raw `source_section` (documented judgment call, carried forward from
 * legacy)**: when the caller supplies `declaredModules`, each declared module's `sourceSections[]`
 * names which raw `generated_question.source_section` values roll up into that one named module; any
 * eligible question whose own `sourceSection` is not covered by any declared module (or when
 * `declaredModules` is omitted entirely) is grouped directly by its own raw `sourceSection` (or
 * {@link UNCATEGORIZED_MODULE_NAME} if that is `null`).
 *
 * Builds brand-new {@link ExamModuleEntity}/{@link ExamTypeQuestionEntity} rows scoped to `examTypeId`
 * — callers decide for themselves whether each resulting module name is genuinely new (insert) or
 * already exists on the target Exam Type (increment its `question_count` instead), since that decision
 * differs between finalize (always brand-new) and append (may collide with an existing module name).
 */
export function groupIntoModules(
  examTypeId: string,
  eligible: GeneratedQuestionEntity[],
  declaredModules: FinalizeExamModuleInput[] | undefined,
): { modules: ExamModuleEntity[]; questions: ExamTypeQuestionEntity[] } {
  const sectionToModuleName = new Map<string, string>();
  if (declaredModules) {
    for (const declared of declaredModules) {
      for (const section of declared.sourceSections) {
        sectionToModuleName.set(section, declared.name);
      }
    }
  }

  const moduleNameFor = (question: GeneratedQuestionEntity): string => {
    const rawSection = question.sourceSection ?? UNCATEGORIZED_MODULE_NAME;
    return sectionToModuleName.get(rawSection) ?? rawSection;
  };

  const questionsByModule = new Map<string, GeneratedQuestionEntity[]>();
  for (const question of eligible) {
    const moduleName = moduleNameFor(question);
    const group = questionsByModule.get(moduleName) ?? [];
    group.push(question);
    questionsByModule.set(moduleName, group);
  }

  const modules: ExamModuleEntity[] = [];
  const questions: ExamTypeQuestionEntity[] = [];
  for (const [moduleName, group] of questionsByModule) {
    const examModule = new ExamModuleEntity();
    examModule.id = randomUUID();
    examModule.examTypeId = examTypeId;
    examModule.moduleName = moduleName;
    examModule.questionCount = group.length;
    modules.push(examModule);

    for (const generated of group) {
      const row = new ExamTypeQuestionEntity();
      row.id = randomUUID();
      row.examTypeId = examTypeId;
      row.moduleName = moduleName;
      // LLD §8.5/§8.9: "question_key = 'gq_'||generated_question_id" for the AI path — shared by
      // finalize and append so `uq_etq_key (exam_type_id, question_key)` is what makes a retried
      // append idempotent (see `AppendExamRepository`'s own doc comment).
      row.questionKey = `gq_${generated.id}`;
      row.questionText = generated.questionText;
      row.optionsJson = generated.optionsJson;
      row.correctAnswer = generated.correctAnswer;
      row.explanation = generated.explanation;
      row.sourceGeneratedQuestionId = generated.id;
      questions.push(row);
    }
  }

  return { modules, questions };
}
