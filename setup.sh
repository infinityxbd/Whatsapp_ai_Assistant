#!/bin/bash
# Developed by Tarif Ahmed (infinityX)
# Telegram: https://t.me/infinityxbd

set -e

echo "═══════════════════════════════════════════════════"
echo "   🤖 WhatsApp AI Bot — VPS Setup"
echo "   Developer: Tarif Ahmed (infinityX)"
echo "═══════════════════════════════════════════════════"

# ── Colors ──
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

ok()   { echo -e "${GREEN}✅ $1${NC}"; }
warn() { echo -e "${YELLOW}⚠️  $1${NC}"; }
fail() { echo -e "${RED}❌ $1${NC}"; }

# ── Detect package manager ──
if command -v apt-get &>/dev/null; then
    PM="apt-get"
elif command -v yum &>/dev/null; then
    PM="yum"
elif command -v dnf &>/dev/null; then
    PM="dnf"
elif command -v apk &>/dev/null; then
    PM="apk"
elif command -v pacman &>/dev/null; then
    PM="pacman"
else
    fail "No supported package manager found"
    exit 1
fi
ok "Package manager: $PM"

# ── Install system packages for Puppeteer/Chrome ──
echo ""
echo "📦 Installing system dependencies for Chrome/Puppeteer..."

install_deb() {
    local pkgs=(
        libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2 libxkbcommon0
        libxcomposite1 libxdamage1 libxrandr2 libgbm1 libnss3
        libasound2 libpango-1.0-0 libcairo2 libatspi2.0-0
        fonts-liberation xdg-utils wget curl
        libxshmfence1 libx11-xcb1 libxcb1 libxext6 libxfixes3
    )
    local missing=()
    for pkg in "${pkgs[@]}"; do
        if ! dpkg -s "$pkg" &>/dev/null; then
            missing+=("$pkg")
        fi
    done
    if [ ${#missing[@]} -gt 0 ]; then
        sudo apt-get update -qq
        sudo apt-get install -y -qq "${missing[@]}"
        ok "Installed ${#missing[@]} system packages"
    else
        ok "All system packages already installed"
    fi
}

install_rpm() {
    local pkgs=(
        atk at-spi2-atk cups-libs libdrm libxkbcommon
        libXcomposite libXdamage libXrandr mesa-libgbm nss
        alsa-lib pango cairo at-spi2-core
        liberation-fonts wget curl
    )
    local missing=()
    for pkg in "${pkgs[@]}"; do
        if ! rpm -q "$pkg" &>/dev/null; then
            missing+=("$pkg")
        fi
    done
    if [ ${#missing[@]} -gt 0 ]; then
        sudo $PM install -y "${missing[@]}"
        ok "Installed ${#missing[@]} system packages"
    else
        ok "All system packages already installed"
    fi
}

install_apk() {
    local pkgs=(
        atk at-spi2-atk cups-libs libdrm libxkbcommon
        libXcomposite libXdamage libXrandr mesa-gbm nss
        alsa-lib pango cairo at-spi2-core
        liberation-fonts wget curl
    )
    sudo apk add --no-cache "${pkgs[@]}" 2>/dev/null || true
    ok "System packages checked"
}

install_pacman() {
    local pkgs=(
        atk at-spi2-atk cups libdrm libxkbcommon
        libxcomposite libxdamage libxrandr mesa nss
        alsa-lib pango cairo at-spi2-atk
        ttf-liberation wget curl
    )
    sudo pacman -Sy --noconfirm --needed "${pkgs[@]}" 2>/dev/null || true
    ok "System packages checked"
}

case "$PM" in
    apt-get) install_deb ;;
    yum|dnf) install_rpm ;;
    apk)     install_apk ;;
    pacman)  install_pacman ;;
esac

# ── Install Node.js if not present ──
echo ""
if command -v node &>/dev/null; then
    NODE_VER=$(node -v)
    ok "Node.js already installed: $NODE_VER"
else
    warn "Node.js not found, installing..."
    if command -v apt-get &>/dev/null; then
        curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
        sudo apt-get install -y -qq nodejs
    elif command -v yum &>/dev/null || command -v dnf &>/dev/null; then
        curl -fsSL https://rpm.nodesource.com/setup_20.x | sudo bash -
        sudo $PM install -y nodejs
    elif command -v apk &>/dev/null; then
        sudo apk add --no-cache nodejs npm
    elif command -v pacman &>/dev/null; then
        sudo pacman -Sy --noconfirm nodejs npm
    fi
    ok "Node.js installed: $(node -v)"
fi

# ── Install npm dependencies ──
echo ""
echo "📦 Installing npm dependencies..."
if [ -d "node_modules" ] && [ -f "node_modules/.package-lock.json" ]; then
    LOCAL_COUNT=$(ls node_modules/ | wc -l)
    REQ_COUNT=$(node -e "const p=require('./package.json'); console.log(Object.keys(p.dependencies).length)")
    if [ "$LOCAL_COUNT" -ge "$REQ_COUNT" ]; then
        ok "node_modules already installed ($LOCAL_COUNT packages, need $REQ_COUNT)"
    else
        warn "node_modules incomplete ($LOCAL_COUNT < $REQ_COUNT), reinstalling..."
        npm install --prefer-offline
        ok "npm install complete"
    fi
else
    npm install
    ok "npm install complete"
fi

# ── Create .env if not exists ──
echo ""
if [ ! -f ".env" ]; then
    SESSION_SEC=$(openssl rand -hex 32 2>/dev/null || head -c 64 /dev/urandom | base64)
    cat > .env << EOF
WHATSAPP_PHONE=your-phone-number
ADMIN_PORT=3001
DEFAULT_ADMIN_PASSWORD=admin123
SESSION_SECRET=${SESSION_SEC}
EOF
    ok "Created .env with defaults (edit WHATSAPP_PHONE in .env)"
else
    ok ".env already exists"
fi

# ── Create data directory ──
mkdir -p data
ok "data/ directory ready"

# ── Stop any existing bot ──
echo ""
echo "🧹 Stopping any existing bot instance..."
pkill -f "node index.js" 2>/dev/null || true
pkill -f chrome 2>/dev/null || true
sleep 2
ok "Cleaned up old processes"

# ── Start bot ──
echo ""
echo "🚀 Starting bot..."
nohup node index.js > bot.log 2>&1 &
BOT_PID=$!
echo "   PID: $BOT_PID"

# ── Wait for startup ──
echo "⏳ Waiting for bot to start..."
for i in $(seq 1 30); do
    if grep -q "ONLINE" bot.log 2>/dev/null; then
        break
    fi
    sleep 1
done

echo ""
echo "═══════════════════════════════════════════════════"
if grep -q "ONLINE" bot.log 2>/dev/null; then
    echo "   ✅ Bot is ONLINE!"
else
    echo "   ⚠️  Bot started but may not be fully ready yet"
fi
echo ""
echo "   🌐 Admin Panel: http://YOUR_VPS_IP:3001/admin"
echo "   🔐 Default Password: admin123"
echo "   📋 Logs: tail -f bot.log"
echo "   🛑 Stop: kill $BOT_PID"
echo "═══════════════════════════════════════════════════"
