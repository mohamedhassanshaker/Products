import type { LocalizedGuideContent } from "./index.js";

/**
 * `/escalations` — B7/B8, handover. Written directly against `messages/en.json`'s real
 * `escalations` namespace (two real tabs).
 */
export const escalations: LocalizedGuideContent = {
  en: {
    title: "Escalations",
    purpose:
      "Where a human agent works the live queue of conversations the assistant handed off, " +
      "and where routing rules decide which team a new escalation lands with.",
    featureWalkthrough: [
      {
        heading: "Escalation queue tab",
        body:
          "A live queue table (topic, channel, waiting time, priority, status) beside your " +
          "own agent-presence status (Available/Busy/Offline). Selecting a ticket shows its " +
          "full transcript, the citizen's verification state (verified via a named provider, " +
          "or unverified), any pending slot the conversation was mid-way through, and canned " +
          "replies that populate the composer rather than sending immediately — you still " +
          "review and send. Release, Abandon and Resolve are the ticket's own lifecycle " +
          "actions.",
      },
      {
        heading: "Routing rules tab",
        body:
          "An ordered list of rules — order is meaning: the first active rule whose condition " +
          "matches wins. Each rule can route to a specific team or requeue, and can alert a " +
          "supervisor. Rules can be reordered, added, edited, enabled/disabled or deleted; " +
          'reordering shows unsaved changes distinctly until "Save order" is pressed. The ' +
          "rule tester evaluates a hypothetical ticket (topic, priority, channel, wait time) " +
          "against the **live**, currently-displayed rule order — including any unsaved " +
          "reorder — and states plainly which rule fired, or that nothing matched and the " +
          "ticket falls to the default queue.",
      },
    ],
    howTo: [
      {
        title: "Handle a waiting ticket",
        steps: [
          "Open the Escalation queue tab and select a waiting ticket.",
          "Read its transcript, verification state and any pending slot for context.",
          "Select a canned reply if one fits (it fills the composer, not sent yet), edit as " +
            "needed, and send.",
          "Select Resolve once the citizen's issue is handled.",
        ],
      },
      {
        title: "Check what a rule reorder will actually do before saving it",
        steps: [
          "Open the Routing rules tab and drag/reorder the rules.",
          "Fill in the rule tester's test-ticket fields (topic, priority, channel, wait time).",
          'Select "Run test" — it evaluates against the order currently on screen, unsaved ' +
            "changes included, and names which rule fired.",
          'Select "Save order" once satisfied, or "Discard changes" to revert.',
        ],
      },
    ],
    permissionsNote:
      "Working the queue and managing routing rules are gated by separate permissions — a " +
      "role missing either sees a plain permission-denied message for this whole screen, so a " +
      "human agent without rule-management rights can still work tickets, and vice versa.",
    lastVerifiedAgainst: "messages/en.json's escalations namespace — 2026-09-10",
  },
  ar: {
    title: "التصعيدات",
    purpose:
      "المكان الذي يعمل فيه الوكيل البشري على قائمة الانتظار الحية للمحادثات التي حوّلها " +
      "المساعد، وحيث تقرر قواعد التوجيه أي فريق يستلم تصعيدًا جديدًا.",
    featureWalkthrough: [
      {
        heading: "تبويب قائمة انتظار التصعيد",
        body:
          "جدول قائمة انتظار حي (الموضوع، القناة، وقت الانتظار، الأولوية، الحالة) بجانب حالة " +
          "حضورك كوكيل (متاح/مشغول/غير متصل). يعرض اختيار تذكرة نصها الكامل، وحالة توثيق " +
          "المواطن (موثّق عبر مزوّد مسمّى، أو غير موثّق)، وأي خانة معلّقة كانت المحادثة في " +
          "منتصفها، وردودًا جاهزة تملأ صندوق الكتابة بدل الإرسال الفوري — فتراجع وترسل بنفسك. " +
          "الإطلاق والتخلي والحل إجراءات دورة حياة التذكرة نفسها.",
      },
      {
        heading: "تبويب قواعد التوجيه",
        body:
          "قائمة مرتّبة من القواعد — الترتيب هو المعنى: تفوز أول قاعدة نشطة يطابق شرطها. " +
          "يمكن لكل قاعدة التوجيه إلى فريق محدد أو إعادة الطابور، وتنبيه مشرف. يمكن إعادة " +
          "ترتيب القواعد وإضافتها وتعديلها وتفعيلها/تعطيلها وحذفها؛ وتُظهر إعادة الترتيب " +
          'تغييرات غير محفوظة بوضوح حتى يُضغط "حفظ الترتيب". يقيّم مختبر القواعد تذكرة ' +
          "افتراضية (الموضوع، الأولوية، القناة، وقت الانتظار) مقابل ترتيب القواعد **الحي** " +
          "المعروض حاليًا — بما في ذلك أي إعادة ترتيب غير محفوظة — ويذكر بوضوح أي قاعدة " +
          "أُطلقت، أو أن لا شيء طابق فسقطت التذكرة إلى الطابور الافتراضي.",
      },
    ],
    howTo: [
      {
        title: "معالجة تذكرة منتظِرة",
        steps: [
          "افتح تبويب قائمة انتظار التصعيد واختر تذكرة منتظِرة.",
          "اقرأ نصها وحالة توثيقها وأي خانة معلّقة للسياق.",
          "اختر ردًا جاهزًا إن ناسب (يملأ صندوق الكتابة، لا يُرسل بعد)، عدّله عند الحاجة، " +
            "وأرسِل.",
          "اختر حل بمجرد معالجة قضية المواطن.",
        ],
      },
      {
        title: "التحقق مما ستفعله إعادة ترتيب قاعدة فعليًا قبل حفظها",
        steps: [
          "افتح تبويب قواعد التوجيه وأعد ترتيب القواعد بالسحب.",
          "املأ حقول تذكرة الاختبار في المختبر (الموضوع، الأولوية، القناة، وقت الانتظار).",
          'اختر "تشغيل الاختبار" — يُقيَّم مقابل الترتيب المعروض حاليًا، بما فيه التغييرات ' +
            "غير المحفوظة، ويذكر أي قاعدة أُطلقت.",
          'اختر "حفظ الترتيب" عند الرضا، أو "تجاهل التغييرات" للتراجع.',
        ],
      },
    ],
    permissionsNote:
      "العمل على قائمة الانتظار وإدارة قواعد التوجيه محكومان بصلاحيتين منفصلتين — فالدور " +
      "الذي يفتقد إحداهما يرى رسالة رفض صلاحية واضحة لهذه الشاشة بأكملها، بحيث يمكن لوكيل " +
      "بشري بلا صلاحية إدارة القواعد أن يعالج التذاكر مع ذلك، والعكس صحيح.",
    lastVerifiedAgainst: "مساحة الاسم escalations في messages/en.json — 2026-09-10",
  },
};
