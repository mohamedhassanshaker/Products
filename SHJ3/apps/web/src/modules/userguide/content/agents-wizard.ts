import type { LocalizedGuideContent } from "./index.js";

/**
 * `/agents/new` and `/agents/[id]/edit` — the ten-step agent designer wizard. Written
 * directly against `messages/en.json`'s real `agents.new`/`agents.wizard` namespaces
 * (the real `steps` list, and the real unavailable/guardrail/publish sub-copy).
 */
export const agentsWizard: LocalizedGuideContent = {
  en: {
    title: "Agent designer wizard",
    purpose:
      "Where an agent is actually built: its identity, instructions, model, tools, " +
      "knowledge, flows, guardrails, channels, and — once it's ready — published. The " +
      "wizard is freely navigable: every step's state persists as you move back and forth, " +
      'and "Save draft" keeps your work even if you leave partway through.',
    featureWalkthrough: [
      {
        heading: "Starting a new agent",
        body:
          '"New agent" (from the registry) asks only for a name and description — the ' +
          "rest of the wizard opens once the agent exists as a real Draft. Editing an " +
          "already-published agent opens (or resumes) a new draft version forked from the " +
          "current one, never the published snapshot itself.",
      },
      {
        heading: "The ten steps",
        body:
          "Identity (name, owning entity — fixed at creation, description) → Instructions " +
          "(system prompt, tone) → Model (primary/fallback model via OpenRouter, " +
          "temperature) → Skills & tools → Knowledge → Flows → Guardrails → Channels → Test " +
          "→ Publish.",
      },
      {
        heading: "Skills & tools step",
        body:
          "Three sub-tabs — Skills catalogue, MCP servers, API connectors — the exact same " +
          'catalogue the standalone Tools screen manages. "Registered ≠ callable": a tool ' +
          "only becomes usable by this agent once explicitly Attached here; Detach removes " +
          "it again. Binding here and in the Tools screen are the same underlying data.",
      },
      {
        heading: "Knowledge step",
        body:
          "Enable or disable this agent's access to the tenant's knowledge base with a " +
          "single toggle, then Save. Sources and retrieval settings themselves are managed " +
          "on the separate Knowledge / Graph RAG screen, not here.",
      },
      {
        heading: "Flows step",
        body:
          "Build the conversation flow this agent runs — the same flow B-5's runtime " +
          "actually executes, drawn on a real interactive canvas (drag to reposition, drag " +
          "between two nodes to connect them). The palette in the corner of the canvas adds " +
          "a node of any of the five real types (Message, Question, Tool call, Handover, " +
          "Condition); clicking a node opens a form with that type's real fields — a " +
          "Question's slot name and its answer options (typed one at a time, no JSON), a " +
          "Tool call's bound tool plus its retry count and failure path, a Handover's " +
          "reason, a Condition's expression. Click an existing connection on the canvas to " +
          "edit its label/condition or delete it. A compact row below the canvas sets the " +
          "selected node as the flow's entry or escape point, or deletes it — every flow " +
          "needs exactly one of each, and a reachable free-text escape path, before it can " +
          "publish; an Outline view (for reviewing structure without the graphical canvas) " +
          "keeps the full connections table. \"Ask AI to edit\" opens a side panel where " +
          "describing a change in plain language proposes real edits for you to review and " +
          "apply — nothing changes until you accept the proposal.",
      },
      {
        heading: "Guardrails step",
        body:
          "Real, per-agent policy toggles. Some guardrails (e.g. masking PII in transcripts) " +
          "are locked and cannot be overridden from here at all — shown checked and disabled. " +
          "Others, like the grounding-confidence threshold, are adjustable per agent.",
      },
      {
        heading: "Test step",
        body:
          "A real sandbox conversation against the current draft of this agent's flow — " +
          "type a message and see how the flow actually responds, before publishing. Nothing " +
          "here creates real citizen-facing data, and any bound tool that would call a real " +
          "external API is simulated rather than actually invoked. \"Restart conversation\" " +
          "starts a fresh session.",
      },
      {
        heading: "Publish step",
        body:
          "Shows the version transition (e.g. v1.2 → v1.3), is fixed to the Development " +
          "environment until environment promotion exists, and is blocked with a specific, " +
          "named reason — a missing step, the publish gate, or (since publishing an agent " +
          "version now also publishes every flow it uses) a bound flow that isn't ready yet " +
          "— rather than a generic failure.",
      },
    ],
    howTo: [
      {
        title: "Build a brand-new agent from scratch",
        steps: [
          'From the Agents registry, select "New agent" and give it a name and description.',
          "Work through Identity → Instructions → Model, filling in the system prompt and " +
            "choosing a primary model.",
          "In Skills & tools, attach the skills, MCP tools or connectors this agent needs.",
          "Bind any relevant knowledge collections, then build the Flows step's conversation " +
            "flow.",
          "Review Guardrails, enable the channels it should be reachable on, then Publish.",
        ],
      },
      {
        title: "Build a conversation flow",
        steps: [
          "Open the Flows step and use the palette in the corner of the canvas to add the " +
            "first node — start with a Message or a Question.",
          "Fill in that node type's real fields (e.g. a Question's slot name, a Tool call's " +
            "bound tool, retry count and failure-path node).",
          "Repeat for every step the conversation needs, then drag from one node to another " +
            "to connect them — click an existing connection on the canvas to label it or " +
            "mark it a default branch.",
          "Select the first node and use the compact action row below the canvas to set it " +
            "as the flow's entry point, and set another node as its escape point — both, " +
            "plus a reachable free-text escape path, are required before this flow (and the " +
            "agent version publishing it) can be published.",
        ],
      },
      {
        title: "Save progress without publishing",
        steps: [
          'At any step, select "Save & continue" or "Save draft".',
          "Leave and come back later — the wizard reopens exactly where the draft left off.",
        ],
      },
      {
        title: "Understand why Publish is blocked",
        steps: [
          "Open the Publish step.",
          "Read the named blocking reason — a missing step (e.g. no channel enabled yet), or " +
            "a publish-gate condition naming the exact golden set, score and threshold missed.",
          "Fix that specific thing and try Publish again.",
        ],
      },
    ],
    permissionsNote:
      "Creating and editing agents requires the Agent Designer role or above. Publishing " +
      "requires Entity Admin specifically — an Agent Designer without it can still do " +
      'everything up to "Save draft", with the Publish button itself explaining that ' +
      "publishing needs an Entity Admin.",
    lastVerifiedAgainst:
      "messages/en.json's agents.new/agents.wizard namespaces (including the " +
      "agents.wizard.knowledge/test keys), modules/flows/, agents/[id]/edit/steps/" +
      "flows-step.tsx, knowledge-step.tsx, test-step.tsx — 2026-09-11 (review-comments-3)",
  },
  ar: {
    title: "معالج تصميم الوكيل",
    purpose:
      "هنا يُبنى الوكيل فعليًا: هويته، تعليماته، نموذجه، أدواته، معرفته، تدفقاته، ضوابطه، " +
      "قنواته، وأخيرًا نشره. يمكن التنقل بحرية في المعالج: تُحفظ حالة كل خطوة أثناء التنقل " +
      'بينها، ويحافظ "حفظ المسودة" على عملك حتى لو غادرت في المنتصف.',
    featureWalkthrough: [
      {
        heading: "بدء وكيل جديد",
        body:
          'يطلب "وكيل جديد" (من السجل) فقط اسمًا ووصفًا — تُفتح بقية خطوات المعالج بمجرد ' +
          "وجود الوكيل كمسودة حقيقية. أما تعديل وكيل منشور مسبقًا فيفتح (أو يستأنف) إصدار " +
          "مسودة جديد متفرّع من الإصدار الحالي، وليس اللقطة المنشورة نفسها أبدًا.",
      },
      {
        heading: "الخطوات العشر",
        body:
          "الهوية (الاسم، الجهة المالكة — ثابتة عند الإنشاء، الوصف) ← التعليمات (موجّه " +
          "النظام، النبرة) ← النموذج (النموذج الأساسي/الاحتياطي عبر OpenRouter، درجة " +
          "الحرارة) ← المهارات والأدوات ← المعرفة ← التدفقات ← الضوابط ← القنوات ← الاختبار " +
          "← النشر.",
      },
      {
        heading: "خطوة المهارات والأدوات",
        body:
          "ثلاثة تبويبات فرعية — كتالوج المهارات، خوادم MCP، موصلات API — نفس الكتالوج الذي " +
          'تديره شاشة الأدوات المستقلة تمامًا. "مسجَّل ≠ قابل للاستدعاء": لا تصبح الأداة ' +
          'قابلة للاستخدام من هذا الوكيل إلا بعد "إرفاقها" هنا صراحة؛ ويزيلها "فصل" مجددًا. ' +
          "الربط هنا وفي شاشة الأدوات هو نفس البيانات الأساسية.",
      },
      {
        heading: "خطوة المعرفة",
        body:
          "فعّل أو عطّل وصول هذا الوكيل إلى قاعدة معرفة الجهة بمفتاح واحد، ثم احفظ. تُدار " +
          "المصادر وإعدادات الاسترجاع نفسها من شاشة المعرفة / رسم المعرفة البياني المنفصلة، " +
          "وليس من هنا.",
      },
      {
        heading: "خطوة التدفقات",
        body:
          "ابنِ تدفق المحادثة الذي يُشغّله هذا الوكيل — نفس التدفق الذي تُنفّذه فعليًا بيئة " +
          "تشغيل B-5، مرسومًا على لوحة تفاعلية حقيقية (اسحب لإعادة وضع عقدة، واسحب بين " +
          "عقدتين لربطهما). تضيف اللوحة الجانبية في زاوية اللوحة عقدة من أي من الأنواع " +
          "الخمسة الحقيقية (رسالة، سؤال، استدعاء أداة، تحويل، شرط)؛ يفتح النقر على عقدة " +
          "نموذجًا بحقول ذلك النوع الحقيقية — اسم الحقل وخيارات الإجابة (تُكتب واحدًا تلو " +
          "الآخر، دون JSON) لعقدة السؤال، الأداة المرتبطة وعدد المحاولات ومسار الفشل لعقدة " +
          "استدعاء الأداة، سبب التحويل لعقدة التحويل، تعبير الشرط لعقدة الشرط. انقر على " +
          "اتصال موجود على اللوحة لتعديل تسميته/شرطه أو حذفه. يحدد صف مضغوط أسفل اللوحة " +
          "العقدة المحددة كنقطة دخول أو هروب للتدفق، أو يحذفها — يحتاج كل تدفق إلى واحدة من " +
          "كل منهما، ومسار هروب بنص حر يمكن الوصول إليه، قبل أن يُنشر؛ يحتفظ عرض الخطوط " +
          "العريضة (لمراجعة البنية دون اللوحة الرسومية) بجدول الاتصالات الكامل. يفتح " +
          '"اطلب من الذكاء الاصطناعي التعديل" لوحة جانبية حيث يؤدي وصف تغيير بلغة بسيطة إلى ' +
          "اقتراح تعديلات حقيقية لمراجعتها وتطبيقها — لا يتغير شيء حتى تقبل الاقتراح.",
      },
      {
        heading: "خطوة الضوابط",
        body:
          "مفاتيح سياسة حقيقية لكل وكيل. بعض الضوابط (مثل إخفاء المعلومات الشخصية في " +
          "النصوص) مقفلة ولا يمكن تجاوزها من هنا إطلاقًا — تظهر مفعّلة وغير قابلة للتعديل. " +
          "وأخرى، مثل حد ثقة التأصيل، قابلة للتعديل لكل وكيل.",
      },
      {
        heading: "خطوة الاختبار",
        body:
          "محادثة تجريبية حقيقية مقابل المسودة الحالية لتدفق هذا الوكيل — اكتب رسالة وشاهد " +
          "كيف يستجيب التدفق فعليًا، قبل النشر. لا يُنشئ هذا أي بيانات مواطن حقيقية، وأي أداة " +
          'مرتبطة قد تستدعي واجهة برمجة خارجية حقيقية تُحاكى بدلاً من استدعائها فعليًا. "إعادة ' +
          'تشغيل المحادثة" تبدأ جلسة جديدة.',
      },
      {
        heading: "خطوة النشر",
        body:
          "تعرض انتقال الإصدار (مثل v1.2 ← v1.3)، وهي ثابتة على بيئة التطوير حتى يوجد ترقية " +
          "بيئات، وتُحجب بسبب محدد ومسمّى — خطوة ناقصة، أو بوابة النشر، أو (بما أن نشر إصدار " +
          "الوكيل الآن ينشر أيضًا كل تدفق يستخدمه) تدفق مرتبط غير جاهز بعد — بدل فشل عام.",
      },
    ],
    howTo: [
      {
        title: "بناء وكيل جديد تمامًا من الصفر",
        steps: [
          'من سجل الوكلاء، اختر "وكيل جديد" وأعطه اسمًا ووصفًا.',
          "تابع الهوية ← التعليمات ← النموذج، وأدخل موجّه النظام واختر نموذجًا أساسيًا.",
          "في المهارات والأدوات، أرفق المهارات أو أدوات MCP أو الموصلات التي يحتاجها الوكيل.",
          "اربط أي مجموعات معرفة ذات صلة، ثم ابنِ تدفق المحادثة في خطوة التدفقات.",
          "راجع الضوابط، فعّل القنوات التي يجب أن يكون متاحًا عليها، ثم انشر.",
        ],
      },
      {
        title: "بناء تدفق محادثة",
        steps: [
          "افتح خطوة التدفقات واستخدم اللوحة الجانبية في زاوية اللوحة لإضافة أول عقدة — " +
            "ابدأ برسالة أو سؤال.",
          "املأ الحقول الحقيقية لذلك النوع (مثل اسم الحقل لعقدة السؤال، أو الأداة المرتبطة " +
            "وعدد المحاولات وعقدة مسار الفشل لعقدة استدعاء الأداة).",
          "كرر ذلك لكل خطوة يحتاجها التدفق، ثم اسحب من عقدة إلى أخرى لربطهما — انقر على " +
            "اتصال موجود على اللوحة لتسميته أو لتحديده كفرع افتراضي.",
          "حدد العقدة الأولى واستخدم الصف المضغوط أسفل اللوحة لتعيينها كنقطة دخول للتدفق، " +
            "وعيّن عقدة أخرى كنقطة هروبه — كلاهما، إضافة إلى مسار هروب بنص حر يمكن الوصول " +
            "إليه، مطلوبان قبل أن يمكن نشر هذا التدفق (وإصدار الوكيل الذي ينشره).",
        ],
      },
      {
        title: "حفظ التقدم دون النشر",
        steps: [
          'في أي خطوة، اختر "حفظ ومتابعة" أو "حفظ المسودة".',
          "غادر وارجع لاحقًا — يُعاد فتح المعالج تمامًا حيث توقفت المسودة.",
        ],
      },
      {
        title: "فهم سبب حجب النشر",
        steps: [
          "افتح خطوة النشر.",
          "اقرأ السبب المانع المسمّى — خطوة ناقصة (مثل عدم تفعيل أي قناة بعد)، أو شرط بوابة " +
            "نشر يسمي بالتحديد المجموعة المعيارية والدرجة والحد الذي فات.",
          "عالج ذلك الأمر تحديدًا وحاول النشر مجددًا.",
        ],
      },
    ],
    permissionsNote:
      "يتطلب إنشاء الوكلاء وتعديلهم دور مصمم الوكلاء أو أعلى. يتطلب النشر تحديدًا مسؤول " +
      'الجهة — فمصمم الوكلاء بلا هذه الصلاحية يمكنه فعل كل شيء حتى "حفظ المسودة"، ويوضّح ' +
      "زر النشر نفسه أن النشر يتطلب مسؤول جهة.",
    lastVerifiedAgainst:
      "مساحتا الاسم agents.new وagents.wizard (بما فيها مفاتيح agents.wizard.knowledge وagents.wizard.test) " +
      "في messages/en.json، وmodules/flows/، وagents/[id]/edit/steps/flows-step.tsx وknowledge-step.tsx " +
      "وtest-step.tsx — 2026-09-11 (تعليقات المراجعة رقم 3)",
  },
};
