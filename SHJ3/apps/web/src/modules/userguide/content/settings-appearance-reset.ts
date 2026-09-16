import type { LocalizedGuideContent } from "./index.js";

/**
 * `/settings/appearance/reset` — the escape hatch, deliberately rendered with plain inline
 * styles rather than CSS custom properties so it stays legible even when a saved theme has
 * made the rest of the app hard to use. Written directly against
 * `settings/appearance/reset/page.tsx` and `messages/en.json`'s real `appearanceReset`
 * namespace.
 */
export const settingsAppearanceReset: LocalizedGuideContent = {
  en: {
    title: "Reset appearance",
    purpose:
      "A deliberately plain, always-legible page for the one situation the rest of the " +
      "Appearance screen cannot help with: a saved theme has made the app itself hard to " +
      "read or use. This page never applies any tenant or personal theme to itself, so it " +
      "works even when everything else doesn't.",
    featureWalkthrough: [
      {
        heading: "Reset my personal preference",
        body:
          "Clears your own saved mode, density, font size, direction and reduced-motion " +
          "overrides. After this, you see your organisation's (or the system's) default " +
          "appearance again, the same as any user with no personal preference set.",
      },
      {
        heading: "Reset tenant branding",
        body:
          "Removes the organisation's custom branding entirely, so every user without a " +
          "personal override goes back to seeing the system default. This is the one control " +
          "on this page that affects other people, not just the person clicking it.",
      },
    ],
    howTo: [
      {
        title: "Recover from a personal theme change that made the app hard to read",
        steps: [
          "Go directly to /settings/appearance/reset (bookmark this — it is the one page " +
            "guaranteed to render plainly regardless of any saved theme).",
          'Select "Reset my preference".',
          "Your own appearance reverts to the organisation's or system default immediately.",
        ],
      },
      {
        title: "Undo a bad organisation-wide branding change",
        steps: [
          "Go to /settings/appearance/reset.",
          'Select "Reset tenant branding" (requires the Manage appearance permission).',
          "Every user in the organisation without their own personal override now sees the " +
            "system default again.",
        ],
      },
    ],
    permissionsNote:
      "Resetting your own personal preference needs only a signed-in session. Resetting " +
      'tenant branding needs the "Manage appearance" permission — attempting it without ' +
      "that permission shows a plain notice explaining it's missing, rather than performing " +
      "the reset.",
    lastVerifiedAgainst:
      "apps/web/src/app/[locale]/settings/appearance/reset/page.tsx, messages/en.json's appearanceReset namespace — 2026-09-10",
  },
  ar: {
    title: "استعادة المظهر الافتراضي",
    purpose:
      "صفحة بسيطة ومقروءة دائمًا، مخصصة للحالة الوحيدة التي لا تستطيع شاشة المظهر العادية " +
      "مساعدتك فيها: عندما يجعل نمط محفوظ التطبيق نفسه صعب القراءة أو الاستخدام. لا تطبّق " +
      "هذه الصفحة أي هوية جهة أو تفضيل شخصي على نفسها، لذا تعمل حتى عندما يتعطل كل شيء آخر.",
    featureWalkthrough: [
      {
        heading: "استعادة تفضيلي الشخصي",
        body:
          "يمسح الوضع والكثافة وحجم الخط والاتجاه وتفضيلات تقليل الحركة المحفوظة الخاصة بك. " +
          "بعدها ترى مظهر مؤسستك (أو النظام) الافتراضي من جديد، كأي مستخدم لا يملك تفضيلًا " +
          "شخصيًا محفوظًا.",
      },
      {
        heading: "استعادة هوية الجهة",
        body:
          "يزيل الهوية البصرية المخصصة للمؤسسة بالكامل، بحيث يعود كل مستخدم بلا تفضيل شخصي " +
          "إلى رؤية الافتراضي العام للنظام. هذا هو التحكم الوحيد في هذه الصفحة الذي يؤثر على " +
          "أشخاص آخرين، لا على الشخص الذي يضغطه فقط.",
      },
    ],
    howTo: [
      {
        title: "التعافي من تغيير مظهر شخصي جعل التطبيق صعب القراءة",
        steps: [
          "اذهب مباشرة إلى /settings/appearance/reset (احفظها كإشارة مرجعية — فهي الصفحة " +
            "الوحيدة المضمون عرضها ببساطة بغض النظر عن أي نمط محفوظ).",
          'اختر "استعادة تفضيلي".',
          "يعود مظهرك الخاص فورًا إلى افتراضي المؤسسة أو النظام.",
        ],
      },
      {
        title: "التراجع عن تغيير سيء في الهوية البصرية للمؤسسة",
        steps: [
          "اذهب إلى /settings/appearance/reset.",
          'اختر "استعادة هوية الجهة" (يتطلب صلاحية إدارة المظهر).',
          "يعود كل مستخدم في المؤسسة بلا تفضيل شخصي إلى رؤية الافتراضي العام للنظام.",
        ],
      },
    ],
    permissionsNote:
      "استعادة تفضيلك الشخصي تتطلب فقط جلسة تسجيل دخول. أما استعادة هوية الجهة فتتطلب صلاحية " +
      '"إدارة المظهر" — ومحاولتها بدونها تُظهر إشعارًا واضحًا بغيابها بدلًا من تنفيذ ' +
      "الاستعادة.",
    lastVerifiedAgainst:
      "apps/web/src/app/[locale]/settings/appearance/reset/page.tsx، مساحة الاسم appearanceReset في messages/en.json — 2026-09-10",
  },
};
