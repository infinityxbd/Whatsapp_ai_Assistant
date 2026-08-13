#!/bin/bash
# Developed by Tarif Ahmed (infinityX)
# Telegram: https://t.me/infinityxbd
#
# One-command setup for the WhatsApp AI Bot.
# - Installs ALL Chrome/Puppeteer system libraries (correct names)
# - Auto-detects package manager (apt / dnf / yum / apk / pacman)
# - Verifies the browser ACTUALLY launches; repairs corrupt Puppeteer cache
# - Installs a distro Chromium as a reliable fallback when available
# - Low-memory friendly (quiet installs, no heavy concurrent work)
# - Never aborts on a single package failure
# - Frees busy admin port (fixes EADDRINUSE)
# - Starts the bot and verifies it came online

set -u

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

# ── Privilege detection ──
if [ "$(id -u)" = "0" ]; then
    AS_ROOT=""
    RUN_AS="root"
elif command -v sudo >/dev/null 2>&1; then
    AS_ROOT="sudo"
    RUN_AS="non-root (via sudo)"
else
    AS_ROOT=""
    RUN_AS="non-root (no sudo)"
fi
ok "Running as: $RUN_AS"

asRoot() {
    $AS_ROOT "$@"
}

# ── Detect package manager ──
if command -v apt-get &>/dev/null; then
    PM="apt-get"
elif command -v dnf &>/dev/null; then
    PM="dnf"
elif command -v yum &>/dev/null; then
    PM="yum"
elif command -v apk &>/dev/null; then
    PM="apk"
elif command -v pacman &>/dev/null; then
    PM="pacman"
else
    fail "No supported package manager found"
    exit 1
fi
ok "Package manager: $PM"

# ═══════════════════════════════════════════════════════
# 0) Light system info (for low-VPS awareness)
# ═══════════════════════════════════════════════════════
if [ -f /proc/meminfo ]; then
    MEM_KB=$(awk '/MemTotal:/{print $2}' /proc/meminfo)
    MEM_MB=$((MEM_KB / 1024))
    [ "$MEM_MB" -gt 0 ] && ok "Memory: ${MEM_MB} MB total"
fi

# Fix an interrupted dpkg/apt state (common after a VPS crash or a cut-off
# install — otherwise every later apt command fails with "dpkg was interrupted").
# Lightweight: only acts if there actually IS a broken package state.
repair_apt_state() {
    [ "$PM" != "apt-get" ] && return 0
    if ! dpkg -l 2>/dev/null | grep -qE '^i[^i]' ; then
        return 0
    fi
    warn "Detected an interrupted package install — repairing..."
    asRoot dpkg --configure -a &>/tmp/bot-dpkg.log || true
    asRoot apt-get -f install -y -qq &>/tmp/bot-fix.log || true
    if dpkg -l 2>/dev/null | grep -qE '^i[^i]'; then
        warn "Some packages still need manual attention, but continuing anyway."
    else
        ok "Package state repaired"
    fi
}

# ═══════════════════════════════════════════════════════
# 1) Install system libraries for Chrome/Puppeteer
# ═══════════════════════════════════════════════════════
echo ""
echo "📦 Installing system dependencies for Chrome/Puppeteer..."

# Debian/Ubuntu — correct, complete list for modern Chrome.
# NOTE: it is libatk-bridge2.0-0 (NOT "libatkbridge2.0-0").
DEB_PKGS=(
    libnss3 libnspr4 libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2
    libxkbcommon0 libxcomposite1 libxdamage1 libxrandr2 libgbm1
    libasound2 libpango-1.0-0 libcairo2 libatspi2.0-0
    fonts-liberation xdg-utils wget curl libxshmfence1 libx11-xcb1
    libxcb1 libxext6 libxfixes3 libglib2.0-0 libdbus-1-3
    libfontconfig1 libfreetype6 ca-certificates
)

