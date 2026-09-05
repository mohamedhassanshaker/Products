#!/usr/bin/env bash
# Starts one `next start` instance over the already-built (non-standalone) .next in apps/web.
# Usage: start-one.sh <port> <unconf|proxy|noproxy>
#   unconf  = ops env entirely unset (gate short-circuits at isPlatformOpsConfigured)
#   proxy   = configured + trusted proxy 127.0.0.1, so X-Forwarded-For is honoured (allow path reachable)
#   noproxy = configured, no trusted proxy: caller IP unresolvable, always denied, full parse runs
set -u
cd /d/work/products/nextbot/apps/web
export NEXTBOT_DB_ENV=test
export NEXTBOT_DB_OWNER_TEST_URL=postgres://nextbot_test:nextbot_test_password@localhost:55432/nextbot_test
export NEXTBOT_DB_APP_TEST_URL=postgres://nextbot_app_test:app_test_pw_change_me@localhost:55432/nextbot_test
export NEXTBOT_DB_PLATFORM_TEST_URL=postgres://nextbot_platform_test:platform_test_pw_change_me@localhost:55432/nextbot_test
export NEXTBOT_DB_GATEWAY_TEST_URL=postgres://nextbot_gateway_test:gateway_test_pw_change_me@localhost:55432/nextbot_test
export NEXTBOT_SESSION_SECRET=test-session-secret-at-least-32-chars-long-xxxx
export NEXTBOT_KMS_MASTER_KEY=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef
case "$2" in
  proxy)
    export NEXTBOT_OPS_OPERATOR_TOKEN=test-operator-token-abc123
    export NEXTBOT_OPS_IP_ALLOWLIST=203.0.113.0/24
    export NEXTBOT_OPS_TRUSTED_PROXY_CIDRS=127.0.0.1
    ;;
  noproxy)
    export NEXTBOT_OPS_OPERATOR_TOKEN=test-operator-token-abc123
    export NEXTBOT_OPS_IP_ALLOWLIST=203.0.113.0/24
    ;;
esac
exec node node_modules/next/dist/bin/next start -p "$1"
