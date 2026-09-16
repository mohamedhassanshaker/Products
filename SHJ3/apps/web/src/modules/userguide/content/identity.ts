import type { LocalizedGuideContent } from "./index.js";

/**
 * `/identity` — B8/B11, identity & transactions. Written directly against
 * `messages/en.json`'s real `identity` namespace.
 */
export const identity: LocalizedGuideContent = {
  en: {
    title: "Identity & transactions",
    purpose:
      "Controls how much identity assurance a citizen needs before the assistant will act on " +
      "their behalf for sensitive actions, whether a payment must match the verified account " +
      "owner, and where a pending refund gets approved or declined.",
    featureWalkthrough: [
      {
        heading: "Step-up rules",
        body:
          "A table of sensitive actions and the identity assurance level each one currently " +
          "requires, editable per action. Step-up rules are evaluated **before** the tool " +
          "call that would perform the action — a citizen is asked to verify further first, " +
          "never after the action has already run.",
      },
      {
        heading: "Account-ownership check",
        body:
          "A single toggle: enabled means a payment must resolve to the same identity that " +
          "was verified, not merely to a valid account number; disabled trusts the supplied " +
          "account number without an ownership match.",
      },
      {
        heading: "Pending refund requests",
        body:
          "Each request shows the transaction, amount and stated reason, with Approve or " +
          "Decline. Refund decisions are a real, audited action here, not a suggestion — once " +
          "decided, the transaction record reflects it.",
      },
    ],
    howTo: [
      {
        title: "Raise the assurance bar for a sensitive action",
        steps: [
          "Open Step-up rules and find the action (e.g. a payment or an account change).",
          "Change its required assurance level to the higher tier needed.",
          "Save — every future attempt at that action is checked against the new level before " +
            "the underlying tool call runs.",
        ],
      },
      {
        title: "Approve a refund",
        steps: [
          "Open Pending refund requests and find the transaction.",
          "Review the amount and stated reason.",
          "Select Approve — or Decline if it shouldn't proceed.",
        ],
      },
    ],
    permissionsNote:
      "The whole screen requires the Super Admin permission — every action here (assurance " +
      "levels, the account-ownership toggle, refund decisions) is high-consequence enough " +
      "that no lower role can reach it at all.",
    lastVerifiedAgainst: "messages/en.json's identity namespace — 2026-09-10",
  },
  ar: {
    title: "الهوية والمعاملات",
    purpose:
      "تتحكم في مقدار ضمان الهوية الذي يحتاجه المواطن قبل أن يتصرف المساعد نيابة عنه في " +
      "إجراءات حساسة، وهل يجب أن تطابق الدفعة مالك الحساب الموثّق، وأين تُعتمد أو تُرفض طلبات " +
      "الاسترداد المعلّقة.",
    featureWalkthrough: [
      {
        heading: "قواعد رفع مستوى التوثيق",
        body:
          "جدول بالإجراءات الحساسة ومستوى ضمان الهوية الذي يتطلبه كل منها حاليًا، قابل " +
          "للتعديل لكل إجراء. تُقيَّم قواعد رفع مستوى التوثيق **قبل** استدعاء الأداة الذي " +
          "سينفّذ الإجراء — يُطلب من المواطن مزيدًا من التوثيق أولًا، لا بعد تنفيذ الإجراء " +
          "فعلًا أبدًا.",
      },
      {
        heading: "فحص ملكية الحساب",
        body:
          "مفتاح واحد: تفعيله يعني أن الدفعة يجب أن تُحلَّ إلى نفس الهوية الموثّقة، لا مجرد " +
          "رقم حساب صالح؛ وتعطيله يثق برقم الحساب المُقدَّم دون مطابقة الملكية.",
      },
      {
        heading: "طلبات الاسترداد المعلّقة",
        body:
          "يعرض كل طلب المعاملة والمبلغ والسبب المذكور، مع خياري اعتماد أو رفض. قرارات " +
          "الاسترداد إجراء حقيقي وموثَّق هنا، لا مجرد اقتراح — بمجرد اتخاذ القرار، يعكسه سجل " +
          "المعاملة.",
      },
    ],
    howTo: [
      {
        title: "رفع حد الضمان لإجراء حساس",
        steps: [
          "افتح قواعد رفع مستوى التوثيق وابحث عن الإجراء (مثل دفعة أو تغيير حساب).",
          "غيّر مستوى الضمان المطلوب له إلى الفئة الأعلى المطلوبة.",
          "احفظ — تُفحص كل محاولة مستقبلية لذلك الإجراء مقابل المستوى الجديد قبل تنفيذ " +
            "استدعاء الأداة الأساسي.",
        ],
      },
      {
        title: "اعتماد استرداد",
        steps: [
          "افتح طلبات الاسترداد المعلّقة وابحث عن المعاملة.",
          "راجع المبلغ والسبب المذكور.",
          "اختر اعتماد — أو رفض إذا لم يجب أن تُنفَّذ.",
        ],
      },
    ],
    permissionsNote:
      "تتطلب الشاشة بأكملها صلاحية مسؤول النظام الرئيسي — فكل إجراء هنا (مستويات الضمان، " +
      "مفتاح ملكية الحساب، قرارات الاسترداد) بالغ الأثر بحيث لا يستطيع أي دور أدنى الوصول " +
      "إليه إطلاقًا.",
    lastVerifiedAgainst: "مساحة الاسم identity في messages/en.json — 2026-09-10",
  },
};
