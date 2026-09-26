#!/bin/bash
# Starts the engine if it is not already running. Idempotent; run from cron
# every 5 minutes and @reboot. Layout on the host:
#   ~/slipstream-engine/engine.mjs   the bundle (apps/engine/dist)
#   ~/slipstream-engine/.env         DATABASE_URL etc., chmod 600
#   ~/slipstream-engine/engine.pid   pid of the running engine
#   ~/slipstream-engine/logs/        engine.log, watchdog.log
# The engine is tracked by pid file, not by matching command lines: a pattern
# also matches any shell whose command text mentions the path (2026-09-26:
# a pkill by pattern killed the ssh session running it).
cd "$(dirname "$0")" || exit 1
mkdir -p logs
if [ -f engine.pid ]; then
  pid=$(cat engine.pid)
  if kill -0 "$pid" 2>/dev/null && tr '\0' ' ' < "/proc/$pid/cmdline" 2>/dev/null | grep -q "engine.mjs"; then
    exit 0
  fi
fi
set -a; . ./.env; set +a
nohup "$HOME/.local/node/bin/node" --enable-source-maps "$PWD/engine.mjs" >> logs/engine.log 2>&1 &
echo $! > engine.pid
echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) started engine pid $!"
