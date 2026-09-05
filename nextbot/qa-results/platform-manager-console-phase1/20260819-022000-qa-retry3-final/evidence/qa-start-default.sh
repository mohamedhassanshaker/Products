#!/usr/bin/env bash
set -a
NEXTBOT_DB_ENV=test
NEXTBOT_DB_OWNER_TEST_URL=postgres://nextbot_test:nextbot_test_password@localhost:55432/nextbot_test
NEXTBOT_DB_APP_TEST_URL=postgres://nextbot_app_test:app_test_pw_change_me@localhost:55432/nextbot_test
NEXTBOT_DB_PLATFORM_TEST_URL=postgres://nextbot_platform_test:platform_test_pw_change_me@localhost:55432/nextbot_test
NEXTBOT_DB_GATEWAY_TEST_URL=postgres://nextbot_gateway_test:gateway_test_pw_change_me@localhost:55432/nextbot_test
NEXTBOT_SESSION_SECRET=test-session-secret-please-change-me-32chars-min
NEXTBOT_WIDGET_SESSION_SECRET=test-widget-session-secret-please-change-32ch
NEXTBOT_KMS_MASTER_KEY=1111111111111111111111111111111111111111111111111111111111111111
NEXTBOT_REDIS_TEST_URL=redis://127.0.0.1:56379
NEXTBOT_OPS_OPERATOR_TOKEN=qa-final-reverify-operator-token
NEXTBOT_OPS_IP_ALLOWLIST=10.0.0.0/24
# trusted proxy deliberately UNSET (project default)
set +a
cd /d/work/products/nextbot/apps/web
exec ./node_modules/.bin/next start --port 3312 --hostname 127.0.0.1
