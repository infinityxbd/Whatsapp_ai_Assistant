<div align="center">

# 🤖 WhatsApp AI Auto-Reply Bot

**AI-powered WhatsApp chatbot with a full admin panel**

[![Node.js](https://img.shields.io/badge/Node.js-18+-green?logo=node.js)](https://nodejs.org)
[![WhatsApp Web.js](https://img.shields.io/badge/WhatsApp--Web.js-1.34-blue)](https://github.com/pedroslopez/whatsapp-web.js)
[![Gemini AI](https://img.shields.io/badge/Gemini-AI-yellow?logo=google)](https://ai.google.dev)
[![License](https://img.shields.io/badge/License-MIT-orange)](#)

[![Deploy](https://img.shields.io/badge/VPS%20Deploy-1%20Command-brightgreen)](#-vps-deployment-ubuntudebian)
[![Admin Panel](https://img.shields.io/badge/Admin%20Panel-Built--in-blueviolet)](#-admin-panel)
[![Factory Reset](https://img.shields.io/badge/Factory%20Reset-1%20Click-red)](#-features)

Made by **[Tarif Ahmed (infinityX)](https://t.me/infinityxbd)** · Co-Founder, Senior Admin @ SCEF

[![Telegram](https://img.shields.io/badge/Telegram-Contact-blue?logo=telegram)](https://t.me/infinityxbd)

</div>

---

## 📸 Overview

A complete WhatsApp AI bot solution with:
- 🧠 **Multi-provider AI** (Gemini, OpenAI-compatible, Anthropic, 1min.ai, custom REST) with automatic fallback
- 👥 **Group Conversation Intelligence** — hybrid AI flow that replies naturally, stays silent in private chats, and saves tokens
- 🧠 **AI User Memory** — remembers names, language/style, interests, preferences & facts per user
- 🌐 **Web Admin Panel** to control everything from browser
- 👥 **Group & Inbox control** with mute/archive ignore
- 🔐 **Pairing code login** — no QR scan needed
- 🏭 **Factory Reset** — one click full wipe
- 🖥️ **VPS Ready** — one command deployment

---

## ✨ Features

### 🤖 AI Bot
| Feature | Description |
|---------|-------------|
| Smart Replies | Multi-provider AI generates context-aware responses |
| Chat History | Last messages remembered per conversation (bounded) |
| Human-like Behavior | Random typing delay, seen receipts, online presence |
| Multi-provider Fallback | Add multiple AI APIs, auto-switches on failure |
| Group Intelligence | Replies to mentions/questions, silent in private chats |
| User Memory | AI extracts name, language, interests, preferences & facts |

### 👥 Chat Control
| Feature | Description |
|---------|-------------|
| Inbox Toggle | Enable/disable private message replies |
| Group Toggle | Enable/disable group message replies |
| Mute Ignore | Muted chats completely ignored (no reply, no seen) |
| Archive Ignore | Archived chats completely ignored |
| Block List | Block specific numbers or groups |

### 🛡️ Admin
| Feature | Description |
|---------|-------------|
| Web Dashboard | Beautiful dark-themed admin panel |
| Multi Admin | Add multiple WhatsApp numbers as admin |
| Chat Commands | Control bot via WhatsApp messages |
| Factory Reset | One-click full data wipe |
| API Manager | Add/remove/test multiple AI providers (Gemini, OpenAI, Anthropic, custom) |

---

## 🛠️ Tech Stack

```
Runtime    : Node.js 18+
WhatsApp   : whatsapp-web.js (Puppeteer + Chrome)
AI Engine  : Multi-provider (Gemini, OpenAI-compatible, Anthropic, 1min.ai, custom REST)
Admin Panel: Express.js + Vanilla HTML/CSS/JS
Database   : JSON file storage
Auth       : bcrypt + express-session
```

---

## 🚀 VPS Deployment (Ubuntu/Debian)

```bash
# 1. Download the zip and upload to your VPS
# 2. Extract and run setup
unzip whatsapp-bot.zip
cd whatsapp-bot
chmod +x setup.sh
./setup.sh
```

**That's it!** Setup script handles:
- System dependencies (Chrome, fonts, build tools)
- Node.js & npm packages
- `.env` configuration
- PM2 process manager (auto-restart on crash/reboot)

### After Setup:
1. Open `http://your-server-ip:3001/admin`
2. Login with password: `admin123`
3. Go to **WhatsApp Login** → Enter phone number → Get pairing code
4. Enter code on your WhatsApp → **Linked Devices → Link with Phone Number**
5. Bot is online!

---

## 💻 Local Development

```bash
# Clone the repo
git clone https://github.com/infinityxbd/Whatsapp_ai_Assistant.git
cd Whatsapp_ai_Assistant

# setup and install dependencies
bash set.sh
```

---



## 📱 Admin Panel

**URL:** `http://your-server:3001/admin`

**Default Password:** `admin123` (change after first login!)

### Dashboard Features:

| Tab | What it does |
|-----|-------------|
| ⚙️ Bot Settings | Bot name, AI personality prompt, power toggle, factory reset |
| 💬 Reply Settings | Toggle inbox/group replies |
| 🔑 API Keys | Add Gemini API keys, check health, enable/disable |
| 🚫 Block List | Block numbers/groups, search contacts |
| 📱 WhatsApp Login | Pairing code, restart, logout |
| 👤 Admin Users | Add WhatsApp numbers as admin |
| 🔐 Change Password | Update admin panel password |

---

## 💬 WhatsApp Chat Commands

Admin users can control the bot by sending commands in WhatsApp:

| Command | Description |
|---------|-------------|
| `/onbot` / `/offbot` | Turn bot ON / OFF |
| `/oninbox` / `/offinbox` | Enable / disable inbox replies |
| `/ongroup` / `/offgroup` | Enable / disable group replies |
| `/block 8801XXXXXXXXX` | Block a number |
| `/unblock 8801XXXXXXXXX` | Unblock a number |
| `/blocklist` | View all blocked numbers/groups |
| `/gplist` | List all groups with IDs |
| `/status` | Show bot status + uptime |
| `/restart` | Restart the bot |
| `/unsent` | Show recently unsent (deleted) messages |
| `/groupai on\|off` | Toggle hybrid AI group decision flow |
| `/groupmode` | Group behavior settings |
| `/analyzememory [number]` | Run AI memory analysis now |
| `/mymemory` | See what the bot remembers about you |
| `/forgetme` | Delete your stored memory data |
| `/help` | Show all commands |

---

## 📂 Project Structure

```
whatsapp-bot/
├── index.js                  # Entry point + watchdog + auto-clean
├── setup.sh / set.sh         # VPS one-click setup
├── update.sh                 # Safe update (keeps session & data)
├── .env                      # Environment variables
├── package.json
│
├── data/                     # Bot data (JSON files)
│   ├── config.json           # Bot settings & password
│   ├── ai_apis.json          # AI providers (encrypted keys)
│   ├── apikeys.json          # Legacy Gemini API keys
│   ├── blocklist.json        # Blocked numbers/groups
│   ├── adminusers.json       # Admin WhatsApp numbers
│   ├── memory.json           # AI User Memory profiles
│   ├── unsent.json           # Genuine "Delete for everyone" records
│   ├── fallbackmessages.json # Custom fallback reply list
│   ├── keystatus.json        # API key health status
│   └── group-decisions.jsonl # Group AI decision audit log
│
└── src/
    ├── bot/
    │   ├── whatsapp.js       # WhatsApp client + pairing + LID resolver
    │   ├── handler.js        # Message handler + hybrid AI group flow
    │   ├── commands.js       # All chat commands + auth
    │   ├── group-intel.js    # Group conversation intelligence
    │   ├── unsent.js         # Unsent (revoked) message store
    │   ├── cache.js          # Chrome cache auto-clean
    │   └── restart.js        # Soft restart helper
    │
    ├── ai/
    │   ├── service.js        # Provider loop + decision/memory engines
    │   └── providers/        # Gemini, OpenAI-compatible, Anthropic, 1min.ai, custom
    │
    ├── memory/
    │   └── service.js        # AI User Memory (extraction, merge, batching)
    │
    ├── admin/
    │   ├── server.js         # Express server setup
    │   ├── routes.js         # All API routes + factory reset
    │   ├── middleware.js     # Session auth middleware
    │   └── views/
    │       ├── login.html    # Admin login page
    │       └── dashboard.html # Full admin dashboard
    │
    └── storage/
        ├── store.js          # JSON file read/write
        └── encryption.js     # AES-256 key encryption
```

---

## ⚙️ Environment Variables (.env)

```env
# Admin Panel
ADMIN_PORT=3001
DEFAULT_ADMIN_PASSWORD=admin123
SESSION_SECRET=your-random-string-here

# Full restart interval in hours (default 4) — bot stops and auto-starts
# every N hours. All other auto-restarts (hourly soft restart, watchdog)
# are disabled.
RESTART_INTERVAL_HOURS=4
```

---

## 🔧 How It Works

```
User sends WhatsApp message
        ↓
Bot checks: muted? archived? blocked? bot enabled?
        ↓ (all clear)
User memory context built (name, language, interests...)
        ↓
Group message? → Group Intelligence (hybrid AI flow)
    • Name/@mention/reply-to-bot  → full AI reply, always
    • Open group question          → AI reply ("Keo aso?", "Sobai kemon aso?")
    • Unclear message              → main AI decides with recent context
    • Human-to-human conversation  → stay silent (no AI call)
        ↓
Typing simulation (natural delay)
        ↓
Reply generated by best AI provider (fallback if one fails)
        ↓
Reply sent + memory updated (batch AI analysis every N messages)
        ↓
Online presence kept alive (every 2 min)
```

---

## 📋 Requirements

| Requirement | Version |
|-------------|---------|
| Node.js | 18+ |
| Chrome/Chromium | Auto-installed by Puppeteer |
| RAM | 1GB+ recommended |
| OS | Ubuntu 20.04+ / Debian 11+ / any Linux |

---

## ⚠️ Disclaimer

This project is for **educational purposes only**. Use responsibly and comply with [WhatsApp's Terms of Service](https://whatsapp.com/legal/terms-of-service). The developer is not responsible for any misuse.

---

## 📞 Contact

| Platform | Link |
|----------|------|
| Developer | **Tarif Ahmed** |
| Telegram | [@infinityxbd](https://t.me/infinityxbd) |
| Role | Co-Founder, Senior Admin @ Student Cyber Expert Force (SCEF) |

---

## 📄 License

MIT License — Free to use, modify, and distribute.

---

<div align="center">

**⭐ Star this repo if you found it useful!**

Made with ❤️ by [Tarif Ahmed (infinityX)](https://t.me/infinityxbd)

</div>
