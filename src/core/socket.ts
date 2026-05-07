import {
  default as makeWASocket,
  Browsers,
  DisconnectReason,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
  proto,
  WASocket,
} from '@whiskeysockets/baileys'
import { Boom } from '@hapi/boom'
import qrcode from 'qrcode-terminal'
import { env } from '../config/env'
import { logger } from './logger'
import { loadAuth, normalizePhone } from './auth'
import {
  cachedGroupMetadata,
  clearGroupCache,
  recallMessage,
  rememberMessage,
} from './messageStore'

let liveSock: WASocket | null = null

export type SocketBinder = (sock: WASocket) => void
const binders: SocketBinder[] = []

/**
 * Register a function that runs every time a fresh socket is created
 * (initial connect AND every reconnect). Use this so handlers stay bound
 * across reconnects. Returns a disposer.
 */
export function onSocket(binder: SocketBinder): () => void {
  binders.push(binder)
  if (liveSock) binder(liveSock)
  return () => {
    const i = binders.indexOf(binder)
    if (i >= 0) binders.splice(i, 1)
  }
}

/** Start the socket. After (re)connect, the live reference is updated and
 * binders registered via `onSocket()` are re-applied automatically. */
export async function startSocket(): Promise<WASocket> {
  liveSock = await startInternal()
  return liveSock
}

/** Get the current live socket, if one has been started. */
export function getSocket(): WASocket | null {
  return liveSock
}

async function startInternal(): Promise<WASocket> {
  const auth = await loadAuth(env.sessionDir)
  const { version, isLatest } = await fetchLatestBaileysVersion()
  logger.info({ version: version.join('.'), isLatest }, 'using whatsapp web version')

  let sock!: WASocket
  sock = makeWASocket({
    version,
    logger: logger.child({ module: 'baileys' }) as never,
    printQRInTerminal: false, // we render manually
    browser: Browsers.macOS('Safari'),
    auth: {
      creds: auth.state.creds,
      keys: makeCacheableSignalKeyStore(
        auth.state.keys,
        logger.child({ module: 'signal' }) as never,
      ),
    },
    syncFullHistory: false,
    markOnlineOnConnect: false,
    generateHighQualityLinkPreview: true,
    defaultQueryTimeoutMs: 60_000,
    keepAliveIntervalMs: 25_000,
    emitOwnEvents: false,
    /** Skip status broadcast — saves CPU and avoids junk in handlers. */
    shouldIgnoreJid: jid => jid?.endsWith('@broadcast') ?? false,
    /**
     * Answer retry-receipts from peers by replaying the original IMessage,
     * preventing “waiting for this message” states and lost messages on
     * the recipient side.
     */
    getMessage: async key => recallMessage(key.remoteJid ?? '', key.id ?? ''),
    /** 10-minute in-memory cache so group sends don't fetch metadata each call. */
    cachedGroupMetadata: jid => cachedGroupMetadata(sock, jid),
  })

  sock.ev.on('creds.update', auth.saveCreds)

  // Remember every message we see (incoming + outgoing) so peers' retry
  // receipts can be answered. Keep memory bounded inside messageStore.
  sock.ev.on('messages.upsert', upsert => {
    for (const m of upsert.messages) {
      rememberMessage(m.key.remoteJid, m.key.id, m.message)
    }
  })

  // Drop group metadata cache on participant changes — cheap correctness fix.
  sock.ev.on('group-participants.update', () => clearGroupCache())
  sock.ev.on('groups.update', () => clearGroupCache())

  // Re-apply all registered binders to this fresh socket.
  for (const b of binders) {
    try {
      b(sock)
    } catch (err) {
      logger.error({ err }, 'socket binder threw during attach')
    }
  }

  // Pairing-code flow (no creds yet → request 8-digit code).
  if (env.authMethod === 'pairing' && !sock.authState.creds.registered) {
    const phone = normalizePhone(env.botNumber)
    if (!phone) {
      throw new Error(
        'AUTH_METHOD=pairing requires BOT_NUMBER (international format, digits only)',
      )
    }
    setTimeout(async () => {
      try {
        const code = await sock.requestPairingCode(phone)
        const formatted = code.match(/.{1,4}/g)?.join('-') ?? code
        logger.info(
          { phone, code: formatted },
          'PAIRING CODE — open WhatsApp → Linked Devices → Link with phone number',
        )
        // Print prominently to console so it's easy to spot in logs.
        // eslint-disable-next-line no-console
        console.log('\n========================================')
        // eslint-disable-next-line no-console
        console.log(`  PAIRING CODE: ${formatted}`)
        // eslint-disable-next-line no-console
        console.log(`  for ${phone}`)
        // eslint-disable-next-line no-console
        console.log('========================================\n')
      } catch (err) {
        logger.error({ err }, 'failed to request pairing code')
      }
    }, 3_000)
  }

  sock.ev.on('connection.update', async update => {
    const { connection, lastDisconnect, qr } = update

    if (qr && env.authMethod === 'qr') {
      // eslint-disable-next-line no-console
      console.log('\nScan this QR with WhatsApp → Linked Devices:\n')
      qrcode.generate(qr, { small: true })
    }

    if (connection === 'open') {
      logger.info({ user: sock.user?.id }, '✅ connected to WhatsApp')
    }

    if (connection === 'close') {
      clearGroupCache()
      const code =
        (lastDisconnect?.error as Boom | undefined)?.output?.statusCode ??
        DisconnectReason.connectionClosed
      const reasonName = Object.entries(DisconnectReason).find(([, v]) => v === code)?.[0]
      logger.warn({ code, reason: reasonName }, 'connection closed')

      // Terminal cases — exit instead of looping forever.
      if (code === DisconnectReason.loggedOut) {
        logger.error('logged out by WhatsApp — clearing session and exiting. Re-run to pair again.')
        await auth.clear()
        process.exit(0)
        return
      }
      if (code === DisconnectReason.connectionReplaced) {
        logger.error('another device opened this session — exiting to avoid reconnect war.')
        process.exit(0)
        return
      }
      if (code === DisconnectReason.forbidden) {
        logger.error('account forbidden by WhatsApp (likely banned) — exiting.')
        process.exit(0)
        return
      }
      if (code === DisconnectReason.multideviceMismatch) {
        logger.error('multi-device mismatch — clearing session and exiting. Re-pair.')
        await auth.clear()
        process.exit(0)
        return
      }

      const delay = backoffFor(code)
      logger.info({ delayMs: delay }, 'scheduling reconnect')
      setTimeout(() => {
        startInternal()
          .then(s => {
            liveSock = s
          })
          .catch(err => {
            logger.error({ err }, 'reconnect failed; will retry in 5 s')
            setTimeout(() => startInternal().then(s => (liveSock = s)).catch(() => undefined), 5_000)
          })
      }, delay)
    }
  })

  return sock
}

function backoffFor(code: number): number {
  switch (code) {
    case DisconnectReason.restartRequired:
      return 1_000
    case DisconnectReason.connectionClosed:
    case DisconnectReason.connectionLost:
      return 2_000
    case DisconnectReason.timedOut:
      return 5_000
    case DisconnectReason.badSession:
      // Session corruption — short delay then reconnect; signal-store rebuilds.
      return 3_000
    default:
      return 5_000
  }
}

// Re-export proto so handlers don't have to pull baileys directly for typing.
export { proto }
