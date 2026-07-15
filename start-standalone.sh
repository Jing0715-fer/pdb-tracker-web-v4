#!/bin/bash
# Start the PDB Tracker standalone production server.
# Architecture:
#   - Port 3001: Next.js API server (2 cluster workers, 384MB heap each)
#   - Port 3000: Static file server (2 cluster workers, 128MB heap each)
#     - Serves static HTML + JS/CSS chunks directly (no SSR overhead)
#     - Proxies /api/* requests to port 3001
#   - Caddy (port 81) proxies all traffic to port 3000
#
# The static file server avoids Next.js SSR memory spikes on concurrent
# requests. Cluster mode prevents Caddy keep-alive connection crashes.

cd /home/z/my-project/.next/standalone

# Start API server on port 3001
nohup env NODE_ENV=production PORT=3001 \
  DATABASE_URL="file:/home/z/my-project/db/pdb-tracker.db" \
  node --max-old-space-size=384 api-server.js > /home/z/my-project/dev.log 2>&1 &
APIPID=$!
disown $APIPID
echo "API server PID: $APIPID (port 3001)"

# Wait for API server to be ready
sleep 5

# Start static file server on port 3000
nohup bash -c 'cd /home/z/my-project/.next/standalone && exec node --max-old-space-size=128 custom-server.js' >> /home/z/my-project/dev.log 2>&1 &
STATICPID=$!
disown $STATICPID
echo "Static server PID: $STATICPID (port 3000)"

sleep 2
echo "Both servers started. Access via http://localhost:81 (Caddy gateway)"
