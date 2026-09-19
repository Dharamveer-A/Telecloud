# ☁️ TeleCloud

> **Transform your Telegram account into an unlimited, encrypted personal Cloud Drive.**
> Features Google Drive-like web explorer, Telegram Supergroup Forum sync, Brave-style download manager, instant thumbnail caching, AES-256-GCM encrypted folders, and public link sharing.

---

## 🌟 Overview

**TeleCloud** is a self-hosted cloud drive built on top of Telegram's MTProto API. Instead of paying monthly cloud subscription fees, TeleCloud uses Telegram's storage infrastructure to store your files while giving you a modern, responsive web application with zero friction.

### 🚀 Just Enter Your Mobile Number
When you or your users visit TeleCloud, getting started takes seconds:
1. **Enter Mobile Number**: Type in your phone number (e.g., `+1 555 123 4567`).
2. **Enter Telegram Code**: Enter the 5-digit verification code sent directly to your Telegram app.
3. **Done!** TeleCloud automatically:
   - Authenticates your session via Telegram MTProto.
   - Encrypts and securely stores your session.
   - Creates your root `📁 My Files` directory.
   - Automatically provisions a dedicated **TeleCloud Drive** supergroup with forum mode enabled on your Telegram account.

---

## ✨ Key Features

### 1. 📂 Native Telegram Drive Sync (Supergroup Forum Topics)
- **Automatic Organization**: Every folder you create in TeleCloud automatically maps to a **Forum Topic** in your private `TeleCloud Drive` supergroup in Telegram.
- **Direct Telegram Access**: Upload files through the TeleCloud web UI, and they immediately appear categorized in their respective topic thread in the Telegram app on your phone, tablet, and desktop!
- **Play & Share from Telegram**: You can view photos, play audio/video, or forward files to friends directly from Telegram without even opening the web app.
- **No Channel Limits**: By utilizing Telegram Supergroup Forum Topics rather than separate channels, you never hit Telegram's 10-channel creation limit.

### 2. ⚡ Brave-Style Download & Upload Manager
- **Top-Right Toolbar Dock**: An animated upload button sits in the top-right corner of the toolbar.
- **Real-Time SVG Circular Progress Ring**: Watch your transfers fill up smoothly in real-time as bytes upload or download.
- **Live Transfer Metrics**: Displays current throughput (e.g. `12.4 MB/s`), dynamic ETA countdowns, and pending transfer counters.
- **Minimize (`—`) & Pop-Out (`⤢`)**: Minimize the bottom transfers panel to dock it into the top-right button, exactly like the download manager in the Brave and Chrome browsers.
- **Brave-Style Dropdown**: Click the top-right button at any time to open a popover panel with full control over each transfer.

### 3. ⏸️ Full Pause & Resume Controls
- **Individual Controls**: Pause (`⏸`) and Resume (`▶`) any active transfer at any moment.
- **Pause All / Resume All**: One-click global controls in the panel and dropdown headers.
- **Graceful Network Handling**: Pausing an upload aborts the active socket without failing or cancelling the file, and retries seamlessly from where it left off when resumed.

### 4. 🏎️ Sub-Millisecond Navigation & Instant Thumbnails
- **Telegram Native Thumbnails**: Automatically extracts Telegram's native, lightweight auto-generated thumbnails (~5KB–20KB JPEG).
- **Persistent Disk Caching**: Thumbnails are cached on disk (`data/thumbnails/<fileId>.jpg`) for instant sub-millisecond loads.
- **Browser HTTP Caching**: Serves `Cache-Control: public, max-age=2592000, immutable`, allowing the browser to cache thumbnails on disk for 0ms loading on future visits.
- **IntersectionObserver Lazy Loading**: Only thumbnails within 250px of the viewport make network requests. Off-screen files make **zero network calls**, preventing network congestion.
- **Video Thumbnail Support**: Video files automatically display real video thumbnails with a sleek `▶` play badge.
- **Instant Folder Switching**: Switching between folders is instantaneous (< 1ms) powered by SQLite WAL mode and automatic `AbortController` cancellation for in-flight requests.

