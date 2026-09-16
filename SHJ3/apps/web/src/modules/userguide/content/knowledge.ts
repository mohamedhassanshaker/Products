import type { LocalizedGuideContent } from "./index.js";

/**
 * `/knowledge` — Knowledge / Graph RAG (B4, the brief's heaviest, mandated slice). Written
 * directly against `messages/en.json`'s real `knowledge` namespace (four real tabs).
 */
export const knowledge: LocalizedGuideContent = {
  en: {
    title: "Knowledge / Graph RAG",
    purpose:
      "Manages everything the assistant grounds its answers in: source documents, the " +
      "entity graph (Services, Providers, Fees, Documents, Channels), retrieval tuning, and " +
      "conflicts between sources that disagree with each other.",
    featureWalkthrough: [
      {
        heading: "Sources tab",
        body:
          "Every knowledge source, its type (Document, URL crawler, Database, SharePoint, " +
          "API feed), crawl schedule, indexed percentage and status. Pasted/uploaded " +
          "Document text is chunked and indexed for real, immediately. The other four source " +
          "types are real, persisted, schedulable rows today but their fetch mechanics are a " +
          "later wave — they stay at 0% indexed honestly rather than faking progress. " +
          '"Re-crawl now" is wired for Document sources only for the same reason. Removing ' +
          "a source deletes its chunks and any graph entities supported only by it.",
      },
      {
        heading: "Entity graph tab",
        body:
          "A live health check up top (labelled-but-wrong-property / property-but-no-label / " +
          "cross-tenant-edge counts — all should read zero) followed by a searchable explorer " +
          'of every entity, its type and its relationships. "Detect duplicates" scans the ' +
          "current entity type and lists similarity-scored candidate pairs, each resolvable " +
          'with Merge (irreversible) or Ignore. "Add node" creates a new entity by hand, ' +
          "optionally under a parent.",
      },
      {
        heading: "Retrieval tab",
        body:
          "Chunk size/overlap, embedding model and dimension, top-K, rerank candidate count, " +
          "graph/vector weighting (defaults to 60/40) and whether the reranker is enabled. " +
          "Changing the embedding model or its dimension always queues a **full** re-index — " +
          "vectors from two different models can never coexist in one collection, so nothing " +
          "is retrievable from the old model afterward. Below that, a retrieval playground " +
          "runs a live query and returns both ranked passages and the matched subgraph, " +
          "flagging any degradation (e.g. the graph store being unavailable, or the reranker " +
          "having failed over to unreranked results). A job-history table tracks every " +
          "re-index, queued or running or complete.",
      },
      {
        heading: "Conflicts tab",
        body:
          "Topics where two sources disagree, each conflict showing both sides with their " +
          "source and last-updated date. A default automatic policy (prefer most recently " +
          "updated / prefer the owning entity's source / always ask an admin) applies unless " +
          'a human resolves a specific conflict with "Make authoritative" on one side — ' +
          "which is always allowed regardless of the default policy. An unresolved conflict " +
          "lowers grounding confidence on any answer that touches it.",
      },
    ],
    howTo: [
      {
        title: "Add a new document source",
        steps: [
          'Open the Sources tab and select "Add source".',
          'Choose "Document" as the type, paste or upload the text, and save — it is ' +
            "chunked and indexed immediately.",
        ],
      },
      {
        title: "Merge two entities that are really the same thing",
        steps: [
          "Open the Entity graph tab.",
          'Select "Detect duplicates" for the relevant entity type.',
          "Review a candidate pair and select Merge if they really are duplicates, or Ignore " +
            "if not — merging cannot be undone.",
        ],
      },
      {
        title: "Change the embedding model safely",
        steps: [
          "Open the Retrieval tab and change the embedding model or dimension.",
          "Confirm the warning explaining this queues a full re-index of every source.",
          "Watch the job in the job-history table until it completes before trusting new " +
            "retrieval results.",
        ],
      },
      {
        title: "Resolve a source conflict",
        steps: [
          "Open the Conflicts tab and find the open conflict.",
          "Compare Side A and Side B, including which source and when each was last updated.",
          'Select "Make authoritative" on the correct side.',
        ],
      },
    ],
    permissionsNote:
      "The whole screen requires the Knowledge Manager role — anyone without it sees a " +
      "plain permission-denied message instead of any tab.",
    lastVerifiedAgainst: "messages/en.json's knowledge namespace — 2026-09-10",
  },
  ar: {
    title: "المعرفة / الرسم البياني للاسترجاع المعزز",
    purpose:
      "تدير كل ما يستند إليه المساعد في إجاباته: المستندات المصدرية، رسم الكيانات البياني " +
      "(الخدمات، مقدمو الخدمة، الرسوم، المستندات، القنوات)، ضبط الاسترجاع، والتعارضات بين " +
      "مصادر تتناقض مع بعضها.",
    featureWalkthrough: [
      {
        heading: "تبويب المصادر",
        body:
          "كل مصدر معرفة، ونوعه (مستند، زاحف روابط، قاعدة بيانات، SharePoint، تغذية API)، " +
          "وجدول زحفه، ونسبة فهرسته، وحالته. يُقطَّع نص المستندات الملصقة/المرفوعة ويُفهرس " +
          "فعليًا وفورًا. أما أنواع المصادر الأربعة الأخرى فهي صفوف حقيقية ومحفوظة وقابلة " +
          "للجدولة اليوم لكن آليات جلبها تأتي في مرحلة لاحقة — تبقى بصدق عند 0% فهرسة بدل " +
          'تزييف التقدم. "إعادة الزحف الآن" مُفعَّل لمصادر المستندات فقط للسبب ذاته. حذف ' +
          "مصدر يحذف مقاطعه وأي كيانات في الرسم البياني تعتمد عليه وحده.",
      },
      {
        heading: "تبويب رسم الكيانات البياني",
        body:
          "فحص صحة حي في الأعلى (أعداد: موسوم-لكن-خاصية-خاطئة / خاصية-بلا-وسم / حواف عبر " +
          "الجهات — يجب أن تكون كلها صفرًا) يتبعه مستكشف قابل للبحث لكل كيان ونوعه وعلاقاته. " +
          'يفحص "كشف التكرارات" نوع الكيان الحالي ويسرد أزواجًا مرشحة بدرجة تشابه، قابلة ' +
          'للحل بالدمج (لا رجعة فيه) أو التجاهل. ينشئ "إضافة عقدة" كيانًا جديدًا يدويًا، ' +
          "اختياريًا تحت كيان أصل.",
      },
      {
        heading: "تبويب الاسترجاع",
        body:
          "حجم المقطع/تداخله، نموذج التضمين وأبعاده، أعلى-K، عدد مرشحي إعادة الترتيب، وزن " +
          "الرسم البياني/المتجهات (الافتراضي 60/40) وتفعيل معيد الترتيب. يؤدي تغيير نموذج " +
          "التضمين أو بعده دائمًا إلى جدولة إعادة فهرسة **كاملة** — لا يمكن لمتجهات نموذجين " +
          "مختلفين التعايش في مجموعة واحدة، فلا يمكن استرجاع أي شيء من النموذج القديم بعد " +
          "ذلك. أسفل ذلك، تشغّل ساحة اختبار الاسترجاع استعلامًا حيًا وتعيد مقاطع مرتبة والرسم " +
          "الفرعي المطابق، مع الإشارة إلى أي تدهور (مثل تعطل مخزن الرسم البياني، أو فشل معيد " +
          "الترتيب وتراجعه إلى نتائج غير مرتّبة). يتتبع جدول سجل المهام كل إعادة فهرسة، سواء " +
          "قيد الانتظار أو قيد التشغيل أو مكتملة.",
      },
      {
        heading: "تبويب التعارضات",
        body:
          "مواضيع يختلف فيها مصدران، ويعرض كل تعارض الجانبين مع مصدر كل منهما وتاريخ آخر " +
          "تحديث. تُطبَّق سياسة تلقائية افتراضية (تفضيل الأحدث تحديثًا / تفضيل مصدر الجهة " +
          'المالكة / سؤال مسؤول دائمًا) ما لم يحل إنسان تعارضًا محددًا عبر "جعله موثوقًا" ' +
          "لأحد الجانبين — وهو مسموح دائمًا بغض النظر عن السياسة الافتراضية. يخفّض التعارض " +
          "غير المحلول ثقة التأصيل لأي إجابة تلامسه.",
      },
    ],
    howTo: [
      {
        title: "إضافة مصدر مستند جديد",
        steps: [
          'افتح تبويب المصادر واختر "إضافة مصدر".',
          'اختر "مستند" كنوع، والصق أو ارفع النص، واحفظ — يُقطَّع ويُفهرس فورًا.',
        ],
      },
      {
        title: "دمج كيانين هما في الحقيقة الشيء نفسه",
        steps: [
          "افتح تبويب رسم الكيانات البياني.",
          'اختر "كشف التكرارات" لنوع الكيان المعني.',
          "راجع زوجًا مرشحًا واختر دمج إن كانا فعلًا مكررين، أو تجاهل إن لم يكونا — لا يمكن " +
            "التراجع عن الدمج.",
        ],
      },
      {
        title: "تغيير نموذج التضمين بأمان",
        steps: [
          "افتح تبويب الاسترجاع وغيّر نموذج التضمين أو بعده.",
          "أكّد التحذير الذي يوضح أن هذا يجدول إعادة فهرسة كاملة لكل مصدر.",
          "راقب المهمة في جدول سجل المهام حتى تكتمل قبل الوثوق بنتائج الاسترجاع الجديدة.",
        ],
      },
      {
        title: "حل تعارض بين مصادر",
        steps: [
          "افتح تبويب التعارضات وابحث عن التعارض المفتوح.",
          "قارن الجانب أ والجانب ب، بما في ذلك مصدر كل منهما وتاريخ آخر تحديث.",
          'اختر "جعله موثوقًا" للجانب الصحيح.',
        ],
      },
    ],
    permissionsNote:
      "تتطلب الشاشة بأكملها دور مدير المعرفة — من لا يملكه يرى رسالة رفض صلاحية واضحة بدل " +
      "أي تبويب.",
    lastVerifiedAgainst: "مساحة الاسم knowledge في messages/en.json — 2026-09-10",
  },
};
