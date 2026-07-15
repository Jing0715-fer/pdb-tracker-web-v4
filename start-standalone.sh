#!/bin/bash
# Start the PDB Tracker standalone production server.

cd /home/z/my-project/.next/standalone

# Ensure custom server scripts are present (build may overwrite them)
cp -f /home/z/my-project/server-scripts/custom-server.js ./custom-server.js
cp -f /home/z/my-project/server-scripts/api-server.js ./api-server.js
cat > ./server-wrap.js << 'WRAPPER'
process.on('uncaughtException', (err) => { console.error('[FATAL] uncaughtException:', err); });
process.on('unhandledRejection', (err) => { console.error('[FATAL] unhandledRejection:', err); });
process.on('SIGTERM', () => { console.error('[FATAL] SIGTERM'); process.exit(0); });
process.on('SIGINT', () => { console.error('[FATAL] SIGINT'); process.exit(0); });
require('./server.js');
WRAPPER

# Start API server on port 3001
nohup env NODE_ENV=production PORT=3001 \
  DATABASE_URL="file:/home/z/my-project/db/pdb-tracker.db" \
  node --max-old-space-size=384 api-server.js > /home/z/my-project/dev.log 2>&1 &
APIPID=$!
disown $APIPID
echo "API server PID: $APIPID (port 3001)"

sleep 5

# Start static file server on port 3000
nohup bash -c 'cd /home/z/my-project/.next/standalone && exec node --max-old-space-size=128 custom-server.js' >> /home/z/my-project/dev.log 2>&1 &
STATICPID=$!
disown $STATICPID
echo "Static server PID: $STATICPID (port 3000)"

sleep 2
echo "Both servers started. Access via http://localhost:81 (Caddy gateway)"
