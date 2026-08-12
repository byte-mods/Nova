#!/usr/bin/env bash
# Restarts the IDE with the DevTools port free.
# vite-plugin-electron relaunches Electron on every main-process rebuild, and the
# new process cannot bind the debug port until the old one has fully exited — so
# take everything down first, then wait for the port to answer.
set -u
PORT="${NOVA_DEBUG_PORT:-9223}"
VITE_PORT="${NOVA_VITE_PORT:-5179}"

pkill -f "Electron.app/Contents/MacOS/Electron" 2>/dev/null
for p in "$PORT" "$VITE_PORT"; do
  lsof -nP -iTCP:"$p" -sTCP:LISTEN -t 2>/dev/null | xargs -r kill -9 2>/dev/null
done
sleep 4

NOVA_DEBUG_PORT="$PORT" nohup npm run dev > /tmp/nova-dev.log 2>&1 &
for _ in $(seq 1 90); do
  if curl -s --max-time 2 "http://localhost:${PORT}/json/list" 2>/dev/null | grep -q "localhost:${VITE_PORT}"; then
    echo "app ready on :${PORT}"
    exit 0
  fi
  sleep 1
done
echo "app did not come up; see /tmp/nova-dev.log"
tail -20 /tmp/nova-dev.log
exit 1
