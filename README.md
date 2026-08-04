generatesminiiv align="center">

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
- 🧠 **Gemini,Open AI and any platform with custom  AI** powered smart replies with chat history
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
| Smart Replies |Custom GeminiesI generates context-aware responses |
| Chat History | Last 7 messages remembered per conversation |
| Human-like Behavior | Random typing delay (1-10s), seen receipts, online presence |
| Multi-key Fallback | Add multiple API keys, auto-switches on failure |

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
| API Key Manager | Add/remove/test Gemini API keys |

---

## 🛠️ Tech Stack

```
Runtime    : Node.js 18+
WhatsApp   : whatsapp-web.js (Puppeteer + Chrome)
AI Engine  : Google Gemini API
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
cd whatsapp_ai_Assistant

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
| `/onbot` | Turn bot ON |
| `/offbot` | Turn bot OFF |
| `/oninbox` | Enable inbox replies |
| `/offinbox` | Disable inbox replies |
| `/ongroup` | Enable group replies |
| `/offgroup` | Disable group replies |
| `/block 8801XXXXXXXXX` | Block a number |
| `/unblock 8801XXXXXXXXX` | Unblock a number |
| `/blocklist` | View all blocked numbers/groups |
| `/gplist` | List all groups with IDs |
| `/status` | Show bot status + uptime |
| `/help` | Show all commands |

---

## 📂 Project Structure

```
whatsapp-bot/
├── index.js                  # Entry point + auto-clean
├── setup.sh                  # VPS one-click setup
├── .env                      # Environment variables
├── package.json
│
├── data/                     # Bot data (JSON files)
│   ├── config.json           # Bot settings & password
│   ├── apikeys.json          # Gemini API keys
│   ├── blocklist.json        # Blocked numbers/groups
│   ├── adminusers.json       # Admin WhatsApp numbers
│   └── keystatus.json        # API key health status
│
└── src/
    ├── bot/
    │   ├── whatsapp.js       # WhatsApp client + pairing
    │   ├── handler.js        # Message handler + mute/archive check
    │   └── commands.js       # All chat commands + auth
    │
    ├── ai/
    │   └── gemini.js         # Gemini AI + multi-key fallback
    │
    ├── admin/
    │   ├── server.js         # Express server setup
    │   ├── routes.js         # All API routes + factory reset
    │   ├── middleware.js      # Session auth middleware
    │   └── views/
    │       ├── login.html    # Admin login page
    │       └── dashboard.html # Full admin dashboard
    │
    └── storage/
        └── store.js          # JSON file read/write
```

---

## ⚙️ Environment Variables (.env)

```env
# Admin Panel
ADMIN_PORT=3001
DEFAULT_ADMIN_PASSWORD=admin123
SESSION_SECRET=your-random-string-here

# WhatsApp (your phone number with country code, no +)
WHATSAPP_PHONE=8801XXXXXXXXX
```

---

## 🔧 How It Works

```
User sends WhatsApp message
        ↓
Bot checks: muted? archived? blocked? bot enabled?
        ↓ (all clear)
Typing simulation (random 1-10s delay)
        ↓
Message sent to Gemini AI with chat history
        ↓
AI response sent back to user
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
