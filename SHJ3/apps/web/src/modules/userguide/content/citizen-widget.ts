import type { LocalizedGuideContent } from "./index.js";

/**
 * `/widget` — the citizen-facing assistant surface, deliberately given the lightest entry
 * in this guide (see this wave's Review entry for why: `/help` itself is public, but a
 * citizen using the widget is not the guide's primary audience, and nothing in the brief
 * asks for full parity with the 13 staff-facing entries). Written directly against
 * `messages/en.json`'s real `widget` namespace.
 */
export const citizenWidget: LocalizedGuideContent = {
  en: {
    title: "Using the assistant widget",
    purpose:
      "A short guide for citizens using the chat assistant embedded on a Sharjah government " +
      "service page — how to ask a question, get voice input, see how an answer was sourced, " +
      "and reach a human if needed.",
    featureWalkthrough: [
      {
        heading: "Talking to the assistant",
        body:
          "Type a question in the composer, or use the microphone for voice input with live " +
          "interim transcription. Suggestion chips offer quick starting points. While the " +
          'assistant is composing a reply, a "Still thinking" state is shown rather than a ' +
          "blank pause.",
      },
      {
        heading: "Seeing how an answer is grounded",
        body:
          "A diagnostics panel shows the agent's trace and, separately, its sources — where " +
          "an answer came from. If a reply used a static template with no lookup needed, the " +
          "sources panel says so plainly rather than showing an empty list.",
      },
      {
        heading: "Talking to a person",
        body:
          '"Talk to a person" hands the conversation to a live human agent, carrying the ' +
          "full transcript, any verified identity, and anything the assistant was still " +
          "mid-way through — never a cold start for whoever picks it up. A queue position is " +
          "shown while waiting. Once a live agent has joined, the composer shows this " +
          "plainly rather than silently sending your next message to a bot.",
      },
    ],
    howTo: [
      {
        title: "Ask a question",
        steps: [
          "Open the widget and type your question, or select a suggested chip.",
          "Read the reply — check the sources panel if you want to see what it was based on.",
        ],
      },
      {
        title: "Ask a question by voice",
        steps: [
          "Select the microphone icon (if your browser supports it).",
          "Speak — your words appear as interim text while you talk.",
          "Review the transcribed question before it sends, if you want to correct anything.",
        ],
      },
      {
        title: "Get a human's help",
        steps: [
          'Select "Talk to a person."',
          "Wait for your queue position to reach the front — a live agent then joins with " +
            "your full conversation already in view, so you don't have to repeat yourself.",
        ],
      },
    ],
    permissionsNote:
      "No sign-in or staff permission applies here — this is the public, citizen-facing " +
      "surface. An identity check only happens if a specific action you ask for genuinely " +
      "needs one (see the backoffice's own Identity & transactions guide entry for how that " +
      "works from the staff side).",
    lastVerifiedAgainst: "messages/en.json's widget namespace — 2026-09-10",
  },
  ar: {
    title: "استخدام أداة المساعد",
    purpose:
      "دليل موجز للمواطنين الذين يستخدمون مساعد الدردشة المضمّن في صفحة خدمة حكومية بالشارقة " +
      "— كيفية طرح سؤال، استخدام الإدخال الصوتي، معرفة مصدر الإجابة، والوصول إلى إنسان عند " +
      "الحاجة.",
    featureWalkthrough: [
      {
        heading: "التحدث مع المساعد",
        body:
          "اكتب سؤالًا في صندوق الكتابة، أو استخدم الميكروفون للإدخال الصوتي مع نسخ فوري حي. " +
          "تقدّم الشرائح المقترحة نقاط بداية سريعة. أثناء تركيب المساعد ردًا، تُعرض حالة " +
          '"لا يزال يفكر" بدل توقف فارغ.',
      },
      {
        heading: "رؤية أساس الإجابة",
        body:
          "تعرض لوحة تشخيص تتبع الوكيل، ومنفصلة عنها مصادره — من أين جاءت الإجابة. إن " +
          "استخدم الرد قالبًا ثابتًا دون حاجة لبحث، تذكر لوحة المصادر ذلك بوضوح بدل عرض قائمة " +
          "فارغة.",
      },
      {
        heading: "التحدث مع إنسان",
        body:
          'يسلّم "التحدث مع إنسان" المحادثة إلى وكيل بشري حي، حاملًا النص الكامل، وأي هوية ' +
          "موثّقة، وأي شيء كان المساعد في منتصف تنفيذه — لا بداية باردة أبدًا لمن يستلمها. " +
          "يُعرض موقعك في الطابور أثناء الانتظار. وبمجرد انضمام وكيل حي، يُظهر صندوق الكتابة " +
          "ذلك بوضوح بدل إرسال رسالتك التالية بصمت إلى برنامج آلي.",
      },
    ],
    howTo: [
      {
        title: "طرح سؤال",
        steps: [
          "افتح الأداة واكتب سؤالك، أو اختر شريحة مقترحة.",
          "اقرأ الرد — تحقق من لوحة المصادر إن أردت معرفة أساسه.",
        ],
      },
      {
        title: "طرح سؤال صوتيًا",
        steps: [
          "اختر أيقونة الميكروفون (إن كان متصفحك يدعمها).",
          "تحدّث — تظهر كلماتك كنص مؤقت أثناء حديثك.",
          "راجع السؤال المنسوخ قبل إرساله، إن أردت تصحيح أي شيء.",
        ],
      },
      {
        title: "الحصول على مساعدة إنسان",
        steps: [
          'اختر "التحدث مع إنسان".',
          "انتظر حتى يصل موقعك في الطابور إلى المقدمة — ينضم وكيل حي حينها ومحادثتك الكاملة " +
            "أمامه بالفعل، فلا تحتاج لتكرار كلامك.",
        ],
      },
    ],
    permissionsNote:
      "لا تسجيل دخول ولا صلاحية موظفين تنطبق هنا — هذا السطح العام الموجّه للمواطنين. لا " +
      "يحدث فحص هوية إلا إذا احتاجه فعليًا إجراء محدد تطلبه (راجع مدخل دليل الهوية والمعاملات " +
      "في النظام الخلفي لمعرفة كيفية عمل ذلك من جهة الموظفين).",
    lastVerifiedAgainst: "مساحة الاسم widget في messages/en.json — 2026-09-10",
  },
};
