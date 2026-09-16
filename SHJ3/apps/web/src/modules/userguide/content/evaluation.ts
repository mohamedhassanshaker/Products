import type { LocalizedGuideContent } from "./index.js";

/**
 * `/evaluation` — B13/B-9. Written directly against `messages/en.json`'s real `evaluation`
 * namespace (three real tabs).
 */
export const evaluation: LocalizedGuideContent = {
  en: {
    title: "Evaluation & testing",
    purpose:
      "Where an agent's quality is actually measured before it ships: golden sets of test " +
      "cases, regression runs scoring an agent version against them, and the publish gate " +
      "that decides whether a low score is allowed to block a real publish.",
    featureWalkthrough: [
      {
        heading: "Golden sets tab",
        body:
          "Named sets of test cases (each a prompt, an expected behaviour, and whether it " +
          "must be refused), owned by a tenant, with a kind and locale. A set can be created " +
          "here directly, or grown by adding a real transcript from the Command centre's " +
          'conversation explorer. "Run now" scores the set immediately against a chosen ' +
          "agent version.",
      },
      {
        heading: "Regression runs tab",
        body:
          "Every scoring run ever performed — agent, version, set, and its accuracy / " +
          "groundedness / tool-accuracy scores. Running never overwrites history: each run is " +
          'its own new row, so a score trend over time is always reconstructable. "Run all ' +
          'suites" scores every golden set against its agent version in one action.',
      },
      {
        heading: "Publish gate tab",
        body:
          "The rules that can block a real Publish elsewhere in the app: minimum accuracy, " +
          "minimum groundedness, whether the red-team set must score exactly 100%, whether " +
          "publish is blocked when a suite hasn't been run at all, and whether a bound locale " +
          "below 100% translated blocks publish. When any of these fires, the Agents " +
          "registry's Publish dialog names the exact blocking set, its observed score and the " +
          'threshold it missed — never a generic "publish failed."',
      },
    ],
    howTo: [
      {
        title: "Turn a real bad conversation into a regression test",
        steps: [
          "Find it in the Command centre's conversation explorer and select \"Add to golden " +
            'set".',
          "Choose the golden set (or note the correct expected behaviour if it should be " +
            "different from what actually happened).",
          'Open the Golden sets tab here and select "Run now" to score it immediately.',
        ],
      },
      {
        title: "Tighten the publish gate",
        steps: [
          "Open the Publish gate tab.",
          'Raise the minimum accuracy/groundedness threshold, or turn on "Red-team set must ' +
            'score 100%".',
          "Save — the next Publish attempt anywhere in the app is checked against the new " +
            "rule immediately.",
        ],
      },
      {
        title: "Understand a blocked publish",
        steps: [
          "From the blocked Publish dialog, note the named golden set and score.",
          "Open the Regression runs tab and find that run for the agent version in question.",
          "Fix the underlying issue (a prompt, a knowledge gap, a tool binding) and run the " +
            "suite again before retrying Publish.",
        ],
      },
    ],
    permissionsNote:
      "The whole screen requires a role permission distinct from agent authoring itself — a " +
      "role without it sees a plain permission-denied message for every tab.",
    lastVerifiedAgainst: "messages/en.json's evaluation namespace — 2026-09-10",
  },
  ar: {
    title: "التقييم والاختبار",
    purpose:
      "حيث تُقاس جودة الوكيل فعليًا قبل إصداره: مجموعات معيارية من حالات الاختبار، وعمليات " +
      "تقييم تُقيّم إصدار وكيل مقابلها، وبوابة النشر التي تقرر ما إذا كانت درجة منخفضة مسموح " +
      "لها بحجب نشر حقيقي.",
    featureWalkthrough: [
      {
        heading: "تبويب المجموعات المعيارية",
        body:
          "مجموعات مسماة من حالات اختبار (كل حالة موجّه، وسلوك متوقع، وهل يجب رفضه)، مملوكة " +
          "لجهة، بنوع ولغة. يمكن إنشاء مجموعة هنا مباشرة، أو تنميتها بإضافة نص محادثة حقيقي " +
          'من مستكشف المحادثات في مركز التحكم. "تشغيل الآن" يقيّم المجموعة فورًا مقابل ' +
          "إصدار وكيل مختار.",
      },
      {
        heading: "تبويب عمليات التقييم",
        body:
          "كل عملية تقييم أُجريت يومًا — الوكيل، الإصدار، المجموعة، ودرجات الدقة والتأصيل " +
          "ودقة الأدوات. لا يستبدل التشغيل السجل أبدًا: كل تشغيل صف جديد خاص به، فيمكن دائمًا " +
          'إعادة بناء اتجاه الدرجات عبر الزمن. "تشغيل كل الحزم" يقيّم كل مجموعة معيارية ' +
          "مقابل إصدار وكيلها في إجراء واحد.",
      },
      {
        heading: "تبويب بوابة النشر",
        body:
          "القواعد التي يمكن أن تحجب نشرًا حقيقيًا في أي مكان آخر من التطبيق: الحد الأدنى " +
          "للدقة، الحد الأدنى للتأصيل، هل يجب أن تسجل مجموعة الفريق الأحمر 100% بالضبط، هل " +
          "يُحجب النشر عند عدم تشغيل حزمة إطلاقًا، وهل تحجب لغة مرتبطة أقل من 100% ترجمة " +
          "النشر. عند إطلاق أي من هذه، تسمي نافذة النشر في سجل الوكلاء بالتحديد المجموعة " +
          'المانعة ودرجتها المرصودة والحد الذي فاتته — لا "فشل النشر" عامًا أبدًا.',
      },
    ],
    howTo: [
      {
        title: "تحويل محادثة سيئة حقيقية إلى اختبار تقييمي",
        steps: [
          'ابحث عنها في مستكشف المحادثات بمركز التحكم واختر "إضافة إلى مجموعة معيارية".',
          "اختر المجموعة المعيارية (أو دوّن السلوك المتوقع الصحيح إن كان يجب أن يختلف عما " +
            "حدث فعلًا).",
          'افتح تبويب المجموعات المعيارية هنا واختر "تشغيل الآن" لتقييمها فورًا.',
        ],
      },
      {
        title: "تشديد بوابة النشر",
        steps: [
          "افتح تبويب بوابة النشر.",
          'ارفع حد الدقة/التأصيل الأدنى، أو فعّل "يجب أن تسجل مجموعة الفريق الأحمر 100%".',
          "احفظ — تُفحص أي محاولة نشر تالية في أي مكان من التطبيق مقابل القاعدة الجديدة " +
            "فورًا.",
        ],
      },
      {
        title: "فهم سبب حجب نشر",
        steps: [
          "من نافذة النشر المحجوب، دوّن المجموعة المعيارية المسمّاة ودرجتها.",
          "افتح تبويب عمليات التقييم وابحث عن ذلك التشغيل لإصدار الوكيل المعني.",
          "عالج المشكلة الأساسية (موجّه، فجوة معرفة، ربط أداة) وشغّل الحزمة مجددًا قبل إعادة " +
            "محاولة النشر.",
        ],
      },
    ],
    permissionsNote:
      "تتطلب الشاشة بأكملها صلاحية دور منفصلة عن تأليف الوكلاء نفسه — فالدور الذي يفتقدها " +
      "يرى رسالة رفض صلاحية واضحة لكل تبويب.",
    lastVerifiedAgainst: "مساحة الاسم evaluation في messages/en.json — 2026-09-10",
  },
};
