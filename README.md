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
- **Stability**: auto-reconnect dengan backoff per-`DisconnectReason`,
  in-memory message store untuk peer retry-receipts (anti "waiting for this
  message"), `fetchLatestBaileysVersion()` tiap boot, group metadata cache
  10 menit, keep-alive 25 s, terminal exit untuk `loggedOut` /
  `connectionReplaced` / `forbidden` (anti loop), swallow unhandled
  rejections.
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
│   ├── socket.ts           # makeWASocket + reconnect/backoff + onSocket binders + getMessage cb
│   ├── messageStore.ts     # in-memory store untuk getMessage + cachedGroupMetadata
│   └── logger.ts           # pino + pino-pretty
├── handlers/
│   ├── messages.ts         # onMessage() registry + dispatcher (auto-rebind on reconnect)
│   └── groups.ts           # onGroupUpdate() registry + dispatcher
└── lib/
    ├── parser.ts           # extract text/quoted/mentions/jid (unwrap ephemeral, viewOnce, dst)
    ├── messages.ts         # send helpers — basic (text/media/list/buttons/CTA/poll/contact/location)
    ├── business.ts         # business send helpers — native flow, MPM, catalog, single product, carousel, address/location request
    ├── sticker.ts          # toWebp() + sendStickerFromMedia()
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
poll · pollUpdate · reaction
buttonsResponse · listResponse · templateButtonReply · interactiveResponse
product · order · invoice · paymentRequest · paymentSend · paymentInvite
protocolEdit · protocolDelete · unknown
```

`msg.quoted.kind` punya range yang sama, plus `msg.quoted.asWAMessage` siap
di-pass ke `downloadMedia()`.

Untuk button / list / interactive responses:
- `msg.responseId` — id yang dipilih user (semua tipe response)
- `msg.responseName` — nama native flow button (`quick_reply`, `cta_url`, `mpm`, `single_select`, dst.)
- `msg.responseParams` — parsed `paramsJson` payload (untuk interactive response)

```ts
onMessage(async ({ sock, msg }) => {
  if (msg.kind === 'interactiveResponse') {
    console.log('User tapped:', msg.responseName, msg.responseId)
    console.log('Full params:', msg.responseParams)
  }
})
```

## Sticker — `toWebp()` & `sendStickerFromMedia()`

```ts
import { toWebp, sendStickerFromMedia } from './lib/sticker'
import { downloadMedia } from './lib/messages'

// Image / video di-quote → sticker
onMessage(async ({ sock, msg }) => {
  if (msg.text !== '!s') return
  if (!msg.quoted || !['image', 'video'].includes(msg.quoted.kind)) {
    await reply(sock, msg.chatJid, 'Reply gambar/video dulu ya.', msg.raw)
    return
  }
  const buf = await downloadMedia(sock, msg.quoted.asWAMessage)
  await sendStickerFromMedia(sock, msg.chatJid, buf, {
    pack: 'My Pack',
    author: msg.senderJid.split('@')[0],
    type: 'full',           // 'full' | 'crop' | 'circle' | 'rounded'
    quality: 60,
    quoted: msg.raw,
  })
})

// Atau langsung dari URL
const webp = await toWebp('https://example.com/image.png', { type: 'circle' })
```

Constraints WhatsApp: animated sticker ≤ 10 detik & ≤ 500 KB. Sumber video
sebaiknya ≤ 6 detik supaya aman.

## Business messages — `src/lib/business.ts`

Lengkap untuk semua jenis native-flow button + product/catalog/MPM/carousel.
**Render bergantung versi WA penerima** (Business / Beta paling konsisten).

### `sendNativeFlowInfo()` — single button, raw `name` + `params`

Helper paling generic — kasih `name` (jenis button) + `params` (shape-nya
tergantung `name`-nya). Berguna kalau kamu mau:
- pakai `single_select` (menu list-style),
- kirim tipe button apapun yang belum ada wrapper-nya,
- atau experiment dengan native_flow type baru.

```ts
import { sendNativeFlowInfo } from './lib/business'

// Single-select menu (replaces sendList):
await sendNativeFlowInfo(sock, msg.chatJid, {
  text: 'Pilih kategori:',
  name: 'single_select',
  params: {
    title: 'Lihat menu',
    sections: [
      {
        title: 'Promo',
        rows: [
          { id: 'prom_kaos',   title: 'Kaos',   description: 'Diskon 30%' },
          { id: 'prom_celana', title: 'Celana', description: 'Diskon 20%' },
        ],
      },
    ],
  },
  title: 'Toko ABC',
  footer: 'Powered by Baileys',
  quoted: msg.raw,
})

// Quick-reply dengan header image + custom button id:
await sendNativeFlowInfo(sock, msg.chatJid, {
  text: 'Konfirmasi pembayaran?',
  name: 'quick_reply',
  params: { display_text: 'Bayar Sekarang', id: 'PAY_NOW' },
  header: { type: 'image', image: { url: 'https://picsum.photos/600/400' } },
})
```

Tangkap response-nya:
```ts
onMessage(async ({ sock, msg }) => {
  if (msg.kind !== 'interactiveResponse') return
  if (msg.responseName === 'single_select' && msg.responseId === 'prom_kaos') { /* ... */ }
  if (msg.responseName === 'quick_reply'   && msg.responseId === 'PAY_NOW')   { /* ... */ }
})
```

### `sendNativeFlow()` — multi-button, fleksibel

```ts
import { sendNativeFlow } from './lib/business'

await sendNativeFlow(sock, msg.chatJid, {
  text: 'Pilih opsi:',
  title: 'Toko ABC',
  footer: 'Powered by Baileys',
  buttons: [
    { name: 'quick_reply', params: { display_text: 'Order', id: 'ORDER' } },
    { name: 'cta_url',     params: { display_text: 'Web',   url: 'https://example.com' } },
    { name: 'cta_call',    params: { display_text: 'CS',    phone_number: '6281234567890' } },
    { name: 'cta_copy',    params: { display_text: 'Promo', copy_code: 'DISC10' } },
  ],
  // Header optional — image / video / document
  header: { type: 'image', image: { url: 'https://picsum.photos/600/400' } },
  quoted: msg.raw,
})
```

Semua nama native flow yang didukung: `quick_reply`, `cta_url`, `cta_call`,
`cta_copy`, `cta_reminder`, `cta_cancel_reminder`, `address_message`,
`send_location`, `single_select`, `mpm`, `cta_catalog`, `payment_info`,
`review_and_pay`, `review_order`, `payment_method`, `payment_status`,
`automated_greeting_message_view_catalog`, `wa_payment_transaction_details`.
Boleh pakai nama custom (string apa saja) untuk forward-compat.

### `sendMultiProduct()` — MPM (catalog selector)

```ts
import { sendMultiProduct } from './lib/business'

await sendMultiProduct(sock, msg.chatJid, {
  businessOwnerJid: '6281234567890@s.whatsapp.net',  // owner katalog
  text: 'Lihat produk kami:',
  title: 'Katalog Toko',
  footer: 'Tap untuk detail',
  sections: [
    { title: 'New Arrivals', productIds: ['1234567890', '1234567891'] },
    { title: 'Best Sellers', productIds: ['1234567892'] },
  ],
})
```

Product id-nya ambil dari catalog WhatsApp Business (Settings → Business
tools → Catalog).

### `sendCatalogButton()` — buka catalog langsung

```ts
import { sendCatalogButton } from './lib/business'

await sendCatalogButton(sock, msg.chatJid, {
  text: 'Lihat semua produk kami:',
  businessOwnerJid: '6281234567890@s.whatsapp.net',
  catalogText: 'Buka Katalog',
})
```

### `sendProduct()` — single product card

```ts
import { sendProduct } from './lib/business'

await sendProduct(sock, msg.chatJid, {
  productId: '1234567890',
  businessOwnerJid: '6281234567890@s.whatsapp.net',
  title: 'Kaos Polos Hitam',
  description: 'Cotton combed 30s',
  currencyCode: 'IDR',
  priceAmount1000: 75_000_000,         // 75.000 IDR (× 1000)
  salePriceAmount1000: 50_000_000,     // 50.000 IDR
  retailerId: 'KAOS-HITAM-M',
  productImage: { url: 'https://example.com/kaos.jpg' },
  bodyText: 'Promo bulan ini!',
  footerText: 'Stok terbatas',
})
```

### `sendCarousel()` — multiple cards

```ts
import { sendCarousel } from './lib/business'

await sendCarousel(sock, msg.chatJid, {
  text: 'Promo minggu ini:',
  cards: [
    {
      title: 'Kaos',
      text: 'Diskon 30%',
      header: { type: 'image', image: { url: 'https://example.com/kaos.jpg' } },
      buttons: [
        { name: 'quick_reply', params: { display_text: 'Beli', id: 'buy_kaos' } },
        { name: 'cta_url',     params: { display_text: 'Detail', url: 'https://example.com/kaos' } },
      ],
    },
    {
      title: 'Celana',
      text: 'Diskon 20%',
      header: { type: 'image', image: { url: 'https://example.com/celana.jpg' } },
      buttons: [
        { name: 'quick_reply', params: { display_text: 'Beli', id: 'buy_celana' } },
      ],
    },
  ],
})
```

### Address & Location request

```ts
import { requestAddress, requestLocation } from './lib/business'

await requestAddress(sock, msg.chatJid, { text: 'Alamat pengiriman?' })
await requestLocation(sock, msg.chatJid, { text: 'Lokasi pickup-mu?' })
```

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

### DisconnectReason routing

| Reason                  | Behaviour                                                  |
| ----------------------- | ---------------------------------------------------------- |
| `restartRequired`       | Reconnect 1 s.                                             |
| `connectionClosed/Lost` | Reconnect 2 s.                                             |
| `timedOut`              | Reconnect 5 s.                                             |
| `badSession`            | Reconnect 3 s — signal store rebuilds itself on next conn. |
| `connectionReplaced`    | **Exit** — device lain ngambil session, jangan loop.       |
| `forbidden` (403)       | **Exit** — akun di-banned/flag, retry hanya bikin worse.   |
| `multideviceMismatch`   | **Wipe session + exit** — re-pair manual.                  |
| `loggedOut` (401)       | **Wipe session + exit** — re-pair manual.                  |
| Anything else           | Reconnect 5 s.                                             |

### Anti–"waiting for this message" / decryption-retry

In-memory message store (cap 1000, LRU-style) ditanam di `core/messageStore.ts`.
Setiap pesan masuk/keluar disimpan keyed by `chat:id`. Baileys'
`getMessage` callback ngambil dari store ini supaya retry-receipt dari peer
selalu bisa di-replay → no more bubbles "this message couldn't be displayed"
di sisi lawan bicara.

### Lain-lain

- `fetchLatestBaileysVersion()` di tiap boot — hindari force-logout karena
  WA naikin protocol version.
- `keepAliveIntervalMs: 25_000` — di bawah idle-timeout WA.
- `markOnlineOnConnect: false` — bot nggak bikin kontak pikir kamu online tiap
  reconnect.
- `shouldIgnoreJid: jid => jid?.endsWith('@broadcast')` — skip status broadcast.
- `cachedGroupMetadata` 10-menit cache — kirim ke grup nggak fetch metadata
  setiap kali, auto-invalidate kalau ada participant change / group update.
- `emitOwnEvents: false` — bot nggak loop dari pesannya sendiri.
- `process.on('unhandledRejection' / 'uncaughtException')` di-swallow —
  payload aneh dari peer nggak bisa bunuh bot.
- `onSocket()` binders dijalankan ulang setiap fresh socket → `onMessage()`
  & `onGroupUpdate()` terus aktif tanpa intervensi pas reconnect.

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
