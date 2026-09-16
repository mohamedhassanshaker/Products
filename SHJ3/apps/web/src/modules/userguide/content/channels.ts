import type { LocalizedGuideContent } from "./index.js";

/**
 * `/channels` — B10/B-6. Written directly against `messages/en.json`'s real `channels`
 * namespace (five real tabs).
 */
export const channels: LocalizedGuideContent = {
  en: {
    title: "Channels",
    purpose:
      "Configures every surface a citizen can reach the assistant on — the web widget, " +
      "WhatsApp, proactive campaigns and localization — and the working-hours/handover " +
      "behaviour that decides what happens outside staffed time.",
    featureWalkthrough: [
      {
        heading: "Channels tab",
        body:
          "One row per channel (Web, WhatsApp, mobile app, kiosk/IVR), its bound agent, hours " +
          "(24/7 or working hours) and state (Live/Disabled). Going Live requires a bound " +
          "agent. Out-of-hours behaviour (timezone, UAE public-holiday auto-sync, whether the " +
          "assistant itself stays available 24/7, whether escalation to a human is offered " +
          "outside staffed hours, and the message shown when no agent is available) is " +
          "configured per channel here — with one rule enforced structurally: escalation " +
          "cannot be offered outside hours while the assistant itself is set to refuse " +
          "sessions outside hours.",
      },
      {
        heading: "Web widget studio tab",
        body:
          "Accent colour, launcher position, default state (docked/expanded), disclaimer and " +
          "greeting text, composer placeholder, and a live preview. The allowed-domains list " +
          "is the embeddability guardrail — a domain must be entered as a plain host or a " +
          "single-label wildcard (no scheme, path, IP or bare TLD), and the last domain " +
          "cannot be removed while the channel is Live. The embed snippet is copyable " +
          "directly from this tab.",
      },
      {
        heading: "WhatsApp tab",
        body:
          "Number and WABA id, opt-in requirement, and the real 24-hour session window (a " +
          "read-only note — pinned by Meta's own platform rule, not configurable here): " +
          "free-form replies are allowed for 24 hours after a citizen message, and a template " +
          "message is required to re-open the conversation after that. Templates are listed " +
          'with their approval status (Draft/Pending/Approved/Rejected); "+ Submit new ' +
          'template" records a name and sample body, and only an Approved template can ever ' +
          "actually be sent.",
      },
      {
        heading: "Proactive messaging (campaigns) tab",
        body:
          "Each campaign shows its template, trigger (before a due date, on booking created, " +
          "on payment settled, or manual), audience size, sends this month and state (Blocked " +
          "/ On / Off). A campaign cannot be enabled unless its template is Approved — this " +
          "is enforced, not just advised, and the same is checked again at send time. Quiet " +
          'hours (a configurable window) can block "Send now" entirely if the whole window ' +
          "is currently closed.",
      },
      {
        heading: "Localization tab",
        body:
          "Every supported locale, its voice, direction, translated percentage and whether " +
          "it's the fallback locale (exactly one locale must remain the fallback at all " +
          "times).",
      },
    ],
    howTo: [
      {
        title: "Put the web widget live on a citizen-facing site",
        steps: [
          "Open the Web widget studio tab and configure its colours, greeting and launcher " +
            "position.",
          "Add the site's real domain to the allowed-domains list.",
          "Copy the embed snippet into that site.",
          "Open the Channels tab, bind an agent to the Web channel, and switch it to Live.",
        ],
      },
      {
        title: "Approve a WhatsApp template so a campaign can send it",
        steps: [
          "Open the WhatsApp tab's Templates section and find the pending template.",
          "Select Approve (recording the BSP/Meta template id).",
          "Return to the campaigns tab — any campaign using it can now be switched On.",
        ],
      },
      {
        title: "Send a proactive campaign right now",
        steps: [
          "Open the Proactive messaging tab and find the campaign.",
          "Confirm its state is On (its template must be Approved).",
          'Select "Send now" — the result reports how many were sent, suppressed, or ' +
            "throttled; if quiet hours are fully closed, the send is blocked instead.",
        ],
      },
    ],
    permissionsNote:
      'The whole screen requires the "Manage agents" permission — the same permission the ' +
      "agent wizard uses, since binding a channel to an agent is part of the same authoring " +
      "surface.",
    lastVerifiedAgainst: "messages/en.json's channels namespace — 2026-09-10",
  },
  ar: {
    title: "القنوات",
    purpose:
      "تُعِدّ كل سطح يمكن للمواطن الوصول عبره إلى المساعد — أداة الويب، واتساب، الحملات " +
      "الاستباقية، والتعريب — وسلوك ساعات العمل/التحويل الذي يحدد ما يحدث خارج أوقات العمل.",
    featureWalkthrough: [
      {
        heading: "تبويب القنوات",
        body:
          "صف لكل قناة (الويب، واتساب، تطبيق الجوال، الأكشاك/الرد الصوتي)، ووكيلها المرتبط، " +
          "وساعاتها (24/7 أو ساعات العمل) وحالتها (مباشر/معطّل). يتطلب التفعيل المباشر وكيلًا " +
          "مرتبطًا. يُعدّ سلوك خارج ساعات العمل هنا لكل قناة (المنطقة الزمنية، مزامنة عطلات " +
          "الإمارات الرسمية تلقائيًا، هل يبقى المساعد نفسه متاحًا 24/7، هل يُعرض التحويل إلى " +
          "إنسان خارج ساعات العمل، والرسالة المعروضة عند عدم توفر وكيل) — مع قاعدة واحدة " +
          "مفروضة بنيويًا: لا يمكن عرض التحويل خارج الساعات بينما المساعد نفسه مضبوط على " +
          "رفض الجلسات خارج الساعات.",
      },
      {
        heading: "تبويب استوديو أداة الويب",
        body:
          "لون التمييز، موضع المُطلِق، الحالة الافتراضية (مثبّتة/موسّعة)، نص إخلاء المسؤولية " +
          "والترحيب، النص التوضيحي لصندوق الكتابة، ومعاينة حية. قائمة النطاقات المسموحة هي " +
          "ضمانة إمكانية التضمين — يجب إدخال النطاق كمضيف عادي أو حرف بديل بمقطع واحد (بلا " +
          "بروتوكول أو مسار أو عنوان IP أو نطاق علوي مجرد)، ولا يمكن إزالة آخر نطاق ما دامت " +
          "القناة مباشرة. يمكن نسخ مقتطف التضمين مباشرة من هذا التبويب.",
      },
      {
        heading: "تبويب واتساب",
        body:
          "الرقم ومعرّف WABA، شرط الموافقة المسبقة، ونافذة الجلسة الحقيقية لمدة 24 ساعة " +
          "(ملاحظة للقراءة فقط — مثبّتة بقاعدة منصة Meta نفسها، لا تُضبط هنا): يُسمح بردود " +
          "حرة لمدة 24 ساعة بعد رسالة المواطن، وتُطلب رسالة قالب لإعادة فتح المحادثة بعد " +
          'ذلك. تُسرد القوالب بحالة اعتمادها (مسودة/قيد المراجعة/معتمد/مرفوض)؛ ويسجّل "+ ' +
          'إرسال قالب جديد" اسمًا ونص عينة، ولا يمكن إرسال قالب فعليًا إلا إذا كان معتمدًا.',
      },
      {
        heading: "تبويب المراسلة الاستباقية (الحملات)",
        body:
          "يعرض كل حملة قالبها ومحفزها (قبل تاريخ الاستحقاق، عند إنشاء حجز، عند تسوية دفعة، " +
          "أو يدوي)، وحجم جمهورها، وعدد إرسالاتها هذا الشهر وحالتها (محجوبة/مفعّلة/معطّلة). " +
          "لا يمكن تفعيل حملة ما لم يكن قالبها معتمدًا — وهذا مفروض لا مجرد نصيحة، ويُتحقق " +
          'منه مجددًا عند وقت الإرسال. يمكن لساعات الهدوء (نافذة قابلة للضبط) حجب "الإرسال ' +
          'الآن" كليًا إذا كانت النافذة بأكملها مغلقة حاليًا.',
      },
      {
        heading: "تبويب التعريب",
        body:
          "كل لغة مدعومة، صوتها، اتجاهها، نسبة ترجمتها، وهل هي اللغة الاحتياطية (يجب أن تبقى " +
          "لغة واحدة بالضبط هي الاحتياطية في كل الأوقات).",
      },
    ],
    howTo: [
      {
        title: "تفعيل أداة الويب مباشرة على موقع يواجه المواطنين",
        steps: [
          "افتح تبويب استوديو أداة الويب واضبط ألوانها وترحيبها وموضع مُطلِقها.",
          "أضف النطاق الحقيقي للموقع إلى قائمة النطاقات المسموحة.",
          "انسخ مقتطف التضمين إلى ذلك الموقع.",
          "افتح تبويب القنوات، اربط وكيلًا بقناة الويب، وحوّلها إلى مباشرة.",
        ],
      },
      {
        title: "اعتماد قالب واتساب لتتمكن حملة من إرساله",
        steps: [
          "افتح قسم القوالب في تبويب واتساب وابحث عن القالب المعلّق.",
          "اختر اعتماد (مسجّلًا معرّف قالب BSP/Meta).",
          "ارجع إلى تبويب الحملات — يمكن الآن تفعيل أي حملة تستخدمه.",
        ],
      },
      {
        title: "إرسال حملة استباقية الآن",
        steps: [
          "افتح تبويب المراسلة الاستباقية وابحث عن الحملة.",
          "تأكد أن حالتها مفعّلة (يجب أن يكون قالبها معتمدًا).",
          'اختر "الإرسال الآن" — تُظهر النتيجة عدد المُرسَل والمُثبَّط والمُبطَّأ؛ وإذا كانت ' +
            "ساعات الهدوء مغلقة تمامًا، يُحجب الإرسال بدلًا من ذلك.",
        ],
      },
    ],
    permissionsNote:
      'تخضع الشاشة بأكملها لصلاحية "إدارة الوكلاء" — نفس الصلاحية التي يستخدمها معالج ' +
      "الوكيل، إذ إن ربط قناة بوكيل جزء من نفس سطح التأليف.",
    lastVerifiedAgainst: "مساحة الاسم channels في messages/en.json — 2026-09-10",
  },
};
