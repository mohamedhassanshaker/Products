import type { LocalizedGuideContent } from "./index.js";

/**
 * `/governance` — B14/B-9. Written directly against `messages/en.json`'s real `governance`
 * namespace (four real tabs).
 */
export const governance: LocalizedGuideContent = {
  en: {
    title: "Governance & ops",
    purpose:
      "The operational control room: which environment an agent version actually runs in, " +
      "an append-only record of every consequential change, live service health, and the " +
      "organisation's privacy/data-retention rules.",
    featureWalkthrough: [
      {
        heading: "Environments tab",
        body:
          "Every environment (Development → UAT → Production), the agents and versions " +
          "deployed to it, and what it promotes to next. Pending promotions are listed " +
          "separately with the requester and the exact change; Approve or Reject writes a " +
          "real audit entry in the same transaction as the promotion itself — approving and " +
          "recording are never two separate, driftable steps.",
      },
      {
        heading: "Audit log tab",
        body:
          "Every configuration change, publish, permission grant and data export, newest " +
          "first, each entry showing who/what/environment/when. Selecting an entry shows its " +
          "full detail (actor, action, target). This log is append-only by design — no role " +
          "holds an update or delete grant on it, anywhere in the system.",
      },
      {
        heading: "Observability tab",
        body:
          "Per-service health: p95 latency, error rate and status, computed on demand from " +
          'real orchestration trace data via "Recompute now" (there is no continuously ' +
          "running telemetry worker yet — this is deliberately on-demand rather than faked as " +
          "live-streaming). A degraded service names exactly where its circuit breaker lives " +
          "(Tools → Resilience & fallbacks) so the same incident is visible and actionable " +
          "from two places, not just reported here.",
      },
      {
        heading: "Privacy & data tab",
        body:
          "Consent-ledger and erasure-request handling, transcript retention (30 days / 90 " +
          "days / 1 year / 7 years) and data residency (Sharjah / Dubai / region-flexible). " +
          "The statutory carve-out is explicit: transaction records always follow the 7-year " +
          "rule regardless of this setting — it only governs transcripts and derived memory. " +
          '"Run sweep now" performs a real purge of expired transcripts/memory; transaction ' +
          "records are always skipped and counted, never deleted, by that sweep. Erasure " +
          "requests are listed and processed here individually.",
      },
    ],
    howTo: [
      {
        title: "Promote an agent version toward Production",
        steps: [
          "Open the Environments tab and find the pending promotion (or request one from the " +
            "environment it's currently in).",
          "Review the requester and the exact change being promoted.",
          "Select Approve — this writes the promotion and its audit entry together, or " +
            "Reject with a note if it shouldn't proceed.",
        ],
      },
      {
        title: "Investigate a degraded service",
        steps: [
          'Open the Observability tab and select "Recompute now" for a fresh read.',
          "Find the service marked degraded and follow its note to Tools → Resilience & " +
            "fallbacks.",
          "Resolve the underlying issue, then reset that circuit breaker there.",
        ],
      },
      {
        title: "Process a right-to-be-forgotten request",
        steps: [
          "Open the Privacy & data tab's Erasure requests section.",
          "Find the request and review its subject and how it was received.",
          'Select "Process" — this honours the erasure per the tab\'s own consent-ledger ' +
            "rules.",
        ],
      },
    ],
    permissionsNote:
      "The whole screen requires a role permission distinct from day-to-day agent authoring " +
      "— a role without it sees a plain permission-denied message for every tab.",
    lastVerifiedAgainst: "messages/en.json's governance namespace — 2026-09-10",
  },
  ar: {
    title: "الحوكمة والتشغيل",
    purpose:
      "غرفة التحكم التشغيلية: في أي بيئة يعمل إصدار وكيل فعليًا، سجل غير قابل للتعديل لكل " +
      "تغيير جوهري، صحة الخدمات الحية، وقواعد الخصوصية والاحتفاظ بالبيانات للمؤسسة.",
    featureWalkthrough: [
      {
        heading: "تبويب البيئات",
        body:
          "كل بيئة (التطوير ← الاختبار المقبول ← الإنتاج)، والوكلاء والإصدارات المنشورة " +
          "فيها، وإلى أين تُرقّى تاليًا. تُسرد الترقيات المعلّقة منفصلة مع مقدّم الطلب " +
          "والتغيير بالتحديد؛ يكتب الاعتماد أو الرفض إدخال تدقيق حقيقيًا ضمن نفس معاملة " +
          "الترقية نفسها — الاعتماد والتسجيل ليسا أبدًا خطوتين منفصلتين قابلتين للانحراف.",
      },
      {
        heading: "تبويب سجل التدقيق",
        body:
          "كل تغيير إعداد، ونشر، ومنح صلاحية، وتصدير بيانات، الأحدث أولًا، ويعرض كل إدخال " +
          "من/ماذا/البيئة/متى. يعرض اختيار إدخال تفاصيله الكاملة (الفاعل، الإجراء، الهدف). " +
          "هذا السجل غير قابل للتعديل بالتصميم — لا يملك أي دور منحة تحديث أو حذف عليه في أي " +
          "مكان بالنظام.",
      },
      {
        heading: "تبويب المراقبة",
        body:
          "صحة كل خدمة: زمن استجابة p95، معدل الأخطاء والحالة، محسوبة عند الطلب من بيانات " +
          'تتبع التنسيق الحقيقية عبر "إعادة الحساب الآن" (لا يوجد بعد عامل قياس عن بُعد ' +
          "يعمل باستمرار — هذا عند الطلب عن قصد لا بثًا حيًا مزيّفًا). تسمي الخدمة المتدهورة " +
          "بالتحديد أين يقيم قاطع دائرتها (الأدوات ← المرونة والبدائل) بحيث تكون الحادثة نفسها " +
          "مرئية وقابلة للتصرف من مكانين، لا مجرد مُبلَّغ عنها هنا.",
      },
      {
        heading: "تبويب الخصوصية والبيانات",
        body:
          "معالجة سجل الموافقة وطلبات المحو، والاحتفاظ بالنصوص (30 يومًا / 90 يومًا / سنة / " +
          "7 سنوات) وإقامة البيانات (الشارقة / دبي / مرنة إقليميًا). الاستثناء القانوني صريح: " +
          "تتبع سجلات المعاملات دائمًا قاعدة السبع سنوات بغض النظر عن هذا الإعداد — فهو يحكم " +
          'فقط النصوص والذاكرة المشتقة. "تشغيل التطهير الآن" ينفّذ تطهيرًا حقيقيًا للنصوص/' +
          "الذاكرة المنتهية؛ وتُستثنى سجلات المعاملات وتُحصى دومًا، ولا تُحذف أبدًا، بذلك " +
          "التطهير. تُسرد طلبات المحو وتُعالَج هنا فرديًا.",
      },
    ],
    howTo: [
      {
        title: "ترقية إصدار وكيل نحو الإنتاج",
        steps: [
          "افتح تبويب البيئات وابحث عن الترقية المعلّقة (أو اطلب واحدة من البيئة التي هو " +
            "فيها حاليًا).",
          "راجع مقدّم الطلب والتغيير بالتحديد الجاري ترقيته.",
          "اختر اعتماد — يكتب هذا الترقية وإدخال تدقيقها معًا، أو ارفض مع ملاحظة إن لم يجب " +
            "أن يُنفَّذ.",
        ],
      },
      {
        title: "التحقيق في خدمة متدهورة",
        steps: [
          'افتح تبويب المراقبة واختر "إعادة الحساب الآن" لقراءة جديدة.',
          "ابحث عن الخدمة الموسومة بالتدهور واتبع ملاحظتها إلى الأدوات ← المرونة والبدائل.",
          "عالج المشكلة الأساسية، ثم أعد ضبط قاطع الدائرة ذاك هناك.",
        ],
      },
      {
        title: "معالجة طلب الحق في النسيان",
        steps: [
          "افتح قسم طلبات المحو في تبويب الخصوصية والبيانات.",
          "ابحث عن الطلب وراجع موضوعه وكيف وردته.",
          'اختر "معالجة" — يُنفَّذ المحو وفق قواعد سجل الموافقة الخاصة بالتبويب نفسه.',
        ],
      },
    ],
    permissionsNote:
      "تتطلب الشاشة بأكملها صلاحية دور منفصلة عن تأليف الوكلاء اليومي — فالدور الذي يفتقدها " +
      "يرى رسالة رفض صلاحية واضحة لكل تبويب.",
    lastVerifiedAgainst: "مساحة الاسم governance في messages/en.json — 2026-09-10",
  },
};
