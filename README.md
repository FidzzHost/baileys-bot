# baileys-bot

Modern WhatsApp bot **base / framework** built on
[Baileys](https://github.com/WhiskeySockets/Baileys). Bukan bot jadi — ini
foundation: stable connection layer + comprehensive message parser + lengkap
helpers untuk semua jenis pesan (text, media, button, list, interactive/CTA,
poll, location, contact, dst). Logic bisnis kamu tulis sendiri lewat hook
`onMessage()`.

## Highlights

- **Multi-runtime**: Linux/VPS, Termux Android, Windows.
- **Auth flexible**: pairing-code (8-digit) **atau** QR — toggle via env.
- **Stability**: auto-reconnect dengan backoff per-`DisconnectReason`, anti
  bad-session, anti loop, keep-alive 30 s, swallow unhandled rejections.
- **Comprehensive parser**: unwrap ephemeral / view-once / document-with-caption
  wrappers, extract text/quoted/mentions dari semua tipe pesan termasuk
  `buttonsResponse`, `listResponse`, `interactiveResponse`, `templateButtonReply`.
- **Lengkap rich-message helpers**: image, video, audio (incl. PTT voice note),
  document, sticker, location, contact (vCard), poll, react, edit, hidetag,
  buttons v1, list, interactive (quick-reply / CTA URL / call / copy), media
  download.
- **SQLite** (better-sqlite3, free, embedded — no server) dengan generic kv
  store + per-group settings.

## Realita yang harus kamu tahu

> Baileys = unofficial WhatsApp Web protocol. Beberapa fitur "modern WA bot"
> yang sering dijanjikan tutorial **tidak reliable** karena keputusan WhatsApp
> sendiri, bukan bug library:

| Fitur | Status |
| --- | --- |
| `buttonsMessage` (button v1) | Mostly **tidak render** di WA modern (sejak akhir-2023). Helper tetap disediakan untuk client lawas. |
| `listMessage` | Render relatif konsisten. |
| `interactiveMessage` / native flow CTA | Render di sebagian build (terutama WA Business / Beta). **Spam → akun ke-flag/ban**. Pakai sparingly. |
| Akun di-banned | Risiko nyata. **Jangan pakai nomor utama**. |
| `loggedOut` (401) tiba-tiba | WhatsApp memutus secara permanen → bot wipe session, exit. Pair ulang manual. |
| Reliable button untuk produksi | Pertimbangkan **WhatsApp Cloud API** resmi (Meta), gratis ≤1000 conversation/bulan. |

## Quick start

```bash
git clone https://github.com/FidzzHost/baileys-bot.git
cd baileys-bot
npm install
cp .env.example .env
nano .env       # set BOT_NUMBER + AUTH_METHOD minimal
npm run build
npm start
```

Saat pertama jalan dengan `AUTH_METHOD=pairing`:

```
========================================
  PAIRING CODE: ABCD-1234
  for 6281234567890
========================================
```

Buka WhatsApp di HP → **Linked Devices** → **Link with phone number** →
ketik kode itu. Session disimpan di `./session/`, jadi pairing cuma sekali.

Mau pakai QR? Set `AUTH_METHOD=qr`, jalankan, scan QR yang muncul di terminal.

## Konfigurasi (`.env`)

| Var           | Default       | Keterangan                                                                |
| ------------- | ------------- | ------------------------------------------------------------------------- |
| `BOT_NUMBER`  | _required (pairing)_ | Nomor bot, format internasional **tanpa `+`** (contoh `6281234567890`). Wajib kalau `AUTH_METHOD=pairing`. |
| `AUTH_METHOD` | `pairing`     | `pairing` atau `qr`.                                                      |
| `OWNERS`      | _empty_       | Comma-separated nomor owner. Dipakai `permissions.isOwner()`.             |
| `PREFIX`      | `.`           | Default command prefix kalau kamu pakai pattern command-handler. Bebas.   |
| `BOT_NAME`    | `BaileysBot`  | Display name di log / sticker pack / dll.                                 |
| `LOG_LEVEL`   | `info`        | `trace` / `debug` / `info` / `warn` / `error` / `fatal` / `silent`.       |
| `AUTO_READ`   | `false`       | Auto-mark pesan masuk sebagai dibaca.                                     |
| `SESSION_DIR` | `./session`   | Folder multi-file auth. Persist supaya nggak pair ulang.                  |

## Struktur

```
src/
├── index.ts                # entry — tulis logic kamu di sini lewat onMessage()
├── config/env.ts           # loader .env + validasi
├── core/
│   ├── auth.ts             # multi-file auth, normalisasi nomor, clear session
│   ├── socket.ts           # makeWASocket + reconnect/backoff + onSocket binders
│   └── logger.ts           # pino + pino-pretty
├── handlers/
│   ├── messages.ts         # onMessage() registry + dispatcher (auto-rebind on reconnect)
│   └── groups.ts           # onGroupUpdate() registry + dispatcher
└── lib/
    ├── parser.ts           # extract text/quoted/mentions/jid (unwrap ephemeral, viewOnce, dst)
    ├── messages.ts         # SEMUA send helpers — basic + rich
    ├── permissions.ts      # owner & admin checks
    └── db.ts               # better-sqlite3 + kv store + group settings
```

## Cara nulis logic — `onMessage()`

Buka `src/index.ts`. Tambahkan handler pakai `onMessage()`:

```ts
import { onMessage } from './handlers/messages'
import {
  reply, sendImage, sendList, sendInteractive, sendButtons,
  react, downloadMedia, hidetag,
} from './lib/messages'
import { isOwner, isGroupAdmin } from './lib/permissions'

// 1) Reply text
onMessage(async ({ sock, msg }) => {
  if (msg.text === '!ping') {
    await reply(sock, msg.chatJid, 'pong', msg.raw)
  }
})

// 2) React + reply
onMessage(async ({ sock, msg }) => {
  if (msg.text.startsWith('!love')) {
    await react(sock, msg.raw.key, '❤️')
  }
})

// 3) Tangani quoted dari semua jenis
onMessage(async ({ sock, msg }) => {
  if (msg.text === '!info' && msg.quoted) {
    await reply(
      sock,
      msg.chatJid,
      `Quoted kind: ${msg.quoted.kind}\n` +
        `Sender: ${msg.quoted.participant}\n` +
        `Text: ${msg.quoted.text}\n` +
        `Mime: ${msg.quoted.mimeType ?? '-'}`,
      msg.raw,
    )
  }
})

// 4) Download media yang di-quote
onMessage(async ({ sock, msg }) => {
  if (msg.text === '!save' && msg.quoted && ['image', 'video', 'audio', 'document', 'sticker'].includes(msg.quoted.kind)) {
    const buf = await downloadMedia(sock, msg.quoted.asWAMessage)
    require('fs').writeFileSync(`./data/${msg.quoted.id}.bin`, buf)
    await reply(sock, msg.chatJid, `✅ Saved (${buf.length} bytes)`, msg.raw)
  }
})

// 5) Send list / button / interactive
onMessage(async ({ sock, msg }) => {
  if (msg.text === '!menu') {
    await sendList(sock, msg.chatJid, {
      text: 'Pilih menu:',
      title: 'Menu Bot',
      buttonText: 'Buka',
      sections: [
        {
          title: 'Umum',
          rows: [
            { id: 'menu_ping', title: 'Ping', description: 'Cek latency' },
            { id: 'menu_info', title: 'Info', description: 'Info bot' },
          ],
        },
      ],
      quoted: msg.raw,
    })
  }
})

onMessage(async ({ sock, msg }) => {
  if (msg.text === '!cta') {
    await sendInteractive(sock, msg.chatJid, {
      text: 'Cek website kami:',
      footer: 'Bot powered by Baileys',
      buttons: [
        { type: 'reply', id: 'cta_about', label: 'Tentang' },
        { type: 'url', label: 'Website', url: 'https://example.com' },
        { type: 'call', label: 'Telpon CS', phone: '6281234567890' },
        { type: 'copy', label: 'Salin kode', copyCode: 'PROMO123' },
      ],
      quoted: msg.raw,
    })
  }
})

// 6) Permission check
onMessage(async ({ sock, msg }) => {
  if (msg.text === '!ownerping' && isOwner(msg.senderJid)) {
    await reply(sock, msg.chatJid, '👑 hi owner', msg.raw)
  }
})
```

### Tipe pesan yang masuk via `msg.kind`

```
text · image · video · audio · document · sticker
contact · contactsArray · location · liveLocation
poll · reaction
buttonsResponse · listResponse · templateButtonReply · interactiveResponse
protocolEdit · protocolDelete · unknown
```

`msg.quoted.kind` punya range yang sama, plus `msg.quoted.asWAMessage` siap
di-pass ke `downloadMedia()`.

### Group events — `onGroupUpdate()`

```ts
import { onGroupUpdate } from './handlers/groups'
import { reply } from './lib/messages'

onGroupUpdate(async ({ sock, groupJid, participants, action }) => {
  if (action === 'add') {
    for (const jid of participants) {
      await sock.sendMessage(groupJid, {
        text: `Welcome @${jid.split('@')[0]}!`,
        mentions: [jid],
      })
    }
  }
})
```

## Multi-runtime install

### Linux / VPS

```bash
sudo apt-get install -y nodejs npm python3 build-essential ffmpeg
git clone <repo>
cd baileys-bot && npm install && npm run build && npm start
```

Recommended untuk produksi: `pm2`.

```bash
sudo npm i -g pm2
pm2 start dist/index.js --name baileys-bot
pm2 save && pm2 startup
```

### Termux (Android)

```bash
pkg update -y
pkg install -y nodejs-lts git python clang make ffmpeg
git clone <repo>
cd baileys-bot
npm install --build-from-source
cp .env.example .env && nano .env
npm run build && npm start
```

Tips:
- `sharp` & `better-sqlite3` butuh native compile; `clang make python` dari pkg.
- Background: `pm2` atau `tmux` / `screen`.
- Disable battery optimization untuk Termux di Settings HP.

### Windows

```powershell
# Install Node.js 20+ dari https://nodejs.org
# Visual Studio Build Tools (untuk native modules):
npm install --global windows-build-tools  # PowerShell as Admin
git clone <repo>
cd baileys-bot
npm install
copy .env.example .env
notepad .env
npm run build
npm start
```

## Stability strategy

| Reason                        | Behaviour                                    |
| ----------------------------- | -------------------------------------------- |
| `restartRequired`             | Reconnect 1 s.                               |
| `connectionClosed/Lost`       | Reconnect 2 s.                               |
| `timedOut`                    | Reconnect 5 s.                               |
| `connectionReplaced`          | Reconnect 30 s (jangan loop dengan device lain). |
| `badSession` / `multideviceMismatch` | Reconnect 3 s.                        |
| `loggedOut` (401)             | Wipe session + exit. Manual re-pair.         |
| Anything else                 | Reconnect 5 s.                               |

`onSocket()` binders dijalankan ulang setiap kali fresh socket dibuat, jadi
handler `onMessage()` & `onGroupUpdate()` terus aktif tanpa intervensi.

`process.on('unhandledRejection')` & `uncaughtException` di-catch — bot tidak
crash karena error sporadis dari payload aneh.

## Scripts

```bash
npm run build       # tsc → dist/
npm start           # node dist/index.js
npm run dev         # ts-node src/index.ts (live)
npm run typecheck   # tsc --noEmit
npm run lint        # eslint
npm run format      # prettier
```

## Disclaimer

Project ini **tidak berafiliasi dengan WhatsApp atau Meta**. Pakai sesuai ToS
WhatsApp. Maintainer tidak bertanggung jawab atas akun yang terkena suspend
karena pemakaian melawan ToS (spam, blast bulk, otomasi agresif, dll.). Jangan
pakai untuk stalkerware / harassment / scam.

## License

MIT
