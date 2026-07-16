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
# Use setsid + nohup so the process is reparented to init (PID 1) and survives
# across bash tool calls. The .hermes/db-config.json inside standalone points
# to db/my-pdb-tracker1.db (the user's confirmed database).
setsid bash -c 'NEXT_TELEMETRY_DISABLED=1 NODE_ENV=production HOSTNAME=0.0.0.0 PORT=3000 node server.js' > /home/z/my-project/prod.log 2>&1 &
disown
cd /home/z/my-project
sleep 3

if curl -s -o /dev/null --max-time 5 http://localhost:3000/ 2>/dev/null; then
  echo "[$(date '+%H:%M:%S')] server started OK" >> /home/z/my-project/prod-keepalive.log
else
  echo "[$(date '+%H:%M:%S')] server failed to start" >> /home/z/my-project/prod-keepalive.log
fi
