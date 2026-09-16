import type { LocalizedGuideContent } from "./index.js";

/**
 * `/command-centre` (B1/B-9). Written directly against `messages/en.json`'s real
 * `commandCentre` namespace (three real tabs: overview, explorer, feedbackGaps).
 */
export const commandCentre: LocalizedGuideContent = {
  en: {
    title: "Command centre",
    purpose:
      "The single place to see how the assistant is actually performing: headline metrics, " +
      "every real conversation a citizen has had, and the two queues that turn citizen " +
      "feedback and unanswered questions into concrete fixes elsewhere in the backoffice.",
    featureWalkthrough: [
      {
        heading: "Overview tab",
        body:
          "Key metrics — conversations, containment rate, deflection rate, tool error rate — " +
          "for a chosen date range (Today / Last 7 days / Last 30 days), plus a channel-split " +
          "chart and a top-intents list. A role with view access but not the analytics " +
          "permission sees the page but a notice explaining metrics need an additional " +
          "permission.",
      },
      {
        heading: "Conversation explorer tab",
        body:
          "Every real conversation, filterable by outcome (All / Escalated / Resolved / " +
          "Abandoned), each row showing the citizen, channel, detected intent, outcome and " +
          "rating. Selecting a row loads its full transcript — with personally identifying " +
          "details masked — and lets you Export it, or Add it to a golden set (Evaluation) " +
          "directly from the transcript view, the same shared data path the Evaluation " +
          'screen\'s own "add-from-transcript" flow uses.',
      },
      {
        heading: "Feedback & knowledge gaps tab",
        body:
          "Two queues: a thumbs-down review queue (each item shows how many times it's been " +
          "reported, with Mark fixed / Reopen), and an unanswered-questions queue clustering " +
          "questions the assistant couldn't answer. An unanswered cluster can be resolved " +
          "directly into a real knowledge source or a real flow — or dismissed — closing the " +
          'loop from "a citizen asked and got nothing" to "the knowledge base now covers ' +
          'it" without leaving this screen.',
      },
    ],
    howTo: [
      {
        title: "Check how the assistant performed this week",
        steps: [
          "Open the Overview tab.",
          'Choose "Last 7 days" from the date range.',
          "Review the containment/deflection/tool-error metrics, channel split and top intents.",
        ],
      },
      {
        title: "Turn a bad answer into a test case",
        steps: [
          "Open the Conversation explorer tab and find the conversation.",
          "Select the row to load its transcript.",
          'Select "Add to golden set", choose the golden set, and optionally correct the ' +
            "expected behaviour before saving.",
        ],
      },
      {
        title: "Close a knowledge gap a citizen hit",
        steps: [
          "Open the Feedback & knowledge gaps tab.",
          "Find the unanswered-question cluster.",
          'Select "Resolve as knowledge" (and supply the knowledge source id) once the gap ' +
            'is filled, or "Resolve as flow", or Dismiss if it doesn\'t need one.',
        ],
      },
    ],
    permissionsNote:
      "Viewing this screen at all requires a role permission; a separate analytics permission " +
      "gates the Overview tab's actual metrics — a role with the first but not the second " +
      "still sees the page shell with an explanatory notice instead of numbers.",
    lastVerifiedAgainst: "messages/en.json's commandCentre namespace — 2026-09-10",
  },
  ar: {
    title: "مركز التحكم",
    purpose:
      "المكان الموحّد لرؤية أداء المساعد فعليًا: مؤشرات رئيسية، وكل محادثة حقيقية أجراها " +
      "مواطن، والقائمتان اللتان تحوّلان ملاحظات المواطنين والأسئلة غير المُجابة إلى إصلاحات " +
      "ملموسة في أماكن أخرى من النظام الخلفي.",
    featureWalkthrough: [
      {
        heading: "تبويب نظرة عامة",
        body:
          "مؤشرات رئيسية — المحادثات، معدل الاحتواء، معدل التحويل، معدل خطأ الأدوات — لفترة " +
          "زمنية مختارة (اليوم / آخر 7 أيام / آخر 30 يومًا)، إضافة إلى مخطط توزيع القنوات " +
          "وقائمة أهم النوايا. الدور الذي يملك صلاحية العرض دون صلاحية التحليلات يرى الصفحة " +
          "لكن مع إشعار يوضح أن الأرقام تتطلب صلاحية إضافية.",
      },
      {
        heading: "تبويب مستكشف المحادثات",
        body:
          "كل محادثة حقيقية، قابلة للتصفية حسب النتيجة (الكل / مُصعَّدة / محلولة / مهجورة)، " +
          "ويعرض كل صف المواطن والقناة والنية المكتشفة والنتيجة والتقييم. اختيار صف يحمّل " +
          "نصه الكامل — مع إخفاء التفاصيل المعرّفة شخصيًا — ويتيح تصديره أو إضافته إلى " +
          "مجموعة معيارية (التقييم) مباشرة من شاشة النص، عبر نفس مسار البيانات المشترك الذي " +
          "تستخدمه شاشة التقييم نفسها.",
      },
      {
        heading: "تبويب الملاحظات وفجوات المعرفة",
        body:
          "قائمتان: قائمة مراجعة التقييم السلبي (كل عنصر يعرض عدد مرات الإبلاغ عنه، مع خياري " +
          "تمييزه كمُصلَح أو إعادة فتحه)، وقائمة الأسئلة غير المُجابة التي تجمّع الأسئلة التي " +
          "لم يستطع المساعد الإجابة عليها. يمكن حل مجموعة أسئلة غير مُجابة مباشرة كمصدر معرفة " +
          'حقيقي أو تدفق حقيقي — أو تجاهلها — لإغلاق الحلقة من "سأل مواطن ولم يحصل على شيء" ' +
          'إلى "قاعدة المعرفة تغطيها الآن" دون مغادرة هذه الشاشة.',
      },
    ],
    howTo: [
      {
        title: "تفقّد أداء المساعد هذا الأسبوع",
        steps: [
          "افتح تبويب نظرة عامة.",
          'اختر "آخر 7 أيام" من الفترة الزمنية.',
          "راجع مؤشرات الاحتواء والتحويل وخطأ الأدوات، وتوزيع القنوات، وأهم النوايا.",
        ],
      },
      {
        title: "تحويل إجابة سيئة إلى حالة اختبار",
        steps: [
          "افتح تبويب مستكشف المحادثات وابحث عن المحادثة.",
          "اختر الصف لتحميل نصها.",
          'اختر "إضافة إلى مجموعة معيارية"، واختر المجموعة، ويمكنك تصحيح السلوك المتوقع قبل ' +
            "الحفظ.",
        ],
      },
      {
        title: "إغلاق فجوة معرفة واجهها مواطن",
        steps: [
          "افتح تبويب الملاحظات وفجوات المعرفة.",
          "ابحث عن مجموعة الأسئلة غير المُجابة.",
          'اختر "حل كمعرفة" (مع تزويد معرّف مصدر المعرفة) بعد سدّ الفجوة، أو "حل كتدفق"، أو ' +
            "تجاهل إذا لم تكن بحاجة إلى ذلك.",
        ],
      },
    ],
    permissionsNote:
      "عرض هذه الشاشة أصلًا يتطلب صلاحية دور؛ وتوجد صلاحية تحليلات منفصلة تتحكم بأرقام تبويب " +
      "نظرة عامة — فالدور الذي يملك الأولى دون الثانية يرى هيكل الصفحة مع إشعار توضيحي بدل " +
      "الأرقام.",
    lastVerifiedAgainst: "مساحة الاسم commandCentre في messages/en.json — 2026-09-10",
  },
};