# Maps a missing .so file to the Debian package that provides it.
SO_TO_DEB=(
    "libnspr4.so:libnspr4" "libnss3.so:libnss3" "libnssutil3.so:libnss3"
    "libsmime3.so:libnss3" "libatk-1.0.so.0:libatk1.0-0"
    "libatk-bridge-2.0.so.0:libatk-bridge2.0-0" "libatspi.so.0:libatspi2.0-0"
    "libXdamage.so.1:libxdamage1" "libXcomposite.so.1:libxcomposite1"
    "libxkbcommon.so.0:libxkbcommon0" "libasound.so.2:libasound2"
    "libXrandr.so.2:libxrandr2" "libgbm.so.1:libgbm1" "libcups.so.2:libcups2"
    "libpango-1.0.so.0:libpango-1.0-0" "libpangocairo-1.0.so.0:libpango-1.0-0"
    "libpangoft2-1.0.so.0:libpango-1.0-0" "libcairo.so.2:libcairo2"
    "libxshmfence.so.1:libxshmfence1" "libx11-xcb.so.1:libx11-xcb1"
    "libdrm.so.2:libdrm2" "libfontconfig.so.1:libfontconfig1"
    "libfreetype.so.6:libfreetype6" "libglib-2.0.so.0:libglib2.0-0"
    "libdbus-1.so.3:libdbus-1-3" "libgdk_pixbuf-2.0.so.0:libgdk-pixbuf-2.0-0"
    "libgdk_pixbuf.so.0:libgdk-pixbuf-2.0-0" "libX11.so.6:libx11-6"
    "libXt.so.6:libxt6" "libXss.so.1:libxss1" "libatspi-1.0.so.0:libatspi1.0-0"
)

