#!/bin/bash
# Start the PDB Tracker standalone production server.
# Ensures DB config + DB file are in place before starting.

cd /home/z/my-project/.next/standalone

# Ensure custom server scripts are present (build may overwrite them)
cp -f /home/z/my-project/server-scripts/custom-server.js ./custom-server.js 2>/dev/null
cp -f /home/z/my-project/server-scripts/api-server.js ./api-server.js 2>/dev/null
cat > ./server-wrap.js << 'WRAPPER'
process.on('uncaughtException', (err) => { console.error('[FATAL] uncaughtException:', err); });
process.on('unhandledRejection', (err) => { console.error('[FATAL] unhandledRejection:', err); });
process.on('SIGTERM', () => { console.error('[FATAL] SIGTERM'); process.exit(0); });
process.on('SIGINT', () => { console.error('[FATAL] SIGINT'); process.exit(0); });
require('./server.js');
WRAPPER

# ── Ensure DB is set up ────────────────────────────────────────────────────
# The DB config file tells the server which SQLite file to use.
mkdir -p .hermes db
# Always sync the config from the canonical location (in case it was updated)
if [ -f /home/z/my-project/.hermes/db-config.json ]; then
  cp /home/z/my-project/.hermes/db-config.json .hermes/db-config.json
else
  # Create a default config pointing to pdb-tracker.db
  cat > .hermes/db-config.json << 'CFG'
{
  "dbPath": "file:/home/z/my-project/db/pdb-tracker.db",
  "confirmed": true,
  "updatedAt": "2026-07-15T00:00:00.000Z"
}
CFG
fi

# Ensure the DB file exists and has schema. If the main project's pdb-tracker.db
# exists and is non-empty, copy it to standalone. Otherwise copy custom.db
# (which always has the schema) as a fallback.
MAIN_DB="/home/z/my-project/db/pdb-tracker.db"
CUSTOM_DB="/home/z/my-project/db/custom.db"
STANDALONE_DB="./db/pdb-tracker.db"

if [ -f "$MAIN_DB" ] && [ -s "$MAIN_DB" ]; then
  cp "$MAIN_DB" "$STANDALONE_DB"
elif [ -f "$CUSTOM_DB" ] && [ -s "$CUSTOM_DB" ]; then
  cp "$CUSTOM_DB" "$STANDALONE_DB"
fi

# Ensure .env points to the correct DB
echo 'DATABASE_URL=file:/home/z/my-project/db/pdb-tracker.db' > .env

# Ensure prisma schema is available (for prisma db push if needed)
mkdir -p prisma
cp /home/z/my-project/prisma/schema.prisma prisma/schema.prisma 2>/dev/null

# ── Start API server on port 3001 ──────────────────────────────────────────
nohup env NODE_ENV=production PORT=3001 \
  DATABASE_URL="file:/home/z/my-project/db/pdb-tracker.db" \
  node --max-old-space-size=384 api-server.js > /home/z/my-project/dev.log 2>&1 &
APIPID=$!
disown $APIPID
echo "API server PID: $APIPID (port 3001)"

sleep 5

# ── Start static file server on port 3000 ──────────────────────────────────
nohup bash -c 'cd /home/z/my-project/.next/standalone && exec node --max-old-space-size=128 custom-server.js' >> /home/z/my-project/dev.log 2>&1 &
STATICPID=$!
disown $STATICPID
echo "Static server PID: $STATICPID (port 3000)"

sleep 2
echo "Both servers started. Access via http://localhost:81 (Caddy gateway)"
