/**
 * Slug auto-suggestion algorithm (UX_GUIDELINES §5.1 create-deployment step 2):
 * lowercase, spaces → hyphens, strip characters outside `[a-z0-9-]`, ensure
 * the result starts with a letter (prefix `d` if the name starts with a digit).
 */
export function slugify(name: string): string {
  let slug = name
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');

  if (/^[0-9]/.test(slug)) {
    slug = `d${slug}`;
  }

  return slug.slice(0, 48);
}

/** Client mirror of `TENANT_SLUG_INVALID` (2–48 chars, starts with a letter). */
export const SLUG_PATTERN = /^[a-z][a-z0-9-]{1,47}$/;
