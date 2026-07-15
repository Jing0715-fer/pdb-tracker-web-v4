#!/bin/bash
cd /home/z/my-project/.next/standalone
while true; do
  echo "[$(date)] Starting server..." >> /home/z/my-project/dev.log
  env NODE_ENV=production DATABASE_URL="file:/home/z/my-project/db/pdb-tracker.db" node --max-old-space-size=2048 server.js >> /home/z/my-project/dev.log 2>&1
  EXIT=$?
  echo "[$(date)] Server exited (code $EXIT), restarting in 3s..." >> /home/z/my-project/dev.log
  sleep 3
done
