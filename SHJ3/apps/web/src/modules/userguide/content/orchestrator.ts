import type { LocalizedGuideContent } from "./index.js";

/**
 * `/orchestrator` — B4, the router/orchestrator configuration + observability screen.
 * Written directly against the real `RouterConfigs` singleton and real
 * `OrchestrationTraces`/`OrchestrationTraceSteps` rows this page reads and writes — see
 * `orchestrator/page.tsx`'s own doc comment for the real backend it surfaces.
 *
 * Updated 2026-09-15: this screen used to be entirely read-only. It now lets an admin
 * really edit execution mode, agent-combination scope, ceilings and merge/conflict policy
 * (`updateRouterConfigAction`), and run a live, no-cost, no-persistence "test a prompt"
 * simulator against the saved configuration (`previewTraceAction`) — see this screen's own
 * `page.tsx` doc comment for exactly what changed and why, including the real
 * `agentSelectionScope: "ExplicitList"` routing bug this wave fixed on the `apps/ai` side
 * first (`filter_candidates_by_scope`, `domain/orchestration.py`) so the new "combine
 * agents" control would not be UI wired to nothing.
 */
export const orchestrator: LocalizedGuideContent = {
  en: {
    title: "Orchestrator / router",
    purpose:
      "Design and edit how one citizen prompt is actually served by the agent runtime: " +
      "which execution mode the tenant uses, which agents can be combined into the " +
      "pipeline, the real routing pipeline shape, a live no-cost simulator to test a " +
      "prompt against the saved configuration, and a step-by-step replay of any real, " +
      "already-processed conversation turn.",
    featureWalkthrough: [
      {
        heading: "Execution modes",
        body:
          "Three buttons — Sequential, Parallel, Supervisor–worker — switch which mode's " +
          "explanation is shown; this is separate from the Execution mode field in the " +
          'configuration form below it. The mode currently badged "Active" is the ' +
          "tenant's real, currently-saved setting.",
      },
      {
        heading: "Router configuration form",
        body:
          "A real, editable form for the tenant's `RouterConfigs` singleton: execution " +
          "mode, routing strategy, agent selection scope, conflict resolution, response " +
          "merge policy, fallback agent, max hops, max loop iterations, both cost " +
          "ceilings (tokens and micro-AED), and minimum routing confidence. Selecting " +
          '"Explicit list" as the agent selection scope reveals a checklist of published ' +
          "agents — check the ones this pipeline should combine, and only those agents " +
          "are considered as secondary agents for Parallel/Supervisor–worker turns (this " +
          "used to be silently ignored; it is now real). \"Channel-bound\" is accepted " +
          "and saved but not yet enforced by the router — every published agent is still " +
          "considered, same as \"All published agents\", until that scope is implemented. " +
          "The fallback agent field is likewise saved but not yet invoked by any real " +
          "pipeline behaviour — both limitations are stated directly in the field's own " +
          "help text, not hidden. Saving re-validates every real database constraint " +
          "(e.g. max hops 1–10, Supervisor–worker requiring at least 3 max hops, an " +
          "overlap-resolving merge policy for Parallel/Supervisor–worker) and shows a " +
          "specific error if any rule fails.",
      },
      {
        heading: "Test a prompt (live simulator)",
        body:
          "Pick a primary agent, type a sample prompt, and select Preview to run it " +
          "through the real `ProcessTurn` pipeline against the tenant's currently-*saved* " +
          "router configuration above — save your changes first if you want to preview " +
          "them. No conversation is persisted and no real model spend occurs regardless " +
          "of whether the tenant has a real API key configured; the result banner says so " +
          "plainly. The result renders through the same routing pipeline diagram used for " +
          "real traces below, so a Parallel or Supervisor–worker preview against an " +
          "\"Explicit list\" scoped configuration visibly shows only the selected agents " +
          "as branches — the concrete way to see the agent-combination fix in action.",
      },
      {
        heading: "Routing pipeline diagram",
        body:
          "A simple diagram — Prompt, Router, agent branches, Merge, Response — always " +
          "visible. Once you pick a conversation turn below, the agent branches and the " +
          "merge outcome become that real turn's own routed agent(s) and merge policy, " +
          "with each branch's real success/failure status shown as a badge. Running the " +
          "\"Test a prompt\" simulator above renders this same diagram against the " +
          "simulated result instead, without disturbing whatever real turn is selected " +
          "below.",
      },
      {
        heading: "Execution trace",
        body:
          "A table of the tenant's most recent real turns — when it ran, channel, " +
          "execution mode, routed agent, routing confidence, guardrail pre/post result and " +
          "duration. Selecting a row loads that turn's full real trace: the prompt and " +
          "response text, routing confidence, hop count, merge policy applied, grounding " +
          "confidence, token/cost totals, and the complete ordered list of pipeline steps " +
          "— guardrail checks, routing, every agent invoke and tool call, retrieval, and " +
          "the merge step — each with its own status, duration and, where relevant, an " +
          "expandable payload. Real grounding citations appear below the trace when the " +
          "turn used retrieval.",
      },
      {
        heading: "Why every real trace currently shows a Blocked post-check, in THIS environment",
        body:
          "Investigated and root-caused, not a phantom bug: in a development environment " +
          "with no real `SHJ3_OPENAI_API_KEY`/`SHJ3_OPENROUTER_API_KEY` configured, every " +
          "real embedding call automatically falls back to `DeterministicLocalEmbedder` — a " +
          "hash-based vector with no semantic relationship to the text's meaning (a real " +
          "probe: cosine similarity of a genuinely on-topic chunk measured lower than a " +
          "genuinely unrelated one). Combined with the retrieval blend's own `normalise()` " +
          "helper, whose documented behaviour returns exactly 0.0 for a candidate batch " +
          'whose top raw score is at or below zero ("no signal"), this deterministic ' +
          "fallback very plausibly drives grounding confidence to exactly 0.0 — confirmed " +
          "directly against this environment's real `OrchestrationTraceSteps`/" +
          "`GroundingCitations` rows, every one of which carries `.0000` scores. Two of this " +
          "environment's tenants additionally have little or no real content ever ingested " +
          "into Qdrant/Neo4j at all, which independently drives the same result. None of " +
          "this is a defect in the guardrail/grounding logic itself, which is doing exactly " +
          "what FR-GOV-05 and data-model.md §6.5 specify; it is an honest, structurally " +
          "explainable consequence of running this real pipeline without real credentials " +
          "or a fully-ingested knowledge base. A real API key plus real ingested content " +
          "restores meaningful, non-zero confidence scores. Grounding citations ARE written " +
          "by real code even on a refused turn (proven: this environment already has 165 " +
          "real, trace-linked `GroundingCitations` rows for the `sharjah` tenant) — a tenant " +
          "showing zero citations means retrieval genuinely found no candidate chunks at " +
          "all (an empty Qdrant collection for that tenant), not a missing write path. Full " +
          "investigation trail in `tasks/todo.md`'s dated review entry and " +
          "`tasks/lessons.md`.",
      },
    ],
    howTo: [
      {
        title: "Understand which execution mode is active and why it matters",
        steps: [
          "Open the Orchestrator screen from the sidebar.",
          'Read the badge next to each mode button — exactly one is marked "Active".',
          "Select each of the other two buttons in turn to read what they would mean for " +
            "this tenant's traffic instead.",
        ],
      },
      {
        title: "Combine specific agents into the pipeline",
        steps: [
          'In the router configuration form, set Agent selection scope to "Explicit ' +
            'list".',
          "Check every published agent this pipeline should be allowed to combine — " +
            "these are the only agents considered as secondary agents on top of the " +
            "primary agent for Parallel/Supervisor–worker turns.",
          'Select Save. Saving rejects an empty selection or an agent that is no longer ' +
            "published.",
          'Use "Test a prompt" below to confirm only the selected agents appear as ' +
            "branches in a Parallel or Supervisor–worker preview.",
        ],
      },
      {
        title: "Edit and save the router configuration",
        steps: [
          "Change any field in the router configuration form — execution mode, " +
            "ceilings, merge/conflict policy, fallback agent, and so on.",
          "Select Save.",
          "If a value violates a real constraint (for example, Supervisor–worker with " +
            "fewer than 3 max hops), a specific error explains which rule failed and " +
            "nothing is saved.",
          "On success, the screen reloads with the newly saved values, and the " +
            'Execution modes "Active" badge updates to match.',
        ],
      },
      {
        title: "Preview how a prompt would actually be routed, with no cost",
        steps: [
          'In "Test a prompt", pick a primary agent and type a sample prompt.',
          "Select Preview.",
          "Read the routing pipeline diagram and reply that result — this used the " +
            "tenant's real, currently-saved configuration, but wrote no conversation and " +
            "spent no real money.",
          "Change the router configuration and save it first if you want to preview a " +
            "different configuration's behaviour.",
        ],
      },
      {
        title: "Replay exactly what happened on a real conversation turn",
        steps: [
          "Scroll to the Execution trace table and find the turn you want (sorted newest " +
            "first).",
          "Select its timestamp to load the full trace.",
          "Read the ordered steps top to bottom — each one is a real pipeline stage; " +
            'select "Show payload" on a step to see its real arguments/result.',
          "Check the routing pipeline diagram above the table — it now shows this turn's " +
            "real agent branch(es) and merge outcome.",
        ],
      },
    ],
    permissionsNote:
      "The whole screen is gated on the orchestration:manage permission — a dedicated " +
      "permission introduced when this screen moved from read-only observability to real " +
      "config editing plus the live simulator, held only by SuperAdmin/EntityAdmin. This " +
      "narrowed access from the screen's previous analytics:view gate: a role such as " +
      "Reviewer or Analyst that could view this screen before can no longer see it at " +
      "all. A role without orchestration:manage sees a plain permission-denied message " +
      "for the whole screen.",
    lastVerifiedAgainst:
      "orchestrator/page.tsx, orchestrator-screen.tsx, execution-mode-panel.tsx, " +
      "agent-scope-multi-select.tsx, trace-preview-panel.tsx — 2026-09-15",
  },
  ar: {
    title: "المنسّق / الموجّه",
    purpose:
      "صمّم وحرّر كيفية خدمة سؤال المواطن فعليًا عبر وقت تشغيل الوكلاء: نمط التنفيذ الذي " +
      "يستخدمه المستأجر، الوكلاء التي يمكن دمجها في مسار المعالجة، شكل خط أنابيب التوجيه " +
      "الحقيقي، محاكي حي بلا تكلفة لاختبار سؤال مقابل الإعداد المحفوظ، وإعادة عرض خطوة " +
      "بخطوة لأي دورة محادثة حقيقية سبق معالجتها.",
    featureWalkthrough: [
      {
        heading: "أنماط التنفيذ",
        body:
          "ثلاثة أزرار — متسلسل، متوازٍ، مشرف-عامل — تبدّل أي نمط يُعرض شرحه؛ هذا منفصل عن " +
          'حقل نمط التنفيذ في نموذج الإعداد أدناه. النمط الذي يحمل شارة "نشط" هو الإعداد ' +
          "الحقيقي والمحفوظ حاليًا للمستأجر.",
      },
      {
        heading: "نموذج إعداد الموجّه",
        body:
          "نموذج حقيقي وقابل للتحرير لسجل RouterConfigs الوحيد الخاص بالمستأجر: نمط " +
          "التنفيذ، استراتيجية التوجيه، نطاق اختيار الوكيل، حل التعارض، سياسة دمج " +
          "الاستجابة، الوكيل الاحتياطي، الحد الأقصى للقفزات، الحد الأقصى لتكرارات " +
          "الحلقة، سقفا التكلفة (الرموز والميكرو درهم)، والحد الأدنى لثقة التوجيه. اختيار " +
          '"قائمة صريحة" كنطاق اختيار الوكيل يُظهر قائمة تحقق بالوكلاء المنشورين — حدّد ' +
          "الوكلاء الذين ينبغي لهذا المسار دمجهم، ولا يُعتبر إلا هؤلاء الوكلاء وكلاء " +
          "ثانويين لدورات التنفيذ المتوازي/المشرف-العامل (كان هذا يُتجاهل بصمت من قبل؛ " +
          'أصبح الآن حقيقيًا). "مرتبط بالقناة" مقبول ومحفوظ لكنه لم يُطبَّق بعد من قِبل ' +
          'الموجّه — لا يزال جميع الوكلاء المنشورين يُعتبرون، كما في "جميع الوكلاء ' +
          "المنشورين\"، إلى أن يُنفَّذ هذا النطاق. كذلك حقل الوكيل الاحتياطي محفوظ لكنه " +
          "لا يُستدعى بعد من قِبل أي سلوك حقيقي في مسار المعالجة — كلا القيدين مذكوران " +
          "صراحة في النص المساعد للحقل نفسه، لا مخفيان. يعيد الحفظ التحقق من كل قيد " +
          "حقيقي في قاعدة البيانات (مثل الحد الأقصى للقفزات بين 1 و10، واشتراط نمط " +
          "المشرف-العامل 3 قفزات على الأقل، وسياسة دمج تعالج التداخل للنمطين المتوازي " +
          "والمشرف-العامل) ويعرض خطأ محددًا إذا فشلت أي قاعدة.",
      },
      {
        heading: "اختبار سؤال (محاكاة حية)",
        body:
          "اختر وكيلاً أساسيًا، اكتب سؤالاً تجريبيًا، واختر معاينة لتشغيله عبر خط أنابيب " +
          "ProcessTurn الحقيقي مقابل إعداد الموجّه المحفوظ حاليًا أعلاه — احفظ تغييراتك " +
          "أولاً إذا أردت معاينتها. لا تُحفظ أي محادثة ولا يحدث أي إنفاق حقيقي على " +
          "النموذج بصرف النظر عمّا إذا كان المستأجر يملك مفتاح API حقيقيًا، ويوضّح شريط " +
          "النتيجة ذلك صراحة. تُعرض النتيجة عبر مخطط خط أنابيب التوجيه نفسه المستخدم " +
          "للآثار الحقيقية أدناه، بحيث تُظهر معاينة متوازية أو مشرف-عامل مقابل إعداد " +
          '"قائمة صريحة" بوضوح الوكلاء المحدَّدين فقط كفروع — الطريقة الملموسة لرؤية ' +
          "إصلاح دمج الوكلاء أثناء عمله.",
      },
      {
        heading: "مخطط خط أنابيب التوجيه",
        body:
          "مخطط بسيط — سؤال، موجّه، فروع الوكلاء، دمج، استجابة — يظهر دائمًا. بمجرد اختيار " +
          "دورة محادثة أدناه، تصبح فروع الوكلاء ونتيجة الدمج هي الوكيل (الوكلاء) الفعليين " +
          "لتلك الدورة الحقيقية وسياسة الدمج، مع عرض حالة النجاح/الفشل الحقيقية لكل فرع " +
          'كشارة. يعرض تشغيل "اختبار سؤال" أعلاه هذا المخطط نفسه مقابل النتيجة المحاكاة ' +
          "بدلاً من ذلك، دون التأثير على أي دورة حقيقية محدَّدة أدناه.",
      },
      {
        heading: "أثر التنفيذ",
        body:
          "جدول بأحدث الدورات الحقيقية للمستأجر — وقت التشغيل، القناة، نمط التنفيذ، " +
          "الوكيل الموجَّه إليه، ثقة التوجيه، نتيجة الحارس قبل/بعد، والمدة. يؤدي اختيار " +
          "صف إلى تحميل الأثر الكامل والحقيقي لتلك الدورة: نص السؤال والاستجابة، ثقة " +
          "التوجيه، عدد القفزات، سياسة الدمج المطبَّقة، ثقة الإسناد، إجماليات الرموز " +
          "والتكلفة، والقائمة الكاملة المرتَّبة لخطوات خط الأنابيب — فحوصات الحارس، " +
          "التوجيه، كل استدعاء وكيل واستدعاء أداة، الاسترجاع، وخطوة الدمج — لكل منها حالتها " +
          "ومدتها، وحيثما كان ذا صلة، حمولة قابلة للتوسيع. تظهر استشهادات الإسناد الحقيقية " +
          "أسفل الأثر عندما استخدمت الدورة الاسترجاع.",
      },
      {
        heading: "لماذا تُظهر كل دورة حقيقية حاليًا نتيجة فحص لاحق مرفوضة، في هذه البيئة تحديدًا",
        body:
          "تم التحقيق في هذا وتحديد سببه الجذري، وليس خللاً وهميًا: في بيئة تطوير لا تحمل " +
          "مفتاح `SHJ3_OPENAI_API_KEY`/`SHJ3_OPENROUTER_API_KEY` حقيقيًا، يتحول كل نداء " +
          "تضمين حقيقي تلقائيًا إلى `DeterministicLocalEmbedder` — متجه قائم على التجزئة " +
          "لا علاقة دلالية له بمعنى النص (تحقّق مباشر: تشابه جيب التمام لمقطع ذي صلة " +
          "فعلية جاء أقل من تشابه مقطع غير ذي صلة إطلاقًا). وبالاقتران مع دالة " +
          "`normalise()` في مزيج الاسترجاع، التي يوثَّق سلوكها بإرجاع 0.0 تمامًا لمجموعة " +
          'مرشحين تكون أعلى نتيجة خام فيها صفرًا أو أقل ("لا إشارة")، فإن هذا البديل ' +
          "الحتمي يدفع بشكل معقول جدًا ثقة الإسناد إلى 0.0 تمامًا — وهذا مؤكَّد مباشرة عبر " +
          "صفوف `OrchestrationTraceSteps`/`GroundingCitations` الحقيقية لهذه البيئة، التي " +
          "تحمل جميعها درجات `.0000`. كما أن اثنين من مستأجري هذه البيئة لديهما محتوى " +
          "حقيقي ضئيل أو معدوم أُدرِج فعليًا في Qdrant/Neo4j، ما يؤدي إلى النتيجة نفسها " +
          "بشكل مستقل. لا شيء من هذا خلل في منطق الحارس/الإسناد نفسه، الذي يقوم بالضبط " +
          "بما تحدده FR-GOV-05 وdata-model.md §6.5؛ إنه نتيجة صادقة وقابلة للتفسير بنيويًا " +
          "لتشغيل خط الأنابيب الحقيقي هذا دون بيانات اعتماد حقيقية أو قاعدة معرفة مُدرَجة " +
          "بالكامل. مفتاح API حقيقي مع محتوى حقيقي مُدرَج يعيد درجات ثقة ذات معنى وغير " +
          "صفرية. تُكتَب استشهادات الإسناد فعليًا بواسطة كود حقيقي حتى في دورة مرفوضة " +
          "(مؤكَّد: تحمل هذه البيئة بالفعل 165 صف `GroundingCitations` حقيقيًا ومرتبطًا " +
          "بأثر لمستأجر `sharjah`) — ومستأجر لا يُظهر أي استشهادات يعني أن الاسترجاع لم " +
          "يجد فعليًا أي مقطع مرشَّح على الإطلاق (مجموعة Qdrant فارغة لذلك المستأجر)، لا " +
          "مسار كتابة مفقودًا. مسار التحقيق الكامل في مُدخَل المراجعة المؤرَّخ في " +
          "`tasks/todo.md` وفي `tasks/lessons.md`.",
      },
    ],
    howTo: [
      {
        title: "فهم نمط التنفيذ النشط ولماذا يهم",
        steps: [
          "افتح شاشة المنسّق من الشريط الجانبي.",
          'اقرأ الشارة بجانب كل زر نمط — واحد فقط يحمل علامة "نشط".',
          "اختر كل زر من الزرين الآخرين بدوره لقراءة ما كان سيعنيه لحركة هذا المستأجر بدلاً " +
            "من ذلك.",
        ],
      },
      {
        title: "دمج وكلاء محدَّدين في مسار المعالجة",
        steps: [
          'في نموذج إعداد الموجّه، اضبط نطاق اختيار الوكيل على "قائمة صريحة".',
          "حدّد كل وكيل منشور ينبغي السماح لهذا المسار بدمجه — هؤلاء هم الوكلاء الوحيدون " +
            "الذين يُعتبرون وكلاء ثانويين إضافة إلى الوكيل الأساسي لدورات التنفيذ " +
            "المتوازي/المشرف-العامل.",
          "اختر حفظ. يرفض الحفظ تحديدًا فارغًا أو وكيلاً لم يعد منشورًا.",
          'استخدم "اختبار سؤال" أدناه للتأكد من أن الوكلاء المحدَّدين فقط يظهرون كفروع ' +
            "في معاينة متوازية أو مشرف-عامل.",
        ],
      },
      {
        title: "تحرير إعداد الموجّه وحفظه",
        steps: [
          "غيّر أي حقل في نموذج إعداد الموجّه — نمط التنفيذ، السقوف، سياسة الدمج/" +
            "التعارض، الوكيل الاحتياطي، وما إلى ذلك.",
          "اختر حفظ.",
          "إذا انتهكت قيمة قيدًا حقيقيًا (مثلاً نمط المشرف-العامل بأقل من 3 قفزات كحد " +
            "أقصى)، يوضّح خطأ محدَّد أي قاعدة فشلت ولا يُحفظ شيء.",
          'عند النجاح، تُعاد تحميل الشاشة بالقيم المحفوظة حديثًا، وتتحدّث شارة "نشط" في ' +
            "أنماط التنفيذ لتطابقها.",
        ],
      },
      {
        title: "معاينة كيفية توجيه سؤال فعليًا، بلا أي تكلفة",
        steps: [
          'في "اختبار سؤال"، اختر وكيلاً أساسيًا واكتب سؤالاً تجريبيًا.',
          "اختر معاينة.",
          "اقرأ مخطط خط أنابيب التوجيه ونص الرد الناتج — استخدم هذا إعداد المستأجر " +
            "الحقيقي والمحفوظ حاليًا، لكنه لم يكتب أي محادثة ولم ينفق أي مال حقيقي.",
          "غيّر إعداد الموجّه واحفظه أولاً إذا أردت معاينة سلوك إعداد مختلف.",
        ],
      },
      {
        title: "إعادة عرض ما حدث بالضبط في دورة محادثة حقيقية",
        steps: [
          "مرّر إلى جدول أثر التنفيذ وابحث عن الدورة المطلوبة (مرتّبة الأحدث أولاً).",
          "اختر طابعها الزمني لتحميل الأثر الكامل.",
          'اقرأ الخطوات المرتّبة من الأعلى للأسفل — كل خطوة مرحلة حقيقية؛ اختر "إظهار ' +
            'الحمولة" على أي خطوة لرؤية وسائطها/نتيجتها الحقيقية.',
          "تحقق من مخطط خط أنابيب التوجيه أعلى الجدول — يعرض الآن فرع (فروع) الوكيل " +
            "الحقيقي ونتيجة الدمج لهذه الدورة.",
        ],
      },
    ],
    permissionsNote:
      "الشاشة بأكملها محكومة بصلاحية orchestration:manage — صلاحية مخصَّصة أُضيفت عندما " +
      "انتقلت هذه الشاشة من مراقبة للقراءة فقط إلى تحرير إعداد حقيقي إضافة إلى المحاكي " +
      "الحي، ولا يملكها سوى SuperAdmin/EntityAdmin. أدى هذا إلى تضييق الوصول عن صلاحية " +
      "analytics:view التي كانت تحكم الشاشة سابقًا: دور مثل Reviewer أو Analyst كان " +
      "يستطيع رؤية هذه الشاشة من قبل لم يعد يستطيع رؤيتها إطلاقًا. الدور الذي لا يملك " +
      "orchestration:manage يرى رسالة رفض صلاحية واضحة للشاشة بأكملها.",
    lastVerifiedAgainst:
      "orchestrator/page.tsx, orchestrator-screen.tsx, execution-mode-panel.tsx, " +
      "agent-scope-multi-select.tsx, trace-preview-panel.tsx — 2026-09-15",
  },
};
