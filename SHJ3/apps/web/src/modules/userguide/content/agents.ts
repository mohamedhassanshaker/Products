import type { LocalizedGuideContent } from "./index.js";

/**
 * `/agents` — the agent registry (B2/B3). Written directly against
 * `messages/en.json`'s real `agents.registry` namespace and B-3's `tasks/todo.md` review
 * entry (publish/unpublish/archive/rollback semantics, `Agent.status` vs `AgentVersion.status`).
 */
export const agents: LocalizedGuideContent = {
  en: {
    title: "Agents",
    purpose:
      "The registry of every agent this entity has built — one row per agent, showing its " +
      "current version, publish status, which channels it's bound to, and how much traffic " +
      "it's handling. This is where an agent goes live, gets rolled back, or is retired.",
    featureWalkthrough: [
      {
        heading: "The registry table",
        body:
          "Each row shows the agent's name, current version, status (Published / Draft / " +
          "Archived), the channels it's bound to (Web, WhatsApp, mobile app, kiosk/IVR) and " +
          'its usage rate. "New agent" starts the wizard; each row\'s Actions menu offers ' +
          "Edit, Clone, Publish, Unpublish, Version history, and Archive.",
      },
      {
        heading: "Publish / Unpublish",
        body:
          "Publish takes a Draft version live for the first time — it becomes an immutable, " +
          "permanent snapshot, the agent's status becomes Published, and this is the version " +
          "citizens now talk to. Unpublish only flips the agent's own status back to Draft " +
          "(a fast, reversible flag) — it never touches the published version snapshot " +
          "itself. Publishing asks for a change summary, and is itself blocked if the " +
          "publish gate (Evaluation → Publish gate) finds a blocking condition — the dialog " +
          "names exactly which golden set, score and threshold failed.",
      },
      {
        heading: "Version history & rollback",
        body:
          'Every version this agent has ever reached, each with its change summary. "Roll ' +
          'back to this version" makes an older, already-published version current again — ' +
          "this changes *which* version is current, it does not delete or renumber the " +
          "version being rolled back past, so that version still exists in history and can " +
          "itself be rolled forward to again later.",
      },
      {
        heading: "Clone and Archive",
        body:
          "Clone copies an agent's full configuration — including its tool bindings — into a " +
          "brand-new Draft agent, a fast way to start a variant without re-doing every " +
          "wizard step. Archive removes an agent from every channel it's bound to; an agent " +
          "still bound to a live channel cannot be archived until it's unbound first.",
      },
    ],
    howTo: [
      {
        title: "Publish an agent for the first time",
        steps: [
          "Finish configuring it in the wizard (see the Agent designer wizard guide entry).",
          "From the registry, open its Actions menu and select Publish.",
          "Enter a change summary and confirm — if the publish gate blocks it, fix the named " +
            "reason (a golden-set score, a translation floor) and try again.",
        ],
      },
      {
        title: "Undo a bad publish",
        steps: [
          "Open the agent's Actions menu and select Version history.",
          "Find the last version that was working correctly.",
          'Select "Roll back to this version" — it becomes current immediately.',
        ],
      },
      {
        title: "Retire an agent that's no longer needed",
        steps: [
          "Make sure it isn't bound to any live channel (unbind it in Channels first if it " +
            "is — the archive action refuses otherwise).",
          "Open its Actions menu and select Archive, then confirm.",
        ],
      },
    ],
    permissionsNote:
      "Viewing and building requires the Agent Designer role or above. Publishing is a " +
      "separate, higher permission reserved for Entity Admin — a deliberate separation of " +
      "duties enforced in the Roles & permissions matrix (IAM), not just a UI convention: an " +
      "Agent Designer can save a draft for an Entity Admin to publish, but cannot publish it " +
      "themselves.",
    lastVerifiedAgainst:
      "messages/en.json's agents.registry namespace, tasks/todo.md's B-3 review — 2026-09-10",
  },
  ar: {
    title: "الوكلاء",
    purpose:
      "سجل كل وكيل بنته هذه الجهة — صف واحد لكل وكيل، يعرض إصداره الحالي وحالة نشره والقنوات " +
      "المرتبط بها وحجم حركته. من هنا يُنشر الوكيل أو يُعاد لإصدار سابق أو يُقاعَد.",
    featureWalkthrough: [
      {
        heading: "جدول السجل",
        body:
          "يعرض كل صف اسم الوكيل وإصداره الحالي وحالته (منشور / مسودة / مؤرشف) والقنوات " +
          "المرتبط بها (الويب، واتساب، تطبيق الجوال، الأكشاك/الرد الصوتي) ومعدل استخدامه. " +
          'يبدأ زر "وكيل جديد" المعالج؛ وتتيح قائمة الإجراءات في كل صف: تعديل، استنساخ، ' +
          "نشر، إلغاء نشر، سجل الإصدارات، وأرشفة.",
      },
      {
        heading: "النشر / إلغاء النشر",
        body:
          "يجعل النشر إصدار المسودة مباشرًا لأول مرة — يصبح لقطة دائمة غير قابلة للتعديل، " +
          'وتصبح حالة الوكيل "منشور"، وهذا هو الإصدار الذي يتحدث معه المواطنون الآن. أما ' +
          "إلغاء النشر فيعيد حالة الوكيل فقط إلى مسودة (تبديل سريع وقابل للتراجع) — لا يمس " +
          "لقطة الإصدار المنشور نفسها أبدًا. يطلب النشر ملخص تغيير، ويُحجب إذا وجدت بوابة " +
          "النشر (التقييم ← بوابة النشر) شرطًا مانعًا — وتذكر النافذة بالتحديد أي مجموعة " +
          "معيارية والدرجة والحد الذي فشل.",
      },
      {
        heading: "سجل الإصدارات والتراجع",
        body:
          'كل إصدار وصله هذا الوكيل يومًا، مع ملخص تغييره. يجعل "التراجع إلى هذا الإصدار" ' +
          "إصدارًا أقدم منشورًا سابقًا حاليًا من جديد — يغيّر هذا الإصدار *الحالي* فقط، ولا " +
          "يحذف أو يعيد ترقيم الإصدار المتراجع عنه، فيبقى موجودًا في السجل ويمكن التقدم إليه " +
          "لاحقًا مجددًا.",
      },
      {
        heading: "الاستنساخ والأرشفة",
        body:
          "ينسخ الاستنساخ كامل إعداد الوكيل — بما في ذلك ارتباطات أدواته — إلى وكيل مسودة " +
          "جديد تمامًا، طريقة سريعة لبدء نسخة بديلة دون إعادة كل خطوات المعالج. تزيل الأرشفة " +
          "الوكيل من كل قناة مرتبط بها؛ ولا يمكن أرشفة وكيل مرتبط بقناة مباشرة حتى يُفصل عنها " +
          "أولًا.",
      },
    ],
    howTo: [
      {
        title: "نشر وكيل لأول مرة",
        steps: [
          "أكمل إعداده في المعالج (راجع دليل معالج تصميم الوكيل).",
          "من السجل، افتح قائمة إجراءاته واختر نشر.",
          "أدخل ملخص تغيير وأكّد — إذا حجبته بوابة النشر، عالج السبب المذكور (درجة مجموعة " +
            "معيارية، حد ترجمة) وحاول مجددًا.",
        ],
      },
      {
        title: "التراجع عن نشر سيء",
        steps: [
          "افتح قائمة إجراءات الوكيل واختر سجل الإصدارات.",
          "ابحث عن آخر إصدار كان يعمل بشكل صحيح.",
          'اختر "التراجع إلى هذا الإصدار" — يصبح حاليًا فورًا.',
        ],
      },
      {
        title: "إيقاف وكيل لم يعد مطلوبًا",
        steps: [
          "تأكد أنه غير مرتبط بأي قناة مباشرة (افصله في الأنواع أولًا إن كان كذلك — يرفض " +
            "إجراء الأرشفة خلاف ذلك).",
          "افتح قائمة إجراءاته واختر أرشفة، ثم أكّد.",
        ],
      },
    ],
    permissionsNote:
      "يتطلب العرض والبناء دور مصمم الوكلاء أو أعلى. النشر صلاحية منفصلة وأعلى مقصورة على " +
      "مسؤول الجهة — فصل مهام متعمد مفروض في مصفوفة الأدوار والصلاحيات (إدارة الهوية)، لا " +
      "مجرد عرف واجهة: يمكن لمصمم الوكلاء حفظ مسودة ليقوم مسؤول الجهة بنشرها، لكن لا يمكنه " +
      "نشرها بنفسه.",
    lastVerifiedAgainst:
      "مساحة الاسم agents.registry في messages/en.json، ومراجعة B-3 في tasks/todo.md — 2026-09-10",
  },
};