install_deb() {
    local missing=() pkg
    for pkg in "${DEB_PKGS[@]}"; do
        if ! dpkg -s "$pkg" &>/dev/null; then
            missing+=("$pkg")
        fi
    done

    if [ ${#missing[@]} -eq 0 ]; then
        ok "All system libraries already installed"
        return 0
    fi

    warn "Installing ${#missing[@]} missing packages..."

    # Refresh package lists first — required on a fresh VPS. Fail LOUDLY here
    # so a broken apt setup is never silently swallowed (the old script
    # continued anyway, and the bot then crashed with "error while loading
    # shared libraries: libasound.so.2").
    if ! asRoot apt-get update -qq &>/tmp/bot-apt-update.log; then
        warn "apt-get update failed — log tail:"
        tail -n 6 /tmp/bot-apt-update.log 2>/dev/null | sed 's/^/    /'
        warn "Continuing anyway — installs may fail if package lists are empty."
    fi

    # Batch first (fast). --no-install-recommends keeps the install small,
    # which matters on low-RAM / low-bandwidth VPSes.
    if asRoot apt-get install -y -qq --no-install-recommends "${missing[@]}" &>/tmp/bot-apt-batch.log; then
        ok "Installed ${#missing[@]} system packages"
        return 0
    fi

    warn "Batch install failed — retrying with --fix-missing:"
    tail -n 6 /tmp/bot-apt-batch.log 2>/dev/null | sed 's/^/    /'
    if asRoot apt-get install -y -qq --no-install-recommends --fix-missing "${missing[@]}" &>/tmp/bot-apt-batch2.log; then
        ok "Installed ${#missing[@]} system packages (--fix-missing)"
        return 0
    fi

    # Debian 13+ (trixie) and Ubuntu 24.04 renamed many libraries with a t64
    # suffix (libasound2 → libasound2t64, libnss3 → libnss3t64, ...). If the
    # plain name does not exist, try its t64 variant.
    warn "Batch failed — installing packages individually (with t64 fallback)..."
    local okc=0 failc=0
    for pkg in "${missing[@]}"; do
        if asRoot apt-get install -y -qq --no-install-recommends "$pkg" &>/tmp/bot-apt-single.log; then
            okc=$((okc + 1))
        elif asRoot apt-get install -y -qq --no-install-recommends "${pkg}t64" &>/tmp/bot-apt-single.log; then
            okc=$((okc + 1))
            ok "  Installed ${pkg}t64 (t64 variant of $pkg)"
        else
            failc=$((failc + 1))
            warn "  Could not install $pkg (continuing)"
        fi
    done
    [ "$okc" -gt 0 ] && ok "Installed $okc packages"
    [ "$failc" -gt 0 ] && warn "$failc package(s) skipped"
}

# ── Library repair helpers ──
# Install one library package, falling back to its Debian t64 variant
# (Debian 13+ / Ubuntu 24.04 renamed libasound2 → libasound2t64 etc.).
install_lib() {
    local pkg="$1"
    if asRoot apt-get install -y -qq --no-install-recommends "$pkg" &>/tmp/bot-lib.log; then
        return 0
    fi
    if [ "$pkg" != "${pkg}t64" ] && asRoot apt-get install -y -qq --no-install-recommends "${pkg}t64" &>/tmp/bot-lib.log; then
        return 0
    fi
    return 1
}

# Run ldd on a chrome binary and install whatever shared library it is
# missing, mapping the .so name to its Debian package (with t64 fallback).
# Works for BOTH the distro Chromium AND the Puppeteer-cached Chrome — the
# old script only repaired the system one, which is why fresh Debian installs
# ended up with /root/.cache/puppeteer/.../chrome failing to load libasound.so.2.
repair_chrome_libs() {
    local bin="$1" so deb="" m missing_libs=0
    [ -x "$bin" ] || return 1
    command -v ldd >/dev/null 2>&1 || return 0
    for so in $(ldd "$bin" 2>/dev/null | awk '/not found/{print $1}'); do
        missing_libs=1
        deb=""
        for m in "${SO_TO_DEB[@]}"; do
            if [ "${m%%:*}" = "$so" ]; then deb="${m##*:}"; break; fi
        done
        if [ -n "$deb" ]; then
            if install_lib "$deb"; then
                warn "  Installed $deb (was missing: $so)"
            else
                warn "  Could not install $deb (missing: $so)"
            fi
        else
            warn "  No package mapping for $so"
        fi
    done
    [ "$missing_libs" = "0" ] && return 0
    return 1
}

install_rpm() {
    local pkgs=(atk at-spi2-atk cups-libs libdrm libxkbcommon
        libXcomposite libXdamage libXrandr mesa-libgbm nss nss-util
        alsa-lib pango cairo at-spi2-core liberation-fonts wget curl)
    local missing=() pkg
    for pkg in "${pkgs[@]}"; do
        if ! rpm -q "$pkg" &>/dev/null; then missing+=("$pkg"); fi
    done
    if [ ${#missing[@]} -gt 0 ]; then
        asRoot $PM install -y "${missing[@]}" &>/tmp/bot-rpm.log \
            || asRoot $PM install -y "${missing[@]}" || true
        ok "System packages checked"
    else
        ok "All system packages already installed"
    fi
}

install_apk() {
    local pkgs=(atk at-spi2-atk cups-libs libdrm libxkbcommon
        libXcomposite libXdamage libXrandr mesa-gbm nss
        alsa-lib pango cairo at-spi2-core liberation-fonts wget curl)
    asRoot apk add --no-cache "${pkgs[@]}" &>/dev/null || true
    ok "System packages checked"
}

install_pacman() {
    local pkgs=(atk at-spi2-atk cups libdrm libxkbcommon
        libxcomposite libxdamage libxrandr mesa nss alsa-lib
        pango cairo ttf-liberation wget curl)
    asRoot pacman -Sy --noconfirm --needed "${pkgs[@]}" &>/dev/null || true
    ok "System packages checked"
}

case "$PM" in
    apt-get)
        repair_apt_state
        install_deb
        ;;
    yum|dnf) install_rpm ;;
    apk)     install_apk ;;
    pacman)  install_pacman ;;
esac

