import type { LocalizedGuideContent } from "./index.js";

/**
 * `/settings/appearance` — Phase E's `SkinEditor` organism (design-system.md §5.5 #55).
 * Written directly against `settings/appearance/page.tsx` and `messages/en.json`'s real
 * `settingsAppearance` namespace.
 */
export const settingsAppearance: LocalizedGuideContent = {
  en: {
    title: "Settings → Appearance",
    purpose:
      "Controls how the app looks — colours, typography, layout density, light/dark mode and " +
      "text direction. Changes preview live before anything is saved, and every user always " +
      "keeps a personal preference layer on top of whatever their organisation has branded.",
    featureWalkthrough: [
      {
        heading: "Brand section",
        body:
          "Primary/secondary/accent colours plus the semantic colours (success, warning, " +
          "danger, info), logo (light and dark variants), favicon and app title — written " +
          "into named token slots via a validated form, never as raw class names. A colour " +
          "pairing that would fail WCAG 2.1 AA contrast is flagged before it can be saved. " +
          "Logo and favicon uploads (PNG, WebP or ICO, 1 MB or smaller) take effect " +
          "immediately on selection, and become available once the organisation's colour " +
          "scheme has been saved at least once.",
      },
      {
        heading: "Typography, layout and mode/direction sections",
        body:
          "Font family, base size and weight scale; corner radius, spacing density " +
          "(Compact/Comfortable), shadow depth and sidebar style; light/dark/system mode and " +
          "LTR/RTL direction. Every change repaints the whole live preview immediately — " +
          "there is no rebuild or reload step.",
      },
      {
        heading: "Skins",
        body:
          "Named, saveable presets. The system ships a default and a dark skin; an authorised " +
          "user can duplicate, rename, edit, export a skin as JSON, or import one. Applying a " +
          "skin either to the whole organisation (tenant branding) or to just your own account " +
          "(personal preference) are two distinct actions — resolution order is personal " +
          "preference, then the organisation's branding, then the system default.",
      },
      {
        heading: "Save / Reset",
        body:
          "Every edit is a draft until Save is pressed — the app is never left half-applied. " +
          '"Reset to default" (top of the page) links to the dedicated reset screen for ' +
          "when a saved theme itself has made this page hard to use.",
      },
    ],
    howTo: [
      {
        title: "Change your own personal appearance (any signed-in user)",
        steps: [
          "Open Settings → Appearance.",
          "Adjust mode, density, font size or direction in the relevant section.",
          "Save — this applies only to your own account, never to anyone else.",
        ],
      },
      {
        title: "Brand the whole organisation (requires Manage appearance)",
        steps: [
          "Open Settings → Appearance.",
          "Set colours, logo, typography and layout in the Brand/Typography/Layout sections.",
          "Watch the live preview update as you go.",
          "Save — every user in the organisation without a personal override now sees this.",
        ],
      },
      {
        title: "Save a skin as a reusable preset",
        steps: [
          "Configure the colours and layout you want as a skin.",
          "Use Duplicate to save the current configuration as a new named skin, or Export to " +
            "download it as JSON to share or back up.",
          "A saved skin can be applied again later, or imported on another tenant via Import.",
        ],
      },
    ],
    permissionsNote:
      "Anyone signed in can set their own personal preference. Editing the organisation's " +
      "branding (colours, logo, typography, layout that every user sees by default) requires " +
      'the "Manage appearance" permission — without it, the page still opens but shows a ' +
      "view-only notice and only the personal-preference controls are enabled. A signed-out " +
      "visitor sees a sign-in prompt instead.",
    lastVerifiedAgainst:
      "apps/web/src/app/[locale]/settings/appearance/page.tsx, messages/en.json's settingsAppearance " +
      "namespace, and brand-section.tsx's real logo/favicon upload controls — 2026-09-10",
  },
  ar: {
    title: "الإعدادات ← المظهر",
    purpose:
      "تتحكم هذه الصفحة في شكل التطبيق — الألوان والخطوط وكثافة التخطيط ووضع الإضاءة/الظلام " +
      "واتجاه النص. تُعرض التغييرات مباشرة قبل حفظ أي شيء، ويحتفظ كل مستخدم دائمًا بطبقة " +
      "تفضيل شخصية فوق أي هوية بصرية حدّدتها جهته.",
    featureWalkthrough: [
      {
        heading: "قسم الهوية البصرية",
        body:
          "الألوان الأساسية والثانوية والمميزة إضافة إلى الألوان الدلالية (نجاح، تحذير، خطر، " +
          "معلومة)، والشعار (بنسختيه الفاتحة والداكنة)، وأيقونة المتصفح، وعنوان التطبيق — " +
          "تُكتب في خانات رموز مسمّاة عبر نموذج تحقّق، وليس كأسماء أصناف خام أبدًا. يُنبَّه " +
          "المستخدم قبل الحفظ إذا كان تركيب الألوان سيفشل في اختبار تباين WCAG 2.1 AA. " +
          "يسري رفع الشعار وأيقونة المتصفح (بصيغة PNG أو WebP أو ICO، بحجم لا يتجاوز 1 " +
          "ميغابايت) فور اختيار الملف، ولا يصبح متاحًا إلا بعد حفظ مخطط ألوان المؤسسة مرة " +
          "واحدة على الأقل.",
      },
      {
        heading: "أقسام الخطوط والتخطيط والوضع/الاتجاه",
        body:
          "نوع الخط وحجمه الأساسي ووزنه؛ تدوير الزوايا وكثافة التباعد (مضغوط/مريح) وعمق الظل " +
          "ونمط الشريط الجانبي؛ وضع الإضاءة/الظلام/النظام واتجاه النص (يسار-يمين أو يمين-" +
          "يسار). كل تغيير يعيد رسم المعاينة الحية فورًا — دون أي إعادة بناء أو تحميل.",
      },
      {
        heading: "الأنماط (Skins)",
        body:
          "إعدادات مسبقة مسمّاة وقابلة للحفظ. يوفر النظام نمطًا افتراضيًا ونمطًا داكنًا؛ " +
          "ويمكن للمستخدم المخوّل تكرار نمط أو إعادة تسميته أو تعديله أو تصديره كملف JSON أو " +
          "استيراد نمط. تطبيق نمط على المؤسسة بأكملها (هوية الجهة) أو على حسابك فقط (التفضيل " +
          "الشخصي) إجراءان منفصلان — وترتيب الأولوية هو: التفضيل الشخصي، ثم هوية الجهة، ثم " +
          "الافتراضي العام للنظام.",
      },
      {
        heading: "الحفظ / الاستعادة",
        body:
          "كل تعديل يبقى مسودة حتى الضغط على حفظ — لا يُترك التطبيق أبدًا في حالة نصف مطبّقة. " +
          'يقود رابط "استعادة الافتراضي" أعلى الصفحة إلى شاشة الاستعادة المخصصة لحالة تعذّر ' +
          "استخدام هذه الصفحة بسبب نمط محفوظ.",
      },
    ],
    howTo: [
      {
        title: "تغيير مظهرك الشخصي (لأي مستخدم مسجل)",
        steps: [
          "افتح الإعدادات ← المظهر.",
          "عدّل الوضع أو الكثافة أو حجم الخط أو الاتجاه في القسم المناسب.",
          "احفظ — ينطبق هذا على حسابك فقط، وليس على أي مستخدم آخر.",
        ],
      },
      {
        title: "تخصيص هوية المؤسسة بأكملها (يتطلب صلاحية إدارة المظهر)",
        steps: [
          "افتح الإعدادات ← المظهر.",
          "اضبط الألوان والشعار والخطوط والتخطيط في الأقسام المخصصة لذلك.",
          "راقب تحديث المعاينة الحية أثناء التعديل.",
          "احفظ — سيرى كل مستخدم في المؤسسة بلا تفضيل شخصي هذه الهوية.",
        ],
      },
      {
        title: "حفظ نمط كإعداد مسبق قابل لإعادة الاستخدام",
        steps: [
          "اضبط الألوان والتخطيط الذي تريده كنمط.",
          'استخدم "تكرار" لحفظ الإعداد الحالي كنمط جديد مسمّى، أو "تصدير" لتنزيله كملف ' +
            "JSON للمشاركة أو النسخ الاحتياطي.",
          'يمكن تطبيق النمط المحفوظ لاحقًا، أو استيراده على جهة أخرى عبر "استيراد".',
        ],
      },
    ],
    permissionsNote:
      "يمكن لأي مستخدم مسجل ضبط تفضيله الشخصي. أما تعديل هوية المؤسسة (الألوان والشعار " +
      'والخطوط والتخطيط الذي يراه كل مستخدم افتراضيًا) فيتطلب صلاحية "إدارة المظهر" — ' +
      "فمن دونها تُفتح الصفحة لكن بإشعار للعرض فقط وتُفعَّل عناصر التفضيل الشخصي حصرًا. أما " +
      "الزائر غير المسجل فيرى رسالة لتسجيل الدخول.",
    lastVerifiedAgainst:
      "apps/web/src/app/[locale]/settings/appearance/page.tsx، مساحة الاسم settingsAppearance في " +
      "messages/en.json، وعناصر رفع الشعار وأيقونة المتصفح الحقيقية في brand-section.tsx — 2026-09-10",
  },
};
