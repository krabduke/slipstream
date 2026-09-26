#!/bin/bash
# Stops the engine by pid file and waits for it to exit. The cron watchdog
# restarts it within 5 minutes; run run-engine.sh to restart at once.
cd "$(dirname "$0")" || exit 1
[ -f engine.pid ] || { echo "no engine.pid"; exit 0; }
pid=$(cat engine.pid)
if kill -0 "$pid" 2>/dev/null && tr '\0' ' ' < "/proc/$pid/cmdline" | grep -q "engine.mjs"; then
  kill -TERM "$pid"
  for _ in $(seq 1 20); do kill -0 "$pid" 2>/dev/null || break; sleep 0.5; done
  kill -0 "$pid" 2>/dev/null && kill -KILL "$pid"
  echo "stopped engine pid $pid"
fi
rm -f engine.pid
