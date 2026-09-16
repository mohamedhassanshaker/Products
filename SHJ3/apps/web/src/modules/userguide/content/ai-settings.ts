import type { LocalizedGuideContent } from "./index.js";

/**
 * `/ai-settings` — a brand-new standalone screen (product owner's choice, not a tab on an
 * existing screen) letting an Agent Designer set the Flow Designer AI sidebar's model
 * without an env edit plus an `ai` container recreate. See `ai-settings/page.tsx`'s own doc
 * comment for the real backend (`FlowAssistantConfigs`) it reads and writes.
 */
export const aiSettings: LocalizedGuideContent = {
  en: {
    title: "AI settings",
    purpose:
      "Sets which language model the Flow Designer's AI sidebar (the \"propose an edit\" " +
      "panel on the Flows step) uses for this tenant, and which model it falls back to if " +
      "the first one is unavailable — without needing an environment change or a service " +
      "restart.",
    featureWalkthrough: [
      {
        heading: "Primary model",
        body:
          "A free-text field for the model identifier sent to OpenRouter, e.g. " +
          '"anthropic/claude-sonnet-5". There is no dropdown of allowed models — this ' +
          "matches the same free-text convention already used for an agent's own primary/" +
          "fallback model on the wizard's Model step.",
      },
      {
        heading: "Fallback model (optional)",
        body:
          "Used only if a proposal request to the primary model fails. Leave it blank to " +
          "have no fallback, matching this tenant's behavior before this screen existed.",
      },
      {
        heading: "Save",
        body:
          "Saves immediately for every staff user in this tenant — this is a tenant-wide " +
          "setting, not a personal preference. The next AI sidebar request in the Flow " +
          "Designer uses the new model right away.",
      },
    ],
    howTo: [
      {
        title: "Change the model the Flow Designer's AI sidebar uses",
        steps: [
          "Open AI settings from the sidebar.",
          "Enter the new primary model identifier.",
          "Optionally enter a fallback model.",
          "Select Save.",
        ],
      },
    ],
    permissionsNote:
      "Gated on the agents:manage permission — the same permission an Agent Designer " +
      "already holds to author flows and use the AI sidebar itself. A role without it sees " +
      "a plain permission-denied message for the whole screen.",
    lastVerifiedAgainst: "ai-settings/page.tsx, ai-settings-screen.tsx — 2026-09-12",
  },
  ar: {
    title: "إعدادات الذكاء الاصطناعي",
    purpose:
      "يحدد نموذج اللغة الذي يستخدمه الشريط الجانبي للذكاء الاصطناعي في مصمم التدفقات " +
      "(لوحة \"اقتراح تعديل\" في خطوة التدفقات) لهذا المستأجر، والنموذج الاحتياطي الذي " +
      "يُستخدم إذا كان الأول غير متاح — دون الحاجة إلى تغيير بيئة التشغيل أو إعادة تشغيل " +
      "الخدمة.",
    featureWalkthrough: [
      {
        heading: "النموذج الأساسي",
        body:
          "حقل نصي حر لمعرّف النموذج المُرسل إلى OpenRouter، مثل " +
          '"anthropic/claude-sonnet-5". لا توجد قائمة منسدلة بالنماذج المسموح بها — وهذا ' +
          "يطابق نفس الاصطلاح النصي الحر المستخدم بالفعل للنموذج الأساسي/الاحتياطي الخاص " +
          "بالوكيل في خطوة النموذج بالمعالج.",
      },
      {
        heading: "النموذج الاحتياطي (اختياري)",
        body:
          "يُستخدم فقط إذا فشل طلب اقتراح موجَّه إلى النموذج الأساسي. اتركه فارغًا لعدم " +
          "وجود نموذج احتياطي، مطابقًا لسلوك هذا المستأجر قبل وجود هذه الشاشة.",
      },
      {
        heading: "حفظ",
        body:
          "يُحفظ فورًا لكل مستخدم موظف في هذا المستأجر — هذا إعداد على مستوى المستأجر، " +
          "وليس تفضيلًا شخصيًا. يستخدم طلب الشريط الجانبي التالي في مصمم التدفقات النموذج " +
          "الجديد فورًا.",
      },
    ],
    howTo: [
      {
        title: "تغيير النموذج الذي يستخدمه الشريط الجانبي للذكاء الاصطناعي في مصمم التدفقات",
        steps: [
          "افتح إعدادات الذكاء الاصطناعي من الشريط الجانبي.",
          "أدخل معرّف النموذج الأساسي الجديد.",
          "أدخل نموذجًا احتياطيًا اختياريًا إن أردت.",
          "اختر حفظ.",
        ],
      },
    ],
    permissionsNote:
      "محكومة بصلاحية agents:manage — نفس الصلاحية التي يملكها مصمم الوكلاء بالفعل لتأليف " +
      "التدفقات واستخدام الشريط الجانبي للذكاء الاصطناعي نفسه. الدور الذي يفتقدها يرى " +
      "رسالة رفض صلاحية واضحة للشاشة بأكملها.",
    lastVerifiedAgainst: "ai-settings/page.tsx, ai-settings-screen.tsx — 2026-09-12",
  },
};