# ═══════════════════════════════════════════════════════
# 2) Browser verification & repair
# ═══════════════════════════════════════════════════════

# Fast check: does a chrome binary exist and load its shared libs?
chrome_ldd_ok() {
    [ -x "$1" ] || return 1
    if command -v ldd &>/dev/null; then
        ldd "$1" 2>/dev/null | grep -q "not found" && return 1
    fi
    return 0
}

# Real check: can the binary actually render a page?
chrome_launch_ok() {
    chrome_ldd_ok "$1" || return 1
    timeout 20 "$1" --headless=new --no-sandbox --disable-gpu \
        --disable-dev-shm-usage --disable-extensions \
        --dump-dom "data:text/html,<h1>bot-ok</h1>" 2>/dev/null \
        | grep -q "bot-ok"
}

find_cached_chrome() {
    local d ver bin
    for d in "$HOME/.cache/puppeteer/chrome" /root/.cache/puppeteer/chrome; do
        [ -d "$d" ] || continue
        for ver in "$d"/*/; do
            [ -d "$ver" ] || continue
            for bin in "$ver"chrome-linux64/chrome "$ver"chrome-linux/chrome; do
                [ -f "$bin" ] && echo "$bin"
            done
        done
    done
}

# Remove any cached Puppeteer Chrome that is corrupt/incomplete so the bot
# never tries to launch a broken browser.
echo ""
echo "🔍 Verifying Chrome browser builds..."
CORRUPT_REMOVED=0
while IFS= read -r bin; do
    [ -z "$bin" ] && continue
    if chrome_launch_ok "$bin"; then
        ok "Browser OK: $bin"
    else
        warn "Browser $bin cannot launch — repairing missing shared libraries..."
        repair_chrome_libs "$bin"
        if chrome_launch_ok "$bin"; then
            ok "Browser fixed: $bin"
        else
            warn "Broken/corrupt browser build detected, removing: $(dirname "$bin")"
            rm -rf "$(dirname "$bin")" 2>/dev/null
            CORRUPT_REMOVED=$((CORRUPT_REMOVED + 1))
        fi
    fi
done < <(find_cached_chrome | sort -u)

# Try to install a distro Chromium as a reliable primary browser.
SYS_CHROME=""
for c in chromium chromium-browser google-chrome google-chrome-stable; do
    command -v "$c" &>/dev/null && SYS_CHROME="$(command -v "$c")" && break
done

if [ -z "$SYS_CHROME" ]; then
    warn "No system Chrome found — trying to install distro Chromium (best-effort)..."
    case "$PM" in
        apt-get)
            # Debian ships a real chromium package; on Ubuntu it may be a snap
            # stub, in which case we simply fall back to the Puppeteer browser.
            asRoot apt-get install -y -qq chromium &>/tmp/bot-chromium.log \
                || asRoot apt-get install -y -qq chromium &>/tmp/bot-chromium.log || true
            ;;
        dnf|yum) asRoot $PM install -y chromium &>/dev/null || true ;;
        apk)     asRoot apk add --no-cache chromium &>/dev/null || true ;;
        pacman)  asRoot pacman -Sy --noconfirm --needed chromium &>/dev/null || true ;;
    esac
    for c in chromium chromium-browser google-chrome google-chrome-stable; do
        command -v "$c" &>/dev/null && SYS_CHROME="$(command -v "$c")" && break
    done
fi

if [ -n "$SYS_CHROME" ]; then
    if chrome_launch_ok "$SYS_CHROME"; then
        ok "System Chrome ready: $SYS_CHROME"
    else
        warn "System Chrome at $SYS_CHROME cannot launch (missing libs) — fixing..."
        repair_chrome_libs "$SYS_CHROME"
        if chrome_launch_ok "$SYS_CHROME"; then
            ok "System Chrome fixed"
        else
            warn "System Chrome still not launching — will rely on Puppeteer browser"
        fi
    fi
fi

# If no usable browser exists at all, let Puppeteer download a fresh one.
if ! command -v chromium >/dev/null 2>&1 \
   && ! command -v google-chrome >/dev/null 2>&1 \
   && [ -z "$(find_cached_chrome | head -1)" ]; then
    warn "No working browser found — downloading Puppeteer Chrome (may take a while)..."
    npx --yes puppeteer browsers install chrome &>/tmp/bot-browser-dl.log || true
    if [ -z "$(find_cached_chrome | head -1)" ]; then
        fail "Could not obtain a working browser. Re-run this script once network is stable."
    else
        ok "Puppeteer Chrome downloaded"
        # A freshly downloaded Chrome still needs the system libraries to
        # launch — install whatever ldd reports missing, then verify it runs.
        while IFS= read -r bin; do
            [ -z "$bin" ] && continue
            if chrome_launch_ok "$bin"; then
                ok "Browser OK: $bin"
            else
                warn "Fixing shared libraries for $bin..."
                repair_chrome_libs "$bin"
                if chrome_launch_ok "$bin"; then
                    ok "Browser fixed: $bin"
                else
                    warn "Browser still cannot launch: $bin"
                fi
            fi
        done < <(find_cached_chrome | sort -u)
    fi
fi

# Final report of which browser the bot will use.
BROWSER_OK=0
if [ -n "$SYS_CHROME" ] && chrome_launch_ok "$SYS_CHROME"; then
    ok "Bot will use system Chrome: $SYS_CHROME"
    BROWSER_OK=1
elif [ -n "$(find_cached_chrome | head -1)" ]; then
    ok "Bot will use cached Puppeteer Chrome: $(find_cached_chrome | head -1)"
    BROWSER_OK=1
fi

if [ "$BROWSER_OK" = "0" ]; then
    warn "No verified browser yet — Puppeteer will download one on first run."
    warn "Make sure outbound internet is available."
fi

# ═══════════════════════════════════════════════════════
# 3) Node.js
# ═══════════════════════════════════════════════════════
echo ""
if command -v node &>/dev/null; then
    ok "Node.js already installed: $(node -v)"
else
    warn "Node.js not found, installing..."
    if [ "$PM" = "apt-get" ]; then
        if command -v curl >/dev/null 2>&1; then
            if [ "$RUN_AS" = "root" ]; then
                bash -c "curl -fsSL https://deb.nodesource.com/setup_20.x | bash -" &>/tmp/bot-nodesource.log || true
            else
                bash -c "curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -" &>/tmp/bot-nodesource.log || true
            fi
        fi
        asRoot apt-get install -y -qq nodejs || true
    elif [ "$PM" = "dnf" ] || [ "$PM" = "yum" ]; then
        asRoot $PM install -y nodejs npm || true
    elif [ "$PM" = "apk" ]; then
        asRoot apk add --no-cache nodejs npm || true
    elif [ "$PM" = "pacman" ]; then
        asRoot pacman -Sy --noconfirm --needed nodejs npm || true
    fi
    if command -v node &>/dev/null; then
        ok "Node.js installed: $(node -v)"
    else
        fail "Node.js installation failed. Cannot continue."
        exit 1
    fi
fi

if ! command -v npm &>/dev/null; then
    fail "npm is not available. Cannot continue."
    exit 1
fi

# ═══════════════════════════════════════════════════════
# 4) npm dependencies (low-memory friendly)
# ═══════════════════════════════════════════════════════
echo ""
echo "📦 Installing npm dependencies..."
if [ -d "node_modules" ] && [ -f "node_modules/.package-lock.json" ]; then
    LOCAL_COUNT=$(ls node_modules/ 2>/dev/null | wc -l)
    REQ_COUNT=$(node -e "const p=require('./package.json'); console.log(Object.keys(p.dependencies).length)")
    if [ "$LOCAL_COUNT" -ge "$REQ_COUNT" ]; then
        ok "node_modules already installed ($LOCAL_COUNT packages, need $REQ_COUNT)"
    else
        warn "node_modules incomplete ($LOCAL_COUNT < $REQ_COUNT), installing..."
        npm install --prefer-offline --no-audit --no-fund || npm install --no-audit --no-fund
        ok "npm install complete"
    fi
else
    npm install --no-audit --no-fund || npm install --no-audit --no-fund
    ok "npm install complete"
fi

# ═══════════════════════════════════════════════════════
# 5) .env + data
# ═══════════════════════════════════════════════════════
echo ""
if [ ! -f ".env" ]; then
    SESSION_SEC=$(openssl rand -hex 32 2>/dev/null || head -c 64 /dev/urandom | base64)
    cat > .env << EOF
WHATSAPP_PHONE=your-phone-number
ADMIN_PORT=3001
DEFAULT_ADMIN_PASSWORD=admin123
SESSION_SECRET=${SESSION_SEC}
RESTART_INTERVAL_HOURS=4
EOF
    ok "Created .env with defaults (edit WHATSAPP_PHONE in .env)"
else
    ok ".env already exists"
fi

mkdir -p data
ok "data/ directory ready"

# ═══════════════════════════════════════════════════════
# 6) Stop old bot & free admin port (fixes EADDRINUSE)
# ═══════════════════════════════════════════════════════
echo ""
echo "🧹 Stopping any existing bot instance..."
pkill -f "node index.js" 2>/dev/null || true
pkill -f "chromium" 2>/dev/null || true
pkill -f "chrome" 2>/dev/null || true
sleep 2

ADMIN_PORT=$(grep -E '^ADMIN_PORT=' .env 2>/dev/null | cut -d= -f2)
ADMIN_PORT=${ADMIN_PORT:-3001}
if command -v fuser >/dev/null 2>&1; then
    asRoot fuser -k "${ADMIN_PORT}/tcp" 2>/dev/null || true
elif command -v lsof >/dev/null 2>&1; then
    for pid in $(lsof -t -i:"$ADMIN_PORT" 2>/dev/null); do
        kill -9 "$pid" 2>/dev/null || true
    done
fi
sleep 1
ok "Cleaned up old processes (port $ADMIN_PORT free)"

# ═══════════════════════════════════════════════════════
# 7) Start bot & verify
# ═══════════════════════════════════════════════════════
echo ""
echo "🚀 Starting bot..."
nohup node index.js > bot.log 2>&1 &
BOT_PID=$!
echo "   PID: $BOT_PID"

echo "⏳ Waiting for bot to start..."
for i in $(seq 1 30); do
    if grep -q "ONLINE\|QR ready\|Bot ONLINE" bot.log 2>/dev/null; then
        break
    fi
    if grep -q "❌ Client init error" bot.log 2>/dev/null; then
        break
    fi
    sleep 1
done

echo ""
echo "═══════════════════════════════════════════════════"
if grep -q "ONLINE\|QR ready" bot.log 2>/dev/null; then
    echo "   ✅ Bot is ONLINE!"
elif grep -q "❌ Client init error" bot.log 2>/dev/null; then
    fail "Bot failed to start the browser:"
    grep -m1 -A3 "❌ Client init error" bot.log
    echo ""
    echo "   Next steps:"
    echo "     cat bot.log"
    echo "     bash setup.sh   (re-run — it repairs browser issues)"
    echo ""
else
    echo "   ⚠️  Bot started, waiting for QR/ONLINE..."
    echo "   📋 Check: tail -f bot.log"
fi
echo ""
echo "   🌐 Admin Panel: http://YOUR_VPS_IP:${ADMIN_PORT}/admin"
echo "   🔐 Default Password: $(grep -E '^DEFAULT_ADMIN_PASSWORD=' .env 2>/dev/null | cut -d= -f2)"
echo "   📋 Logs: tail -f bot.log"
echo "   🛑 Stop: kill $BOT_PID"
echo "═══════════════════════════════════════════════════"
