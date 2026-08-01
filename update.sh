#!/bin/bash
# ─── Safe Update Script ───
# Updates bot WITHOUT deleting WhatsApp session or data
# Developer: Tarif Ahmed (infinityX)

set -e
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'
ok()   { echo -e "${GREEN}✅ $1${NC}"; }
warn() { echo -e "${YELLOW}⚠️  $1${NC}"; }
fail() { echo -e "${RED}❌ $1${NC}"; }

echo "═══════════════════════════════════════════════════"
echo "   🔄 WhatsApp AI Bot — Safe Update"
echo "═══════════════════════════════════════════════════"
echo ""

# ── Step 1: Stop bot ──
echo "🛑 Step 1: Stopping bot..."
pkill -f "node index.js" 2>/dev/null || true
pkill -f chrome 2>/dev/null || true
sleep 2
ok "Bot stopped"

# ── Step 2: Backup important files ──
echo ""
echo "📦 Step 2: Backing up session & data..."
BACKUP_DIR="/tmp/bot-backup-$(date +%s)"
mkdir -p "$BACKUP_DIR"

# Backup WhatsApp session
if [ -d ".wwebjs_auth" ]; then
  cp -r .wwebjs_auth "$BACKUP_DIR/"
  ok "WhatsApp session backed up"
fi

# Backup data files
if [ -d "data" ]; then
  cp -r data "$BACKUP_DIR/"
  ok "Data files backed up"
fi

# Backup .env
if [ -f ".env" ]; then
  cp .env "$BACKUP_DIR/"
  ok ".env backed up"
fi

# ── Step 3: Pull latest code ──
echo ""
echo "📥 Step 3: Pulling latest code..."
git fetch origin main
git reset --hard origin/main
ok "Code updated to latest"

# ── Step 4: Restore session & data ──
echo ""
echo "♻️ Step 4: Restoring session & data..."

# Restore WhatsApp session
if [ -d "$BACKUP_DIR/.wwebjs_auth" ]; then
  rm -rf .wwebjs_auth
  cp -r "$BACKUP_DIR/.wwebjs_auth" .
  ok "WhatsApp session restored"
fi

# Restore data files
if [ -d "$BACKUP_DIR/data" ]; then
  # Only copy files that don't exist in current data/
  for f in "$BACKUP_DIR/data/"*; do
    fname=$(basename "$f")
    if [ ! -f "data/$fname" ]; then
      cp "$f" "data/"
      echo "   ↳ Restored: $fname"
    fi
  done
  ok "Data files restored (existing files kept)"
fi

# Restore .env if missing
if [ ! -f ".env" ] && [ -f "$BACKUP_DIR/.env" ]; then
  cp "$BACKUP_DIR/.env" .
  ok ".env restored"
fi

# ── Step 5: Install new dependencies ──
echo ""
echo "📦 Step 5: Installing dependencies..."
npm install --production
ok "Dependencies updated"

# ── Step 6: Start bot ──
echo ""
echo "🚀 Step 6: Starting bot..."
nohup node index.js > bot.log 2>&1 &
BOT_PID=$!
echo "   PID: $BOT_PID"

# ── Wait for startup ──
echo "⏳ Waiting for bot..."
for i in $(seq 1 30); do
    if grep -q "ONLINE\|QR ready\|Bot ONLINE" bot.log 2>/dev/null; then
        break
    fi
    sleep 1
done

echo ""
echo "═══════════════════════════════════════════════════"
if grep -q "ONLINE\|QR ready" bot.log 2>/dev/null; then
    echo "   ✅ Bot updated and running!"
else
    echo "   ⚠️  Bot started, check logs: tail -f bot.log"
fi
echo ""
echo "   🌐 Admin Panel: http://YOUR_VPS_IP:3001/admin"
echo "   📋 Logs: tail -f bot.log"
echo "   🛑 Stop: npm stop"
echo "═══════════════════════════════════════════════════"

# Cleanup backup
rm -rf "$BACKUP_DIR"
