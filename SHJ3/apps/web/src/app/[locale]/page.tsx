import { redirect } from "next/navigation";

/**
 * Root page — redirects straight to the real staff sign-in flow.
 *
 * There is no marketing/landing content for this product: every real surface
 * lives behind `(backoffice)/` (staff, via `/sign-in`) or `(assistant)/`
 * (citizen, via a tenant-specific `/widget?channelKey=...` embed with no
 * bare, channel-less entry point of its own). Before the sign-in page existed
 * (B-2 through Phase F), this route was a deliberate placeholder stub — a
 * bare `<h1>`/`<p>` with no layout, kept only so `next build` produced a real
 * route — since nothing could be reached without a hand-minted session
 * anyway. Now that `/sign-in` is real, landing an anonymous visitor on that
 * unstyled placeholder reads as a broken app rather than the intentional
 * stub it was, so it redirects instead.
 */
export default async function HomePage({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<never> {
  const { locale } = await params;
  redirect(`/${locale}/sign-in`);
}
