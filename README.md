# TeleCloud

A personal cloud drive built on top of your own Telegram account: folders,
password-locked private folders, previews, and automatic file-size
splitting so nothing is limited by Telegram's per-file cap — all wrapped
in a normal file-explorer UI.

## How it actually works (read this first)

- **Storage:** files are uploaded as normal messages into private Telegram
  channels ("storage modules") that this app creates for you automatically.
  Telegram doesn't charge for storage, so this scales very far — but it is
  *not* infinite, and it depends on your Telegram account staying in good
  standing. Using Telegram this way is outside what it was designed for;
  read Telegram's Terms of Service before relying on this for anything
  important, and keep real backups of anything irreplaceable.
- **Folders:** Telegram itself has no folder concept for files — the
  folder tree you see is metadata this app keeps in its own small
  database (`backend/data/db.json`). That file is what makes everything
  "look normally sorted." **Back it up separately from Telegram** —
  losing it means the app can no longer find your files inside Telegram,
  even though the raw messages are still there.
- **The 2GB/4GB limit:** any file bigger than Telegram's per-message cap
  is automatically split into multiple chunks, each sent as its own
  message, and silently reassembled on download. You always see and
  interact with one file.
- **"Modules":** once a storage channel accumulates a lot of files, new
  uploads automatically start going into a fresh channel. You never see
  this — the folder view is unaffected.
- **Locked folders:** files uploaded into a locked folder are encrypted
  (AES-256-GCM) client-request-side before ever reaching Telegram, using
  a key derived from the folder's password + this server's master key.
  **There is no password recovery** — if you forget a folder's password,
  its contents cannot be decrypted by anyone, including you.

## What's new: Drive-like UI, drag-and-drop, upload wizard

- **Layout** now looks like Google Drive: left sidebar with "+ New", a
  grid view (thumbnails for images, icons for everything else) with a
  list-view toggle, search-within-folder, and breadcrumbs.
- **Drag and drop anywhere on the page** — dropping files *or whole
  folders* (folder structure is preserved and recreated on the server)
  opens an **Upload Wizard** instead of uploading immediately.
- **Renaming before upload:** every file in the wizard shows an editable
  name field, pre-filled with its local filename — change it there if you
  want the stored copy named differently; leave it alone and it keeps the
  original name.
- **Big videos:** no special handling needed on your part — any file
  (video or otherwise) over Telegram's per-message limit is automatically
  split into chunks and reassembled transparently on download, exactly as
  described above. The wizard just tells you up front when that's about
  to happen.
- Folder-picker uploads (via "+ New → Upload folder") use the browser's
  native folder picker, so it works even without drag-and-drop.

## What's new: context menus, move, exact transfer speed, filters

- **Three-dot menu** on every folder and file (grid and list view): **Download**, **Move**, **Delete**.
  - Folder download zips its contents recursively. If a nested subfolder is itself locked, its files are skipped in the zip (a `LOCKED.txt` marks the spot) since the password isn't known at that point — open it directly in the app instead.
  - Folder delete is now properly **recursive** — it removes all subfolders and their files too (this was a real bug before: deleting a folder with subfolders used to silently orphan them in the database instead of actually removing them).
  - Move opens a small folder picker to choose the destination. Files can only move between two *unlocked* folders — a file's encryption key is tied to its original folder's password, so moving it into/out of a locked folder would either leave it silently unencrypted or permanently orphaned from its key. Download and re-upload instead if you need that.
- **Exact transfer speed:** uploads (in the Upload Wizard) and downloads (via the three-dot menu) now show live throughput (e.g. "4.2 MB/s") and ETA, not just a percentage bar — computed from a rolling 2-second window so it reflects current speed, not a diluted average. Downloads appear in a small panel docked bottom-right so they're visible even after closing whatever dialog started them.
- **Filters:** a filter bar under the toolbar has quick chips (Images, Videos, Audio, Documents) plus **"+ Custom filter"** — define your own by name-contains text, file extensions, and/or a size range (e.g. "Screenshots" = name contains "screenshot"; "Big videos" = extension mp4/mov + min size 500 MB). Custom filters are saved in your browser (localStorage), so they're per-device, not synced across browsers.

## Setup

### 1. Get Telegram API credentials (free, 2 minutes)
Go to https://my.telegram.org → "API development tools" → create an app.
You'll get an `api_id` and `api_hash`.

### 2. Backend
```bash
cd backend
cp .env.example .env
# edit .env: paste TELEGRAM_API_ID, TELEGRAM_API_HASH
# generate JWT_SECRET and MASTER_ENCRYPTION_KEY:
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
# paste that as MASTER_ENCRYPTION_KEY, and run again for a different
# random string to use as JWT_SECRET

npm install
npm run dev
```
Backend runs on `http://localhost:4000`.

### 3. Frontend
```bash
cd frontend
npm install
npm run dev
```
Open `http://localhost:5173`, enter your phone number, and log in with
the code Telegram sends you (same as logging into Telegram Desktop).

## Free hosting

The backend needs to run as a **persistent process** (it holds a live
connection to Telegram), so pure static/serverless hosts won't work for
it. Options, best first:

**Oracle Cloud "Always Free" tier** (recommended)
- Genuinely free forever, not a trial — a small VM (up to 4 ARM cores /
  24GB RAM on the Ampere shape) is enough for personal use.
- Install Node.js on the VM, `git clone` your project, run backend with
  `pm2` or a systemd service so it survives reboots, point a domain or
  just use the VM's IP.

**Render.com free web service**
- Easiest to deploy (`git push`, auto-builds), but the free tier sleeps
  after inactivity — first request after idling takes ~30s to wake up.
  Fine for personal use, annoying if you want instant access.

**Fly.io free allowance**
- Similar tradeoffs to Render; good Docker support if you containerize
  the backend.

For the **frontend**, since it's just static files after `npm run build`,
Vercel, Netlify, Cloudflare Pages, or GitHub Pages all work fully free —
just point its API calls (the `/api` proxy in `vite.config.ts`) at
wherever you hosted the backend.

## What's implemented vs. what's a scaffold

Implemented and working end-to-end: phone login (incl. 2FA), folder
create/browse/breadcrumbs, folder locking with real encryption, file
upload with automatic chunking across Telegram's size limit, automatic
storage-channel rotation, download/preview (images, video, audio, PDF),
delete.

Left as an exercise / noted in code comments, because they're genuinely
your call to make:
- **Hard-delete from Telegram.** Deleting a file/folder in the app
  currently only removes it from the local index — the underlying
  Telegram messages stay in the storage channel. Trivial to add
  (`client.deleteMessages`) but left out so nothing is destructive by
  default while you're still testing.
- **Re-encrypting existing files** when you lock a folder that already
  has files in it — currently only new uploads after locking are
  encrypted.
- **Multi-device / sharing.** This is built for single-user personal use.
- **Search, drag-and-drop, thumbnails grid for images** — straightforward
  additions to `Browser.tsx` if you want them next.

## Security notes
- `MASTER_ENCRYPTION_KEY` never leaves your server and is never stored in
  the database — keep it out of git (`.env` is already gitignored).
- Your Telegram session string is encrypted at rest with that key, so a
  leaked `db.json` alone doesn't hand over your Telegram account.
- This is a personal project scaffold, not an audited security product —
  don't store anything with legal/regulatory sensitivity in it.
