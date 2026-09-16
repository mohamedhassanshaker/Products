/** Meta's real field for the receiving number:
 *  `entry[].changes[].value.metadata.phone_number_id`. Pure, defensive extraction — never
 *  throws on a malformed/partial payload; returns `null` so the caller can acknowledge and
 *  log rather than crash (api.md §10.1 rule 4). */
export function extractPhoneNumberId(payload: unknown): string | null {
  if (typeof payload !== "object" || payload === null) return null;
  const entries = (payload as { entry?: unknown }).entry;
  if (!Array.isArray(entries)) return null;

  for (const entry of entries) {
    const changes = (entry as { changes?: unknown } | null)?.changes;
    if (!Array.isArray(changes)) continue;
    for (const change of changes) {
      const phoneNumberId = (
        change as { value?: { metadata?: { phone_number_id?: unknown } } } | null
      )?.value?.metadata?.phone_number_id;
      if (typeof phoneNumberId === "string" && phoneNumberId.length > 0) return phoneNumberId;
    }
  }
  return null;
}
