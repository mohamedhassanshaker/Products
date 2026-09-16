import type { LocalizedGuideContent } from "./index.js";

/**
 * `/guardrails` (Screen 3, B-9 wave follow-up). Written directly against the real
 * `guardrails` namespace this screen's own `en.json`/`ar.json` keys are designed under —
 * see the orchestrating session's merge instructions for the exact keys. Follows
 * `governance.ts`'s own shape exactly (two real tabs here instead of four).
 */
export const guardrails: LocalizedGuideContent = {
  en: {
    title: "Guardrails & policies",
    purpose:
      "The global policy catalogue every agent inherits from. A locked policy — Mask PII " +
      "in transcripts, Prompt-injection filter — cannot be changed by any role, anywhere, " +
      "including here: the edit control simply does not exist for it, and the same refusal " +
      "holds even if something tried to write it directly. An unlocked policy's real value " +
      "can be changed here, and every agent's effective setting moves with it the moment it " +
      "is saved, unless that specific agent has its own override (Guardrails step of the " +
      "agent wizard).",
    featureWalkthrough: [
      {
        heading: "Global policies tab",
        body:
          "Every real platform policy: its title, what it does, which kind of value it " +
          "holds (on/off, a number, a fixed choice), and whether it is structurally locked. " +
          "A locked row shows no edit control at all — not a disabled one, an absent one. " +
          "An unlocked row's Edit action opens a small dialog matched to the policy's own " +
          "value kind: a real switch for an on/off policy, a bounded number field for a " +
          "threshold. A policy whose kind this screen has no dedicated control for yet " +
          "opens a raw, validated JSON field instead — still checked against the same real " +
          "shape rule the database itself enforces before it can be saved.",
      },
      {
        heading: "Per-agent overrides tab",
        body:
          "Read-only. Every agent that currently deviates from a platform policy, its " +
          "policy, the override's value, and the reason a Designer gave when they set it — " +
          "every override carries a real, substantive reason, never a blank one. Selecting " +
          "an agent's name opens that agent's own editor, where the override actually lives " +
          "and can be changed (wizard step 7, Guardrails) — this tab only shows what already " +
          "exists, it does not create or remove an override itself.",
      },
    ],
    howTo: [
      {
        title: "Change an unlocked global policy's value",
        steps: [
          "Open the Global policies tab and find the policy.",
          "If it shows a lock note instead of an Edit action, it is structurally locked — " +
            "no role can change it here or anywhere else.",
          "Select Edit, enter the new value in the control shown, and Save.",
        ],
      },
      {
        title: "Find out why a specific agent behaves differently from the platform default",
        steps: [
          "Open the Per-agent overrides tab.",
          "Find the agent and the policy in question — the row shows the override's value " +
            "and the reason it was set.",
          "Select the agent's name to open its own editor if the override needs to change.",
        ],
      },
    ],
    permissionsNote:
      "The whole screen requires the same governance permission as environments, promotions " +
      "and the audit log — a role without it sees a plain permission-denied message for " +
      "both tabs.",
    lastVerifiedAgainst: "messages/en.json's guardrails namespace — 2026-09-10",
  },
  ar: {
    title: "الضوابط والسياسات",
    purpose:
      "كتالوج السياسات العام الذي يرثه كل وكيل. لا يمكن لأي دور تغيير سياسة مُقفَلة — مثل " +
      '"إخفاء البيانات الشخصية في النصوص" أو "مرشّح حقن التعليمات" — في أي مكان، بما في ' +
      "ذلك هنا: عنصر التعديل غير موجود أصلًا لهذه السياسة، ويظل هذا الرفض قائمًا حتى لو " +
      "حاول أحدهم كتابتها مباشرة. أما القيمة الحقيقية لسياسة غير مُقفَلة فيمكن تغييرها هنا، " +
      "وينتقل الإعداد الفعلي لكل وكيل معها فور الحفظ، ما لم يكن لذلك الوكيل تحديد خاص به " +
      "(خطوة الضوابط في معالج الوكيل).",
    featureWalkthrough: [
      {
        heading: "تبويب السياسات العامة",
        body:
          "كل سياسة منصة حقيقية: عنوانها، وما تفعله، ونوع القيمة التي تحملها (تشغيل/" +
          "إيقاف، رقم، خيار ثابت)، وما إذا كانت مُقفَلة بنيويًا. لا يعرض الصف المُقفَل أي " +
          "عنصر تعديل على الإطلاق — ليس عنصرًا معطّلاً، بل غائبًا تمامًا. يفتح إجراء " +
          "التعديل في صف غير مُقفَل نافذة صغيرة تطابق نوع قيمة السياسة نفسها: مفتاح حقيقي " +
          "لسياسة تشغيل/إيقاف، وحقل رقمي محدود لعتبة. أما السياسة التي لا يملك هذا " +
          "الشاشة عنصر تحكم مخصصًا لنوعها بعد، فتفتح حقل JSON خامًا مُتحقَّقًا منه بدلًا " +
          "من ذلك — لا يزال يُفحَص وفق نفس قاعدة الشكل الحقيقية التي تفرضها قاعدة البيانات " +
          "نفسها قبل أن يمكن حفظه.",
      },
      {
        heading: "تبويب التحديدات لكل وكيل",
        body:
          "للقراءة فقط. كل وكيل ينحرف حاليًا عن سياسة المنصة، وسياسته، وقيمة التحديد، " +
          "والسبب الذي قدّمه المصمّم عند ضبطه — يحمل كل تحديد سببًا حقيقيًا وجوهريًا، لا " +
          "سببًا فارغًا أبدًا. يفتح اختيار اسم الوكيل محرّره الخاص، حيث يقيم التحديد فعليًا " +
          "ويمكن تغييره (الخطوة 7 من المعالج، الضوابط) — يعرض هذا التبويب فقط ما هو " +
          "موجود بالفعل، ولا ينشئ تحديدًا أو يزيله بنفسه.",
      },
    ],
    howTo: [
      {
        title: "تغيير قيمة سياسة عامة غير مُقفَلة",
        steps: [
          "افتح تبويب السياسات العامة وابحث عن السياسة.",
          "إذا ظهرت ملاحظة قفل بدلًا من إجراء تعديل، فهي مُقفَلة بنيويًا — لا يمكن لأي " +
            "دور تغييرها هنا أو في أي مكان آخر.",
          "اختر تعديل، أدخل القيمة الجديدة في العنصر المعروض، ثم احفظ.",
        ],
      },
      {
        title: "معرفة سبب اختلاف سلوك وكيل معيّن عن الإعداد الافتراضي للمنصة",
        steps: [
          "افتح تبويب التحديدات لكل وكيل.",
          "ابحث عن الوكيل والسياسة المعنية — يعرض الصف قيمة التحديد والسبب الذي ضُبط " + "لأجله.",
          "اختر اسم الوكيل لفتح محرّره الخاص إذا احتاج التحديد إلى تغيير.",
        ],
      },
    ],
    permissionsNote:
      "تتطلب الشاشة بأكملها نفس صلاحية الحوكمة التي تتطلبها البيئات والترقيات وسجل " +
      "التدقيق — فالدور الذي يفتقدها يرى رسالة رفض صلاحية واضحة لكلا التبويبين.",
    lastVerifiedAgainst: "مساحة الاسم guardrails في messages/en.json — 2026-09-10",
  },
};
