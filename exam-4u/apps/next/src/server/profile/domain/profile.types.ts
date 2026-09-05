/** `GET /api/profile` / `PATCH /api/profile` response shape (FR-IAM-4). `pictureKey` is the raw
 * internal storage key, not a URL — a client turns it into a browser-loadable URL via
 * `POST /api/files/sign` (this dispatch's own `files` module), matching legacy's identical two-step
 * "storage key, then sign it" flow. */
export interface ProfileSummary {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  phone: string | null;
  occupation: string | null;
  companyName: string | null;
  country: string | null;
  educationLevelId: number | null;
  pictureKey: string | null;
}
