import type { LocalizedGuideContent } from "./index.js";

/**
 * `/agents/new-with-ai` — the registry's "Create with AI" entry point, sibling to the plain
 * "New agent" form. Written directly against `messages/en.json`'s real `agents.newWithAi`
 * namespace and `agents/actions.ts`'s real `proposeAgentCreationAction`/
 * `applyAgentCreationPlanAction`.
 */
export const agentsNewWithAi: LocalizedGuideContent = {
  en: {
    title: "Create agent with AI",
    purpose:
      "Describe a business need in plain language and have the AI propose a whole new " +
      "agent — identity, instructions, model, tools, knowledge, guardrails, channels, and " +
      "a starting conversation flow — for you to review, edit, and accept before anything " +
      "is created. A faster on-ramp into the same wizard the plain \"New agent\" form " +
      "opens, not a separate kind of agent.",
    featureWalkthrough: [
      {
        heading: "Describe the business need",
        body:
          "One free-text message, e.g. \"An agent that helps citizens check their business " +
          "license renewal status and hands over to a human if the license has expired.\" " +
          "Select Generate proposal to ask the AI for a full draft.",
      },
      {
        heading: "Review screen — seven sections",
        body:
          "Identity & instructions and Model are pre-filled but directly editable text " +
          "fields. Tools and Guardrails are checklists of real, existing tools/policies " +
          "(shown by name, never a raw id) — uncheck anything you don't want. Knowledge is " +
          "a single toggle. Channels is the same three-option toggle the wizard's own " +
          "Channels step uses. Conversation flow shows one plain-language sentence " +
          "describing the flow to build — edit it if it doesn't match what you described. " +
          "Any item the AI could not ground in something real (an unknown tool, a locked " +
          "policy) is silently dropped and explained in a warning banner at the top, never " +
          "guessed at.",
      },
      {
        heading: "Creating the agent",
        body:
          "Select Create agent to apply the reviewed proposal. This runs through the exact " +
          "same real steps a manual wizard walk-through would: create the agent, save " +
          "instructions/model, set channels, apply guardrail overrides, bind tools, enable " +
          "knowledge, then build the starting conversation flow from the flow instruction. " +
          "A result checklist shows exactly what was applied, group by group.",
      },
      {
        heading: "If something can't be applied",
        body:
          "Nothing here shares one big transaction — exactly like filling in the wizard by " +
          "hand, each group is its own save. If one group fails (e.g. a tool was removed " +
          "moments earlier), everything before it is already saved, the result checklist " +
          "shows exactly where it stopped, and you land in the normal wizard to finish the " +
          "remaining steps yourself. The agent is never left half-created or lost.",
      },
    ],
    howTo: [
      {
        title: "Create a new agent from a description",
        steps: [
          "Open the Agents registry and select \"Create with AI\".",
          "Describe the business need in one message and select Generate proposal.",
          "Review each of the seven sections, editing or unchecking anything you'd change.",
          "Select Create agent.",
          "Select \"Continue in the wizard\" to finish any remaining steps (Test, Publish).",
        ],
      },
    ],
    permissionsNote:
      "Gated on the agents:manage permission — the same permission required to use the " +
      "plain \"New agent\" form and the Flow Designer's own AI sidebar. A role without it " +
      "sees a plain permission-denied message for the whole screen.",
    lastVerifiedAgainst: "agents/new-with-ai/page.tsx, create-with-ai-form.tsx — 2026-09-12",
  },
  ar: {
    title: "إنشاء وكيل بالذكاء الاصطناعي",
    purpose:
      "صف حاجة تجارية بلغة بسيطة، ودع الذكاء الاصطناعي يقترح وكيلاً جديدًا كاملاً — " +
      "الهوية والتعليمات والنموذج والأدوات والمعرفة والضوابط والقنوات وتدفق محادثة أولي " +
      "— لمراجعته وتعديله وقبوله قبل إنشاء أي شيء. طريق أسرع للدخول إلى نفس المعالج الذي " +
      "يفتحه نموذج \"وكيل جديد\" العادي، وليس نوعًا منفصلاً من الوكلاء.",
    featureWalkthrough: [
      {
        heading: "وصف الحاجة التجارية",
        body:
          "رسالة نصية حرة واحدة، مثل \"وكيل يساعد المواطنين على التحقق من حالة تجديد " +
          "الرخصة التجارية ويحوّل إلى موظف بشري إذا انتهت صلاحية الرخصة.\" اختر \"إنشاء " +
          "الاقتراح\" لطلب مسودة كاملة من الذكاء الاصطناعي.",
      },
      {
        heading: "شاشة المراجعة — سبعة أقسام",
        body:
          "الهوية والتعليمات والنموذج معبأة مسبقًا لكنها حقول نصية قابلة للتعديل مباشرة. " +
          "الأدوات والضوابط قوائم اختيار لأدوات/سياسات حقيقية وموجودة فعليًا (تظهر بالاسم، " +
          "أبدًا بمعرّف خام) — ألغِ تحديد أي شيء لا تريده. المعرفة مفتاح تبديل واحد. " +
          "القنوات هي نفس مفتاح الخيارات الثلاثة الذي تستخدمه خطوة القنوات في المعالج. " +
          "تدفق المحادثة يعرض جملة واحدة بلغة بسيطة تصف التدفق المراد بناؤه — عدّلها إذا " +
          "لم تطابق ما وصفته. أي عنصر تعذّر على الذكاء الاصطناعي ربطه بشيء حقيقي (أداة " +
          "غير معروفة، سياسة مقفلة) يُحذف بصمت ويُشرح في شريط تحذير أعلى الشاشة، ولا " +
          "يُخمَّن أبدًا.",
      },
      {
        heading: "إنشاء الوكيل",
        body:
          "اختر \"إنشاء الوكيل\" لتطبيق الاقتراح بعد مراجعته. يمر هذا بنفس الخطوات " +
          "الحقيقية التي يمر بها إكمال المعالج يدويًا تمامًا: إنشاء الوكيل، حفظ " +
          "التعليمات/النموذج، تعيين القنوات، تطبيق تجاوزات الضوابط، ربط الأدوات، تفعيل " +
          "المعرفة، ثم بناء تدفق المحادثة الأولي من تعليمات التدفق. تُظهر قائمة نتائج " +
          "بالضبط ما تم تطبيقه، مجموعة تلو الأخرى.",
      },
      {
        heading: "إذا تعذّر تطبيق شيء ما",
        body:
          "لا شيء هنا يشترك في معاملة واحدة كبيرة — تمامًا مثل تعبئة المعالج يدويًا، كل " +
          "مجموعة هي حفظ مستقل بذاته. إذا فشلت مجموعة ما (مثلاً أداة أُزيلت قبل لحظات)، " +
          "يكون كل ما قبلها محفوظًا بالفعل، وتُظهر قائمة النتائج بالضبط أين توقفت، وتنتقل " +
          "إلى المعالج العادي لإكمال الخطوات المتبقية بنفسك. لا يُترك الوكيل أبدًا نصف " +
          "مُنشأ أو ضائعًا.",
      },
    ],
    howTo: [
      {
        title: "إنشاء وكيل جديد من وصف",
        steps: [
          "افتح سجل الوكلاء واختر \"الإنشاء بالذكاء الاصطناعي\".",
          "صف الحاجة التجارية في رسالة واحدة واختر \"إنشاء الاقتراح\".",
          "راجع كل قسم من الأقسام السبعة، وعدّل أو ألغِ تحديد أي شيء تريد تغييره.",
          "اختر \"إنشاء الوكيل\".",
          "اختر \"المتابعة في المعالج\" لإكمال أي خطوات متبقية (الاختبار، النشر).",
        ],
      },
    ],
    permissionsNote:
      "محكومة بصلاحية agents:manage — نفس الصلاحية المطلوبة لاستخدام نموذج \"وكيل جديد\" " +
      "العادي والشريط الجانبي للذكاء الاصطناعي في مصمم التدفقات. الدور الذي يفتقدها يرى " +
      "رسالة رفض صلاحية واضحة للشاشة بأكملها.",
    lastVerifiedAgainst: "agents/new-with-ai/page.tsx, create-with-ai-form.tsx — 2026-09-12",
  },
};
