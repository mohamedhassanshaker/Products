-- QA D1 fix (BL-15 retry 1): the WhatsApp channel config screen's missing
-- "Webhook" tab (screen inventory B.2.3) needs real, persisted state to render —
-- verification status/timestamp and last-inbound-event timestamp — rather than a
-- fabricated always-"Verified" badge. Additive only: three new nullable/defaulted
-- columns on the existing `meta_business_account` table, no existing column
-- altered or dropped, no data loss.

CREATE TYPE whatsapp_webhook_verification_status AS ENUM ('Pending', 'Verified', 'Failed');

ALTER TABLE meta_business_account
  ADD COLUMN webhook_verification_status whatsapp_webhook_verification_status NOT NULL DEFAULT 'Pending',
  ADD COLUMN webhook_verified_at timestamptz,
  ADD COLUMN last_event_received_at timestamptz;
