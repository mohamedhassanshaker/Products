import type { LocalizedGuideContent } from "./index.js";

/**
 * `/tools` — the platform-wide tool estate (B5). Written directly against `tools/page.tsx`
 * and `messages/en.json`'s real `tools` namespace (four real tabs).
 */
export const tools: LocalizedGuideContent = {
  en: {
    title: "Tools & MCP registry",
    purpose:
      "The estate-wide view of every skill, MCP server, API connector and circuit breaker " +
      'this entity has registered — the same catalogue the agent wizard\'s "Skills & tools" ' +
      "step reads and writes. This screen is read-mostly for bindings: attaching a tool to a " +
      "*specific* agent version happens in that agent's own wizard, not here.",
    featureWalkthrough: [
      {
        heading: "Skills catalogue tab",
        body:
          "Every skill (Native, API connector-backed, or MCP tool-backed), with a count of " +
          'how many agent versions across the whole estate have it attached. "Add native ' +
          'skill" defines a new one with a JSON input/output schema. A skill still bound by ' +
          "any agent version cannot be deleted until it's unbound in the wizard first.",
      },
      {
        heading: "MCP servers tab",
        body:
          "Registered MCP servers with their endpoint, transport, authentication mode and " +
          'live connection state. "Connect & discover" attempts a real handshake and lists ' +
          "every tool the server advertises; a failure is shown with a specific reason (DNS, " +
          "TLS, auth, timeout, protocol, or an empty result) rather than a generic error.",
      },
      {
        heading: "API connectors tab",
        body:
          "Registered outbound API connectors — method, URL template, auth mode, test state. " +
          "Every connector also appears automatically in the Skills catalogue as a paired, " +
          'read-only skill (that pairing is what an agent actually calls). "Test connection" ' +
          "is a real, visible action on this screen even where the underlying outbound call " +
          "isn't wired up in every environment.",
      },
      {
        heading: "Resilience & fallbacks tab",
        body:
          "The circuit breaker for every API connector, MCP server and internal dependency: " +
          "its trip threshold, cooldown, fallback strategy (apologise and offer a live agent, " +
          "serve a cached answer, queue and retry, or fail closed) and current state (Closed / " +
          'Half-open / Open). "Trip manually" is a deliberate test action; "Reset" closes ' +
          "an open breaker by hand.",
      },
    ],
    howTo: [
      {
        title: "Register a new MCP server and see what it offers",
        steps: [
          'Open the MCP servers tab and select "Register MCP server".',
          "Fill in its endpoint, transport and authentication.",
          'Select "Connect & discover" — its tools appear listed once discovery succeeds.',
        ],
      },
      {
        title: "Attach a discovered tool to a specific agent",
        steps: [
          "Confirm the tool is discovered here (MCP servers tab) or registered (Skills or API " +
            "connectors tab).",
          'Open that agent\'s own wizard, go to "Skills & tools", and Attach it there — ' +
            "attaching is a per-agent-version decision made in the wizard, not on this screen.",
        ],
      },
      {
        title: "See why a dependency is degraded, and fix it",
        steps: [
          "Open the Resilience & fallbacks tab.",
          'Find the service showing "Open — fallback active".',
          'Investigate the underlying dependency, then select "Reset breaker" once it\'s ' +
            "healthy again.",
        ],
      },
    ],
    permissionsNote:
      "The whole screen is gated on the same permission the agent wizard's tools step uses " +
      '("manage agents") rather than a separate tools-specific permission — an Agent ' +
      "Designer registering a connector or resetting a breaker is not releasing anything to " +
      "citizens, so it does not need the publish-level permission.",
    lastVerifiedAgainst:
      "apps/web/src/app/[locale]/(backoffice)/tools/page.tsx, messages/en.json's tools namespace — 2026-09-10",
  },
  ar: {
    title: "الأدوات وسجل MCP",
    purpose:
      "نظرة على مستوى المؤسسة لكل مهارة وخادم MCP وموصل API وقاطع دائرة سجّلته هذه الجهة — " +
      'نفس الكتالوج الذي تقرأه وتكتبه خطوة "المهارات والأدوات" في معالج الوكيل. هذه الشاشة ' +
      "للعرض غالبًا فيما يخص الربط: إرفاق أداة بإصدار وكيل *محدد* يتم في معالج ذلك الوكيل، " +
      "لا هنا.",
    featureWalkthrough: [
      {
        heading: "تبويب كتالوج المهارات",
        body:
          "كل مهارة (أصلية، أو مدعومة بموصل API، أو مدعومة بأداة MCP)، مع عدد إصدارات " +
          'الوكلاء عبر المؤسسة كلها التي أرفقتها. ينشئ "إضافة مهارة أصلية" مهارة جديدة ' +
          "بمخطط JSON للمدخلات والمخرجات. لا يمكن حذف مهارة ما زالت مرتبطة بأي إصدار وكيل " +
          "حتى تُفصل في المعالج أولًا.",
      },
      {
        heading: "تبويب خوادم MCP",
        body:
          "خوادم MCP المسجّلة مع نقطة نهايتها ونقل بياناتها ونمط مصادقتها وحالة اتصالها " +
          'الحية. يحاول "الاتصال والاكتشاف" مصافحة حقيقية ويسرد كل أداة يعلنها الخادم؛ ' +
          "ويُعرض الفشل بسبب محدد (DNS، TLS، مصادقة، مهلة، بروتوكول، أو نتيجة فارغة) بدل خطأ " +
          "عام.",
      },
      {
        heading: "تبويب موصلات API",
        body:
          "موصلات API الصادرة المسجّلة — الطريقة، قالب الرابط، نمط المصادقة، حالة الاختبار. " +
          "يظهر كل موصل أيضًا تلقائيًا في كتالوج المهارات كمهارة مقترنة للقراءة فقط (هذا " +
          'الاقتران هو ما يستدعيه الوكيل فعليًا). "اختبار الاتصال" إجراء حقيقي ومرئي في ' +
          "هذه الشاشة حتى في البيئات التي لا يُفعَّل فيها الاستدعاء الصادر الفعلي.",
      },
      {
        heading: "تبويب المرونة والبدائل",
        body:
          "قاطع الدائرة لكل موصل API وخادم MCP واعتماد داخلي: حد قطعه، فترة تهدئته، استراتيجية " +
          "بديله (اعتذار وعرض وكيل بشري، تقديم إجابة مخزّنة، انتظار وإعادة محاولة، أو الفشل " +
          'المغلق) وحالته الحالية (مغلق / نصف مفتوح / مفتوح). "القطع يدويًا" إجراء اختبار ' +
          'متعمد؛ و"إعادة الضبط" يغلق قاطعًا مفتوحًا يدويًا.',
      },
    ],
    howTo: [
      {
        title: "تسجيل خادم MCP جديد ورؤية ما يقدّمه",
        steps: [
          'افتح تبويب خوادم MCP واختر "تسجيل خادم MCP".',
          "أدخل نقطة نهايته ونقل بياناته ومصادقته.",
          'اختر "الاتصال والاكتشاف" — تظهر أدواته مسرودة بمجرد نجاح الاكتشاف.',
        ],
      },
      {
        title: "إرفاق أداة مكتشَفة بوكيل محدد",
        steps: [
          "تأكد أن الأداة مكتشَفة هنا (تبويب خوادم MCP) أو مسجّلة (تبويب المهارات أو موصلات " +
            "API).",
          'افتح معالج ذلك الوكيل نفسه، اذهب إلى "المهارات والأدوات"، وأرفقها هناك — الإرفاق ' +
            "قرار لكل إصدار وكيل يُتخذ في المعالج، لا في هذه الشاشة.",
        ],
      },
      {
        title: "معرفة سبب تدهور اعتماد ما وإصلاحه",
        steps: [
          "افتح تبويب المرونة والبدائل.",
          'ابحث عن الخدمة التي تظهر "مفتوح — البديل مفعّل".',
          'تحقق من الاعتماد الأساسي، ثم اختر "إعادة ضبط القاطع" بمجرد عودته لحالة سليمة.',
        ],
      },
    ],
    permissionsNote:
      'تخضع الشاشة بأكملها لنفس صلاحية خطوة أدوات معالج الوكيل ("إدارة الوكلاء") لا صلاحية ' +
      "خاصة بالأدوات — فتسجيل موصل أو إعادة ضبط قاطع من قِبل مصمم وكلاء لا يُصدر شيئًا " +
      "للمواطنين، فلا يحتاج صلاحية مستوى النشر.",
    lastVerifiedAgainst:
      "apps/web/src/app/[locale]/(backoffice)/tools/page.tsx، مساحة الاسم tools في messages/en.json — 2026-09-10",
  },
};
