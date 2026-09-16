import type { LocalizedGuideContent } from "./index.js";

/**
 * `/branding` — the platform operator's cross-tenant branding screen (platform-admin
 * wave, Part D + E, 2026-09-13). Written directly against `(platform-admin)/branding/
 * {page,branding-screen}.tsx` and `messages/en.json`'s `platformAdmin.branding` namespace.
 */
export const branding: LocalizedGuideContent = {
  en: {
    title: "Platform console → Branding",
    purpose:
      "Lets a platform operator view and edit ANY tenant's branding — the same colours, " +
      "typography, layout and logo/favicon controls that tenant's own Settings → " +
      "Appearance screen offers its Super Admin, opened for a tenant chosen from a picker " +
      "rather than the signed-in operator's own tenant.",
    featureWalkthrough: [
      {
        heading: "Tenant picker",
        body:
          "Lists every Active or Suspended tenant. Selecting one loads that tenant's real, " +
          "current branding — every edit made afterwards applies to that tenant, not the " +
          "operator's own.",
      },
      {
        heading: "Everything below the picker",
        body:
          "The same Brand / Typography / Layout / Skins sections `/settings/appearance` " +
          "documents, unchanged — see that guide entry for the full walkthrough of each " +
          "control. The one difference: every save here is attributed to the platform " +
          "operator and recorded as a cross-tenant audit entry, since the acting person " +
          "never had to hold that tenant's own appearance:manage permission.",
      },
      {
        heading: "Personal preference",
        body:
          "The Personal preference controls on this screen always apply to the signed-in " +
          "operator's OWN account, never to the tenant currently selected in the picker — " +
          "switching tenants never scatters one operator's personal preference across " +
          "every tenant they inspect.",
      },
    ],
    howTo: [
      {
        title: "Edit a tenant's branding",
        steps: [
          "Open Platform console → Branding.",
          "Choose the tenant from the picker at the top.",
          "Edit colours, typography, layout or upload a logo/favicon exactly as that " +
            "tenant's own Super Admin would.",
          "Save — the change applies to that tenant only, and is recorded in the audit log.",
        ],
      },
    ],
    permissionsNote:
      'Requires the "platform:operate" permission AND the signed-in operator\'s own tenant ' +
      "must be the real Platform tenant — every action on this screen, including reads, " +
      "checks both.",
    lastVerifiedAgainst:
      "apps/web/src/app/[locale]/(platform-admin)/branding/{page,branding-screen,actions}.tsx, " +
      "messages/en.json's platformAdmin.branding namespace — 2026-09-13",
  },
  ar: {
    title: "لوحة تحكم المنصة ← الهوية البصرية",
    purpose:
      "تتيح هذه الشاشة لمشغّل المنصة عرض وتعديل الهوية البصرية لأي جهة — أدوات التحكم نفسها " +
      "في الألوان والخطوط والتخطيط والشعار وأيقونة المتصفح التي تقدّمها شاشة الإعدادات ← " +
      "المظهر الخاصة بتلك الجهة لمسؤولها الأعلى، لكنها تُفتح هنا لجهة تُختار من قائمة بدلاً " +
      "من جهة المشغّل الموقّع دخوله نفسها.",
    featureWalkthrough: [
      {
        heading: "منتقي الجهة",
        body:
          "يعرض كل جهة نشطة أو معلّقة. عند اختيار إحداها تُحمَّل هويتها البصرية الحقيقية " +
          "الحالية — وكل تعديل لاحق يُطبَّق على تلك الجهة، لا على جهة المشغّل نفسه.",
      },
      {
        heading: "كل ما يلي منتقي الجهة",
        body:
          "أقسام الهوية البصرية والخطوط والتخطيط والأنماط ذاتها الموثّقة في دليل الإعدادات ← " +
          "المظهر، دون تغيير — راجع ذلك المدخل لشرح كامل لكل عنصر تحكم. الفرق الوحيد: كل حفظ " +
          "هنا يُنسب إلى مشغّل المنصة ويُسجَّل كإدخال تدقيق عابر للجهات، لأن الشخص الذي نفّذ " +
          "الإجراء لم يكن بحاجة لامتلاك صلاحية إدارة المظهر في تلك الجهة نفسها.",
      },
      {
        heading: "التفضيل الشخصي",
        body:
          "عناصر التفضيل الشخصي في هذه الشاشة تُطبَّق دائمًا على حساب المشغّل الموقّع دخوله " +
          "نفسه، وليس على الجهة المختارة حاليًا في المنتقي — فتبديل الجهة لا يبعثر تفضيل " +
          "المشغّل الشخصي عبر كل جهة يعاينها.",
      },
    ],
    howTo: [
      {
        title: "تعديل الهوية البصرية لجهة",
        steps: [
          "افتح لوحة تحكم المنصة ← الهوية البصرية.",
          "اختر الجهة من المنتقي أعلى الصفحة.",
          "عدّل الألوان أو الخطوط أو التخطيط أو ارفع شعارًا/أيقونة متصفح تمامًا كما يفعل " +
            "مسؤول تلك الجهة نفسه.",
          "احفظ — يُطبَّق التغيير على تلك الجهة فقط، ويُسجَّل في سجل التدقيق.",
        ],
      },
    ],
    permissionsNote:
      'يتطلب صلاحية "platform:operate" مع كون جهة المشغّل الموقّع دخوله هي جهة المنصة ' +
      "الحقيقية نفسها — يُفحص كلا الشرطين في كل إجراء على هذه الشاشة، حتى القراءة.",
    lastVerifiedAgainst:
      "apps/web/src/app/[locale]/(platform-admin)/branding/{page,branding-screen,actions}.tsx، " +
      "مساحة الاسم platformAdmin.branding في messages/en.json — 2026-09-13",
  },
};
