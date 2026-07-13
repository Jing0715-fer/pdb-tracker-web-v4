#!/usr/bin/env bash
# One-shot check: if standalone server is down, start it. Designed to be cron'd every minute.
# The sandbox kills background processes between bash commands, so this runs as a
# recurring cron job to ensure the server is always up.
cd /home/z/my-project

if curl -s -o /dev/null --max-time 5 http://localhost:3000/ 2>/dev/null; then
  # Server is up, nothing to do
  exit 0
fi

# Server is down — start it
echo "[$(date '+%H:%M:%S')] server down, starting standalone..." >> /home/z/my-project/prod-keepalive.log
pkill -9 -f "node server.js" 2>/dev/null
sleep 1

cd /home/z/my-project/.next/standalone
NEXT_TELEMETRY_DISABLED=1 \
NODE_ENV=production \
HOSTNAME=0.0.0.0 \
PORT=3000 \
DATABASE_URL="file:./db/custom.db" \
nohup node server.js > /home/z/my-project/prod.log 2>&1 &
disown
cd /home/z/my-project
sleep 3

if curl -s -o /dev/null --max-time 5 http://localhost:3000/ 2>/dev/null; then
  echo "[$(date '+%H:%M:%S')] server started OK" >> /home/z/my-project/prod-keepalive.log
else
  echo "[$(date '+%H:%M:%S')] server failed to start" >> /home/z/my-project/prod-keepalive.log
fi