### 5. 🔒 Private Locked Folders (AES-256-GCM)
- **Zero-Knowledge Encryption**: Lock sensitive folders with a custom password.
- **Client-Side Encryption**: Files uploaded into locked folders are encrypted using AES-256-GCM before being sent to Telegram.
- **Encrypted at Rest**: Even if someone accesses your Telegram account, they cannot view or open the files without your folder password.

### 6. 🔗 Public Link Sharing
- **Share Files & Folders**: Generate public sharing links with a single click.
- **Security Controls**: Set optional passwords, expiration times (e.g., 1 hour, 1 day, 1 week), and download count limits.
- **Automatic Cloudflare Tunnel**: Built-in support for `cloudflared` automatically creates a public HTTPS link (e.g. `https://your-name.trycloudflare.com/share/...`) without configuring port forwarding or a static IP.

### 7. 🗑️ Trash Bin & Safe Deletion
- **Soft Deletion**: Deleted files and folders go to the Trash Bin, preventing accidental data loss.
- **One-Click Restore**: Restore any file or folder back to its original location.
- **Permanent Cleanup**: Emptying trash permanently cleans up database records and deletes the corresponding Telegram forum topics.

### 8. 📦 Automatic File Chunking (Bypass 2GB/4GB Limit)
- Any file larger than Telegram's per-message limit is automatically split into chunks, uploaded, and transparently reassembled on download.
- Large 4K movies, disk images, and archives are fully supported with streaming video playback.

---

## 🛠️ Architecture

```
                                  +------------------------+
                                  |    User Web Browser    |
                                  |  (React + TailwindCSS) |
                                  +-----------+------------+
                                              |
                                              | HTTP / REST
                                              v
+-----------------------------------------------------------------------------------+
| TeleCloud Backend (Node.js + Express + TypeScript)                               |
|                                                                                   |
|  +------------------+   +-------------------+   +-------------------------------+ |
|  |  SQLite Database |   | Thumbnail Cache   |   | Cloudflare Tunnel             | |
|  |  (better-sqlite3)|   | (data/thumbnails) |   | (Automated Public HTTPS URL)  | |
|  +------------------+   +-------------------+   +-------------------------------+ |
|                                                                                   |
|  +------------------------------------------------------------------------------+ |
|  | GramJS Telegram MTProto Client (Encrypted StringSession)                     | |
|  +------------------------------------------------------------------------------+ |
+------------------------------------------+----------------------------------------+
                                           |
                                           | MTProto (Encrypted Sockets)
                                           v
                        +------------------------------------+
                        |       Telegram Cloud Servers       |
                        |                                    |
                        |  +-------------------------------+ |
                        |  | "TeleCloud Drive" Supergroup  | |
                        |  |  - Topic: "Photos"            | |
                        |  |  - Topic: "Documents"         | |
                        |  |  - Topic: "Videos"            | |
                        |  +-------------------------------+ |
                        +------------------------------------+
```

---

## 🚀 Getting Started & Deployment

