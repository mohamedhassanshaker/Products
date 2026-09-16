import type { LocalizedGuideContent } from "./index.js";

/**
 * `/sign-in` — the real staff sign-in page (`app/[locale]/sign-in/page.tsx`), the route this
 * project's own doc comments named as missing since B-2 (`mint-session.ts`,
 * `PrismaCredentialRepository`'s own module comment).
 *
 * Filed under the `settings` group rather than `admin`: like `/settings/appearance`, this is
 * a real staff route that lives outside the `(backoffice)` layout, not one of that group's
 * management screens — `guide-registry.ts`'s own doc comment already describes `settings` as
 * "the one real staff route outside `(backoffice)`", and this entry is now the second.
 *
 * Reachable from the guide only *after* signing in (the Help icon lives inside the
 * authenticated shell) — this entry exists for the person who already has an account and
 * wants to understand the flow (a colleague talking a new starter through it, or a returning
 * user confused by the TOTP step), not as the on-ramp for someone who has never signed in at
 * all. That circularity is the same one `citizen-widget.ts`'s own entry names for its surface
 * — a real, honest limit of an in-product guide rather than a gap unique to this page.
 */
export const signIn: LocalizedGuideContent = {
  en: {
    title: "Sign in",
    purpose:
      "The real sign-in page for the Sharjah backoffice: email and password, then — for " +
      "roles that require it — a six-digit code from an authenticator app. Every other " +
      "gated screen in this system links here when you arrive without a session, carrying " +
      "you back to the page you actually wanted once you're signed in.",
    featureWalkthrough: [
      {
        heading: "Email and password",
        body:
          "Enter your work email and password, then select Sign in. A wrong email or " +
          "password shows the same message either way, on purpose — this page never " +
          "confirms whether a given email has an account.",
      },
      {
        heading: "Two-factor verification",
        body:
          "Roles that can publish agents or manage users must also enter a six-digit code " +
          "from an authenticator app (Google Authenticator, Microsoft Authenticator, or " +
          "similar) before the sign-in completes. Not every role sees this step — it only " +
          "appears when your account requires it.",
      },
      {
        heading: "Back to sign in",
        body:
          "On the verification step, this restarts the process from the password step — use " +
          "it if the code stops being accepted, or if you opened this step by mistake.",
      },
    ],
    howTo: [
      {
        title: "Sign in to the backoffice",
        steps: [
          "Go to /sign-in (or select Sign in on any screen that asks for one).",
          "Enter your email and password, then select Sign in.",
          "If asked, enter the current six-digit code from your authenticator app and select " +
            "Verify.",
          "You land on the page you originally asked for, or the Command centre if you " +
            "arrived directly.",
        ],
      },
      {
        title: "Recover from a rejected sign-in attempt",
        steps: [
          'A wrong email or password shows a plain "incorrect email or password" message — ' +
            "check both and try again.",
          "Several wrong attempts in a row temporarily locks the account; wait and try again " +
            "later, or contact an administrator.",
          'A wrong or expired verification code shows a plain "incorrect or expired" ' +
            "message — enter the current code from your authenticator app, or select " +
            '"Back to sign in" to restart.',
        ],
      },
    ],
    permissionsNote:
      "This page itself needs no permission — it is the one screen reachable with no " +
      "session at all. Whether the two-factor step appears depends on your account's roles, " +
      "not on anything you choose here.",
    lastVerifiedAgainst:
      "apps/web/src/app/[locale]/sign-in/page.tsx, sign-in-form.tsx, actions.ts, " +
      "messages/en.json's signIn namespace — 2026-09-10",
  },
  ar: {
    title: "تسجيل الدخول",
    purpose:
      "صفحة تسجيل الدخول الحقيقية للوحة تحكم الشارقة: البريد الإلكتروني وكلمة المرور، ثم — " +
      "للأدوار التي تتطلب ذلك — رمز مكوّن من ستة أرقام من تطبيق مصادقة. كل شاشة أخرى محمية " +
      "في هذا النظام تحيلك إلى هنا عند الوصول بلا جلسة تسجيل دخول، وتعيدك إلى الصفحة التي " +
      "طلبتها فعلًا بعد تسجيل الدخول.",
    featureWalkthrough: [
      {
        heading: "البريد الإلكتروني وكلمة المرور",
        body:
          "أدخل بريدك الإلكتروني الرسمي وكلمة المرور، ثم اختر تسجيل الدخول. يظهر البريد " +
          "الإلكتروني أو كلمة المرور الخاطئة بنفس الرسالة في الحالتين، عن قصد — لا تؤكد هذه " +
          "الصفحة أبدًا ما إذا كان بريد إلكتروني معيّن يملك حسابًا.",
      },
      {
        heading: "التحقق بخطوتين",
        body:
          "الأدوار القادرة على نشر الوكلاء أو إدارة المستخدمين يجب أن تُدخل أيضًا رمزًا " +
          "مكوّنًا من ستة أرقام من تطبيق مصادقة (مثل Google Authenticator أو Microsoft " +
          "Authenticator) قبل اكتمال تسجيل الدخول. لا تظهر هذه الخطوة لكل الأدوار — تظهر فقط " +
          "عندما يتطلبها حسابك.",
      },
      {
        heading: "العودة إلى تسجيل الدخول",
        body:
          "في خطوة التحقق، يعيد هذا العملية إلى خطوة كلمة المرور — استخدمه إذا توقف قبول " +
          "الرمز، أو إذا فتحت هذه الخطوة عن طريق الخطأ.",
      },
    ],
    howTo: [
      {
        title: "تسجيل الدخول إلى لوحة التحكم",
        steps: [
          "اذهب إلى /sign-in (أو اختر تسجيل الدخول من أي شاشة تطلب ذلك).",
          "أدخل بريدك الإلكتروني وكلمة المرور، ثم اختر تسجيل الدخول.",
          "إذا طُلب منك ذلك، أدخل الرمز الحالي المكوّن من ستة أرقام من تطبيق المصادقة ثم اختر " +
            "تحقّق.",
          "تصل إلى الصفحة التي طلبتها في الأصل، أو مركز القيادة إذا وصلت مباشرة.",
        ],
      },
      {
        title: "التعافي من محاولة تسجيل دخول مرفوضة",
        steps: [
          'يظهر بريد إلكتروني أو كلمة مرور خاطئة رسالة بسيطة "البريد الإلكتروني أو كلمة ' +
            'المرور غير صحيحة" — تحقق من كليهما وحاول مرة أخرى.',
          "عدة محاولات خاطئة متتالية تقفل الحساب مؤقتًا؛ انتظر وحاول لاحقًا، أو تواصل مع " +
            "مسؤول النظام.",
          'رمز تحقق خاطئ أو منتهي الصلاحية يظهر رسالة بسيطة "غير صحيح أو منتهي الصلاحية" — ' +
            'أدخل الرمز الحالي من تطبيق المصادقة، أو اختر "العودة إلى تسجيل الدخول" لإعادة ' +
            "البدء.",
        ],
      },
    ],
    permissionsNote:
      "هذه الصفحة نفسها لا تتطلب أي صلاحية — فهي الشاشة الوحيدة التي يمكن الوصول إليها بلا " +
      "أي جلسة تسجيل دخول. أما ظهور خطوة التحقق بخطوتين فيعتمد على أدوار حسابك، لا على أي " +
      "اختيار هنا.",
    lastVerifiedAgainst:
      "apps/web/src/app/[locale]/sign-in/page.tsx، sign-in-form.tsx، actions.ts، مساحة الاسم " +
      "signIn في messages/en.json — 2026-09-10",
  },
};
