import { NotFoundPage } from "@/src/lib/not-found-page";

/**
 * App-wide not-found boundary — what Next renders for any page path this app does not
 * implement, and for any `notFound()` call that isn't caught by a closer boundary.
 *
 * Exists so that the whole app's 404 surface emits the exact same bytes as the NFR-11
 * Platform Manager console's page-gate denial: both render `NotFoundPage()`, the same
 * static component, so a caller cannot tell "this `/internal/ops/**` path exists but
 * you were denied" apart from "no such path anywhere in this app". See
 * `src/lib/not-found-page.tsx`'s module doc for the leak this closes and the
 * measurements behind it.
 *
 * Replacing Next's built-in default 404 page is deliberate, not incidental: that
 * default carries its own distinct `<title>` ("404: This page could not be found.")
 * and markup, which would itself be a group-separating signal the moment the ops gate
 * stopped using it.
 */
export default function NotFound() {
  return <NotFoundPage />;
}