### Prerequisites
1. **Node.js**: Version 18.0.0 or higher.
2. **Telegram API Credentials**:
   - Go to [my.telegram.org](https://my.telegram.org).
   - Log in and click **API development tools**.
   - Create an app (any name) to obtain your `api_id` and `api_hash`. (Takes 1 minute, free forever).

---

### Step 1: Clone and Configure Environment

```bash
git clone https://github.com/your-username/telecloud.git
cd telecloud
```

#### Backend Setup:
```bash
cd backend
cp .env.example .env
```

Edit `backend/.env`:
```env
PORT=4000
DATA_DIR=./data

# From https://my.telegram.org:
TELEGRAM_API_ID=12345678
TELEGRAM_API_HASH=your_telegram_api_hash_here

# Generate two random 64-character hex strings:
# node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
JWT_SECRET=your_random_jwt_secret
MASTER_ENCRYPTION_KEY=your_random_master_encryption_key

# Optional: Set public URL for sharing links (Cloudflare tunnel auto-detects this if blank)
PUBLIC_URL=
```

Install dependencies:
```bash
npm install
npm run build
```

#### Frontend Setup:
```bash
cd ../frontend
npm install
npm run build
```

---

### Step 2: Running Locally

You can start both backend and frontend for development:

**Terminal 1 (Backend):**
```bash
cd backend
npm run dev
```

**Terminal 2 (Frontend):**
```bash
cd frontend
npm run dev
```

Open `http://localhost:5173` in your browser.

---

### Step 3: Production Deployment Options

#### Option A: Dedicated Server / VPS (Ubuntu / Debian / macOS) — Recommended
1. Build both frontend and backend:
   ```bash
   cd frontend && npm run build
   cd ../backend && npm run build
   ```
2. Run backend with `pm2` so it stays online 24/7:
   ```bash
   npm install -g pm2
   cd backend
   pm2 start dist/index.js --name telecloud-backend
   pm2 save
   pm2 startup
   ```
3. Serve frontend using Nginx or Caddy, or serve it directly via Express by copying `frontend/dist` to `backend/public`.

#### Option B: Automated Cloudflare Tunnel (Zero-Port Forwarding)
TeleCloud includes automatic Cloudflare Tunnel integration. When you run the backend, if `cloudflared` is installed on your machine or server:
```bash
# Ubuntu / Debian
curl -L --output cloudflared.deb https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb
sudo dpkg -i cloudflared.deb

# macOS
brew install cloudflared
```
TeleCloud will automatically spin up a public, encrypted HTTPS tunnel and log your public link in the console:
```
[tunnel] Public URL: https://your-unique-tunnel.trycloudflare.com
```

#### Option C: Cloud Hosting (Render, Railway, Fly.io, Oracle Cloud)
- **Oracle Cloud "Always Free" VM**: 4 ARM cores, 24GB RAM free forever. Best choice for personal cloud storage.
- **Railway / Render**: Deploy as a Web Service. Set environment variables in the dashboard. Make sure to attach a persistent volume to `./data` so your SQLite database and thumbnails persist between deploys.

---

## 📖 How to Use TeleCloud

### Logging In
1. Navigate to your TeleCloud web URL.
2. Enter your phone number including country code (e.g. `+1 555 123 4567`).
3. Enter the 5-digit verification code received in your Telegram app.
4. If you have Telegram 2-Step Verification enabled, enter your password.

### Uploading Files & Folders
- **Drag-and-Drop**: Drag any file or entire folder from your computer and drop it anywhere on the TeleCloud webpage.
- **Upload Wizard**: A dialog appears showing all files, sizes, and destination paths. You can rename files directly before uploading.
- **Upload Button**: Click **+ New** in the sidebar to upload individual files or entire directory trees.

### Managing Transfers
- Click the minimize button (`—`) in the transfers panel to dock it into the top-right Brave-style progress button.
- Click the top-right button to view the dropdown popover.
- Click `⏸ Pause All` or per-file `⏸` to pause uploads, and `▶ Resume` to continue.

### Locking a Folder
1. Navigate into any folder.
2. Click **🔒 Lock this folder** in the left sidebar.
3. Enter a password (minimum 6 characters).
4. All future files uploaded into this folder will be encrypted with AES-256-GCM before leaving your machine.

### Sharing with Friends
1. Right-click or click the three dots (`⋮`) on any file or folder.
2. Click **Share**.
3. Choose an optional password, expiration date, and download limit.
4. Click **Create Link** and copy the active public URL to send to your friends.

### Viewing in Telegram
1. Open your Telegram app on your phone or desktop.
2. You will see a group named **`TeleCloud Drive`**.
3. Tap on it to browse all your folders as Forum Topics.
4. All files uploaded in TeleCloud are accessible directly in their corresponding topics.

---

## 🛡️ Security & Privacy

- **Session Encryption**: Your Telegram session string is encrypted at rest using `MASTER_ENCRYPTION_KEY` with AES-256-GCM. Even if the SQLite database is accessed, your Telegram session cannot be decrypted without the master key.
- **Zero-Knowledge Folders**: Passwords for locked folders are never stored in plaintext. They are hashed using scrypt with unique salts.
- **No Third-Party Intermediaries**: All communication occurs directly between your server and Telegram's official MTProto API servers.

---

## 📄 License

MIT License. Feel free to use, modify, and distribute this project.
