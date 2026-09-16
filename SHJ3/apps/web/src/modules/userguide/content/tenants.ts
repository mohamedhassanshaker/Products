import type { LocalizedGuideContent } from "./index.js";

/**
 * `/tenants` — the platform operator's tenant lifecycle screen (platform-admin wave, Part C
 * + E, 2026-09-13). Written directly against `(platform-admin)/tenants/page.tsx`,
 * `tenants-screen.tsx` and `messages/en.json`'s `platformAdmin.tenants` namespace.
 */
export const tenants: LocalizedGuideContent = {
  en: {
    title: "Platform console → Tenants",
    purpose:
      "Lists every government entity (tenant) registered on the platform, regardless of " +
      "status, and lets a platform operator create a new tenant, suspend one, or " +
      "permanently delete (deprovision) one. Only the real Platform tenant's own Super " +
      "Admin can reach this screen — an ordinary tenant's own Super Admin cannot, even if " +
      "they hold the same permission name in their own tenant's matrix.",
    featureWalkthrough: [
      {
        heading: "Create tenant",
        body:
          "A slug and display name are enough to provision a brand-new tenant across all " +
          "four isolation stores (SQL Server schema, Neo4j, Qdrant, Redis). The slug becomes " +
          "the tenant's permanent schema name and cannot be changed afterwards.",
      },
      {
        heading: "All tenants table",
        body:
          "Every registered tenant with its slug, display name, status (Provisioning, " +
          "Active, Suspended, Deprovisioning, Deprovisioned, Failed) and creation date.",
      },
      {
        heading: "Suspend",
        body:
          "Available on an Active tenant. Ends every one of that tenant's staff sessions " +
          "immediately and refuses any new sign-in for it until it is Active again — a real, " +
          "not cosmetic, lockout.",
      },
      {
        heading: "Delete",
        body:
          "Available only on a Suspended tenant — Suspend is a mandatory first step, giving " +
          "a real cooling-off window before anything irreversible happens. Requires typing " +
          "the tenant's exact slug to confirm. Permanently tears down all four stores and " +
          "verifies each one is gone; there is no undo.",
      },
    ],
    howTo: [
      {
        title: "Create a new tenant",
        steps: [
          "Open Platform console → Tenants.",
          "Enter a slug and display name in the Create tenant form.",
          "Submit — the new tenant appears in the table once provisioning completes.",
        ],
      },
      {
        title: "Suspend, then delete a tenant",
        steps: [
          "Find the tenant's row and select Suspend.",
          "Once its status shows Suspended, type the tenant's exact slug into the " +
            "confirmation field next to Delete.",
          "Select Delete — this is permanent and cannot be undone.",
        ],
      },
    ],
    permissionsNote:
      'Requires the "platform:operate" permission AND the signed-in operator\'s own tenant ' +
      "must be the real Platform tenant — a compound check, not a permission alone. An " +
      "ordinary tenant's Super Admin who grants themselves this permission in their own " +
      "tenant's matrix still cannot reach this screen.",
    lastVerifiedAgainst:
      "apps/web/src/app/[locale]/(platform-admin)/tenants/{page,tenants-screen}.tsx, " +
      "messages/en.json's platformAdmin.tenants namespace — 2026-09-13",
  },
  ar: {
    title: "لوحة تحكم المنصة ← الجهات",
    purpose:
      "تعرض هذه الشاشة كل جهة حكومية (جهة مستأجرة) مسجّلة على المنصة، بغض النظر عن حالتها، " +
      "وتتيح لمشغّل المنصة إنشاء جهة جديدة أو تعليق جهة أو حذفها نهائيًا (إلغاء تهيئتها). لا " +
      "يمكن الوصول إلى هذه الشاشة إلا لمسؤول المستوى الأعلى (Super Admin) في جهة المنصة " +
      "الحقيقية نفسها — فمسؤول أي جهة أخرى لا يستطيع الوصول إليها حتى لو منح نفسه الصلاحية " +
      "ذاتها في مصفوفة جهته.",
    featureWalkthrough: [
      {
        heading: "إنشاء جهة",
        body:
          "يكفي إدخال معرّف واسم معروض لتهيئة جهة جديدة بالكامل عبر المخازن الأربعة للعزل " +
          "(مخطط SQL Server، وNeo4j، وQdrant، وRedis). يصبح المعرّف اسم المخطط الدائم للجهة " +
          "ولا يمكن تغييره لاحقًا.",
      },
      {
        heading: "جدول كل الجهات",
        body:
          "يعرض كل جهة مسجّلة مع معرّفها واسمها المعروض وحالتها (قيد التهيئة، نشطة، معلّقة، " +
          "قيد الإلغاء، أُلغيت تهيئتها، فشلت) وتاريخ إنشائها.",
      },
      {
        heading: "تعليق",
        body:
          "متاح لجهة نشطة. ينهي فورًا كل جلسات موظفي تلك الجهة ويرفض أي تسجيل دخول جديد لها " +
          "حتى تعود نشطة — تعليق حقيقي وليس شكليًا.",
      },
      {
        heading: "حذف",
        body:
          "متاح فقط لجهة معلّقة — التعليق خطوة أولى إلزامية تمنح فترة تروٍّ حقيقية قبل أي " +
          "إجراء لا رجعة فيه. يتطلب كتابة معرّف الجهة بالضبط للتأكيد. يزيل المخازن الأربعة " +
          "نهائيًا ويتحقق من زوال كل واحد منها؛ لا يمكن التراجع عن ذلك.",
      },
    ],
    howTo: [
      {
        title: "إنشاء جهة جديدة",
        steps: [
          "افتح لوحة تحكم المنصة ← الجهات.",
          "أدخل المعرّف والاسم المعروض في نموذج إنشاء جهة.",
          "أرسل النموذج — تظهر الجهة الجديدة في الجدول بعد اكتمال التهيئة.",
        ],
      },
      {
        title: "تعليق جهة ثم حذفها",
        steps: [
          "ابحث عن صف الجهة واختر تعليق.",
          "بعد ظهور حالتها كمعلّقة، اكتب معرّف الجهة بالضبط في حقل التأكيد بجانب حذف.",
          "اختر حذف — هذا إجراء دائم ولا يمكن التراجع عنه.",
        ],
      },
    ],
    permissionsNote:
      'يتطلب صلاحية "platform:operate" مع كون جهة المشغّل الموقّع دخوله هي جهة المنصة ' +
      "الحقيقية نفسها — فحص مركّب وليس صلاحية بمفردها. مسؤول أي جهة أخرى يمنح نفسه هذه " +
      "الصلاحية في مصفوفة جهته لا يستطيع مع ذلك الوصول إلى هذه الشاشة.",
    lastVerifiedAgainst:
      "apps/web/src/app/[locale]/(platform-admin)/tenants/{page,tenants-screen}.tsx، مساحة " +
      "الاسم platformAdmin.tenants في messages/en.json — 2026-09-13",
  },
};
