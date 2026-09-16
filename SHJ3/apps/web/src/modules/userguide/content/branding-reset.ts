import type { LocalizedGuideContent } from "./index.js";

/**
 * `/branding/reset` — the platform operator's cross-tenant counterpart to
 * `/settings/appearance/reset` (platform-admin wave, Part D + E, 2026-09-13). Written
 * directly against `(platform-admin)/branding/reset/{page,actions}.tsx`.
 */
export const brandingReset: LocalizedGuideContent = {
  en: {
    title: "Platform console → Branding → Reset",
    purpose:
      "Two independent reset actions for a platform operator: clearing their own personal " +
      "appearance preference, and resetting a chosen tenant's branding back to the system " +
      "default. Reached from the Reset link at the bottom of the Branding screen, which " +
      "carries the currently-selected tenant along automatically.",
    featureWalkthrough: [
      {
        heading: "Your own personal preference",
        body:
          "Clears the operator's own saved mode/density/direction/font-size/reduced-motion " +
          "preference. Never touches any tenant's branding, regardless of which tenant is " +
          "selected.",
      },
      {
        heading: "Tenant branding",
        body:
          "Deletes the selected tenant's saved branding entirely, falling back to the " +
          "shipped system default for every user of that tenant with no personal override. " +
          "Recorded as a cross-tenant audit entry.",
      },
    ],
    howTo: [
      {
        title: "Reset a tenant's branding to the system default",
        steps: [
          "Open Platform console → Branding and select the tenant.",
          "Select the Reset link.",
          "Select Reset tenant branding under Tenant branding.",
        ],
      },
    ],
    permissionsNote:
      'Requires the "platform:operate" permission AND the signed-in operator\'s own tenant ' +
      "must be the real Platform tenant, same as every other screen in this console.",
    lastVerifiedAgainst:
      "apps/web/src/app/[locale]/(platform-admin)/branding/reset/{page,actions}.tsx — 2026-09-13",
  },
  ar: {
    title: "لوحة تحكم المنصة ← الهوية البصرية ← الاستعادة",
    purpose:
      "إجراءا استعادة مستقلان لمشغّل المنصة: مسح تفضيل المظهر الشخصي الخاص به، واستعادة " +
      "الهوية البصرية لجهة مختارة إلى الافتراضي العام للنظام. يُفتح هذا من رابط الاستعادة " +
      "أسفل شاشة الهوية البصرية، الذي يحمل الجهة المختارة حاليًا تلقائيًا.",
    featureWalkthrough: [
      {
        heading: "تفضيلك الشخصي",
        body:
          "يمسح تفضيل المشغّل المحفوظ (الوضع/الكثافة/الاتجاه/حجم الخط/تقليل الحركة). لا " +
          "يمسّ هوية أي جهة بصرية أبدًا، بغض النظر عن الجهة المختارة.",
      },
      {
        heading: "هوية الجهة البصرية",
        body:
          "يحذف الهوية البصرية المحفوظة للجهة المختارة بالكامل، فيعود كل مستخدم في تلك " +
          "الجهة بلا تفضيل شخصي إلى الافتراضي العام المشحون للنظام. يُسجَّل كإدخال تدقيق " +
          "عابر للجهات.",
      },
    ],
    howTo: [
      {
        title: "استعادة الهوية البصرية لجهة إلى الافتراضي العام",
        steps: [
          "افتح لوحة تحكم المنصة ← الهوية البصرية واختر الجهة.",
          "اختر رابط الاستعادة.",
          "اختر استعادة هوية الجهة ضمن قسم هوية الجهة البصرية.",
        ],
      },
    ],
    permissionsNote:
      'يتطلب صلاحية "platform:operate" مع كون جهة المشغّل الموقّع دخوله هي جهة المنصة ' +
      "الحقيقية نفسها، تمامًا كما في كل شاشة أخرى في هذه اللوحة.",
    lastVerifiedAgainst:
      "apps/web/src/app/[locale]/(platform-admin)/branding/reset/{page,actions}.tsx — 2026-09-13",
  },
};
