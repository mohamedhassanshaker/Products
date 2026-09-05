#!/usr/bin/env bash
# Boots apps/web's Next dev server on port 3210 against the already-running
# compose.test.yml Postgres (55432) + Redis (6379), with the Platform Manager ops
# console deliberately CONFIGURED so all four denial reasons are reachable.
set -a
NEXTBOT_DB_ENV=test
NEXTBOT_DB_OWNER_TEST_URL=postgres://nextbot_test:nextbot_test_password@localhost:55432/nextbot_test
NEXTBOT_DB_APP_TEST_URL=postgres://nextbot_app_test:app_test_pw_change_me@localhost:55432/nextbot_test
NEXTBOT_DB_PLATFORM_TEST_URL=postgres://nextbot_platform_test:platform_test_pw_change_me@localhost:55432/nextbot_test
NEXTBOT_DB_GATEWAY_TEST_URL=postgres://nextbot_gateway_test:gateway_test_pw_change_me@localhost:55432/nextbot_test
NEXTBOT_SESSION_SECRET=test-session-secret-please-change-me-32chars-min
NEXTBOT_WIDGET_SESSION_SECRET=test-widget-session-secret-please-change-32ch
NEXTBOT_KMS_MASTER_KEY=1111111111111111111111111111111111111111111111111111111111111111
NEXTBOT_REDIS_TEST_URL=redis://localhost:6379
NEXTBOT_OPS_OPERATOR_TOKEN=adversarial-verify-operator-token
NEXTBOT_OPS_IP_ALLOWLIST=127.0.0.1/32,10.0.0.0/24
NEXTBOT_OPS_TRUSTED_PROXY_CIDRS=203.0.113.1/32
PORT=3210
set +a
cd /d/work/products/nextbot/apps/web
exec ./node_modules/.bin/next dev --port 3210 --hostname 127.0.0.1
