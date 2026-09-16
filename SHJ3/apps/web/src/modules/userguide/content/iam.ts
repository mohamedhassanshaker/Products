import type { LocalizedGuideContent } from "./index.js";

/**
 * `/iam` — the first real `(backoffice)` screen (B9). Written directly against
 * `(backoffice)/iam/page.tsx`, `iam/iam-screen.tsx` and `messages/en.json`'s real `iam`
 * namespace (`tabs.users`/`tabs.teams`/`tabs.roles`, the real row actions) — not the
 * wireframe's original mockup, per this wave's own instruction.
 */
export const iam: LocalizedGuideContent = {
  en: {
    title: "Users, teams & roles",
    purpose:
      "This is where a Super Admin manages who can sign in to this entity's backoffice, " +
      "which team they belong to, and exactly which actions their role allows. Every other " +
      "screen in the backoffice reads its access rules from what is configured here.",
    featureWalkthrough: [
      {
        heading: "Users tab",
        body:
          "A table of every staff account for this entity, each row showing their name, " +
          'email, team, role and status (Invited, Active or Suspended). "Invite user" ' +
          "opens a dialog for an email and display name; the new account appears immediately " +
          "as Invited. Each row's Actions menu offers Edit (name, email, team memberships and " +
          "roles), Suspend (ends that person's signed-in session immediately, everywhere), " +
          "Reactivate, and Remove (with a confirmation naming the person by name before it " +
          "takes effect).",
      },
      {
        heading: "Teams tab",
        body:
          'A table of teams, each showing its entity scope ("This entity" or "All ' +
          'entities") and its member count, which is always computed live from the Users ' +
          "tab's own team assignments rather than a separately maintained list — reassigning " +
          'someone\'s team on the Users tab is reflected here immediately. "Add team" opens a ' +
          "dialog for a team name and scope.",
      },
      {
        heading: "Roles & permissions tab",
        body:
          "The permission matrix: every role as a column, every permission as a row, every " +
          'cell a toggle. "Add custom role" creates a new role that starts with no ' +
          "permissions granted. The matrix enforces one rule structurally, not just by " +
          "convention: an Agent Designer role can build agents but not publish them — " +
          "publishing is reserved for Entity Admin, a deliberate separation of duties between " +
          "authoring and release. Attempting to grant a role both permissions at once shows a " +
          "confirmation naming the exact tension being overridden, rather than silently " +
          "allowing it.",
      },
    ],
    howTo: [
      {
        title: "Invite a new staff member",
        steps: [
          "Open the Users tab (the default tab when the page loads).",
          'Select "Invite user".',
          "Enter their display name and email address.",
          'Select "Send invite" — they appear in the table immediately with an Invited status.',
        ],
      },
      {
        title: "Suspend someone's access immediately",
        steps: [
          "Find their row on the Users tab.",
          "Open the row's Actions menu and select Suspend.",
          "Their status changes to Suspended and any session they currently hold is ended " +
            "right away — they cannot continue working with a page already open.",
        ],
      },
      {
        title: "Create a custom role with a specific set of permissions",
        steps: [
          "Open the Roles & permissions tab.",
          'Select "Add custom role" and give it a name.',
          "In the new role's column, toggle on each permission it should have.",
          "If a toggle would let the role both build and publish agents, confirm the " +
            "separation-of-duties warning only if that is genuinely intended.",
        ],
      },
    ],
    permissionsNote:
      "The whole screen requires the users:manage permission just to be visible — anyone " +
      'without it is shown a plain "You don\'t have access to this screen" message instead ' +
      "of the tabs. In the seeded demo data, users:manage is restricted to the Super Admin " +
      "role alone, so this is effectively a Super-Admin-only screen today. A signed-out " +
      "visitor sees a sign-in prompt instead of either the tabs or the permission message.",
    lastVerifiedAgainst:
      "apps/web/src/app/[locale]/(backoffice)/iam/page.tsx, iam-screen.tsx, messages/en.json's iam namespace — 2026-09-10",
  },
  ar: {
    title: "المستخدمون والفرق والأدوار",
    purpose:
      "من هنا يدير مسؤول النظام الرئيسي (Super Admin) من يمكنه تسجيل الدخول إلى النظام الخلفي " +
      "لهذه الجهة، والفريق الذي ينتمي إليه كل موظف، والصلاحيات الدقيقة التي يتيحها دوره. تعتمد " +
      "كل شاشة أخرى في النظام الخلفي على قواعد الوصول المُعدّة هنا.",
    featureWalkthrough: [
      {
        heading: "تبويب المستخدمون",
        body:
          "جدول بجميع حسابات الموظفين لهذه الجهة، ويعرض كل صف الاسم والبريد الإلكتروني " +
          'والفريق والدور والحالة (مدعو، نشط، أو موقوف). يفتح زر "دعوة مستخدم" نافذة لإدخال ' +
          'البريد الإلكتروني والاسم الظاهر؛ ويظهر الحساب الجديد فورًا بحالة "مدعو". تتيح ' +
          "قائمة الإجراءات في كل صف: تعديل (الاسم والبريد والفرق والأدوار)، إيقاف (ينهي جلسة " +
          "الشخص فورًا وفي كل مكان)، إعادة تفعيل، وحذف (مع تأكيد يذكر اسم الشخص قبل التنفيذ).",
      },
      {
        heading: "تبويب الفرق",
        body:
          'جدول بالفرق، يعرض كل صف نطاق الجهة ("هذه الجهة" أو "جميع الجهات") وعدد ' +
          "الأعضاء، والذي يُحسب دائمًا مباشرة من تعيينات الفرق في تبويب المستخدمين — فإعادة " +
          'تعيين فريق شخص ما في ذلك التبويب تنعكس هنا فورًا. يفتح زر "إضافة فريق" نافذة ' +
          "لإدخال اسم الفريق ونطاقه.",
      },
      {
        heading: "تبويب الأدوار والصلاحيات",
        body:
          "مصفوفة الصلاحيات: كل دور عمود، وكل صلاحية صف، وكل خلية مفتاح تبديل. ينشئ زر " +
          '"إضافة دور مخصص" دورًا جديدًا بلا صلاحيات ممنوحة في البداية. تفرض المصفوفة قاعدة ' +
          "واحدة بنيويًا لا عرفًا فقط: يمكن لدور مصمم الوكلاء بناء الوكلاء لكن لا يمكنه نشرهم — " +
          "فالنشر محصور بدور مسؤول الجهة، فصلًا متعمدًا بين التأليف والإصدار. عند محاولة منح " +
          "دور الصلاحيتين معًا، تظهر رسالة تأكيد تسمي التعارض بالتحديد بدلًا من السماح به " +
          "بصمت.",
      },
    ],
    howTo: [
      {
        title: "دعوة موظف جديد",
        steps: [
          "افتح تبويب المستخدمون (التبويب الافتراضي عند تحميل الصفحة).",
          'اختر "دعوة مستخدم".',
          "أدخل الاسم الظاهر والبريد الإلكتروني.",
          'اختر "إرسال الدعوة" — يظهر الشخص في الجدول فورًا بحالة "مدعو".',
        ],
      },
      {
        title: "إيقاف وصول شخص فورًا",
        steps: [
          "ابحث عن صفه في تبويب المستخدمين.",
          "افتح قائمة الإجراءات في صفه واختر إيقاف.",
          "تتغير حالته إلى موقوف وتُنهى أي جلسة يملكها حاليًا فورًا — فلا يمكنه متابعة العمل " +
            "على صفحة مفتوحة مسبقًا.",
        ],
      },
      {
        title: "إنشاء دور مخصص بمجموعة صلاحيات محددة",
        steps: [
          "افتح تبويب الأدوار والصلاحيات.",
          'اختر "إضافة دور مخصص" وأعطه اسمًا.',
          "في عمود الدور الجديد، فعّل كل صلاحية يجب أن يمتلكها.",
          "إذا كان التبديل سيمنح الدور صلاحيتي البناء والنشر معًا، أكّد تحذير فصل المهام فقط " +
            "إذا كان ذلك مقصودًا فعلًا.",
        ],
      },
    ],
    permissionsNote:
      "تتطلب الشاشة بأكملها صلاحية users:manage لمجرد ظهورها — من لا يملكها تظهر له رسالة " +
      '"لا تملك صلاحية الوصول إلى هذه الشاشة" بدل التبويبات. في بيانات العرض التجريبي، هذه ' +
      "الصلاحية مقصورة على دور مسؤول النظام الرئيسي فقط، لذا فهذه الشاشة اليوم مخصصة له فعليًا. " +
      "أما الزائر غير المسجل فيرى رسالة لتسجيل الدخول بدلًا من التبويبات أو رسالة رفض الصلاحية.",
    lastVerifiedAgainst:
      "apps/web/src/app/[locale]/(backoffice)/iam/page.tsx، iam-screen.tsx، مساحة الاسم iam في messages/en.json — 2026-09-10",
  },
};
