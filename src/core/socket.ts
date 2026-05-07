import {
  default as makeWASocket,
  Browsers,
  DisconnectReason,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
  WASocket,
} from '@whiskeysockets/baileys'
import { Boom } from '@hapi/boom'
import qrcode from 'qrcode-terminal'
import { env } from '../config/env'
import { logger } from './logger'
import { loadAuth, normalizePhone } from './auth'

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

  const sock = makeWASocket({
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
    keepAliveIntervalMs: 30_000,
    emitOwnEvents: false,
  })

  sock.ev.on('creds.update', auth.saveCreds)

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
      const code =
        (lastDisconnect?.error as Boom | undefined)?.output?.statusCode ??
        DisconnectReason.connectionClosed
      const reasonName = Object.entries(DisconnectReason).find(([, v]) => v === code)?.[0]
      logger.warn({ code, reason: reasonName }, 'connection closed')

      if (code === DisconnectReason.loggedOut) {
        logger.error('logged out by WhatsApp — clearing session and exiting. Re-run to pair again.')
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
    case DisconnectReason.connectionReplaced:
      // Another linked-device session took over — wait longer to avoid loops.
      return 30_000
    case DisconnectReason.timedOut:
      return 5_000
    case DisconnectReason.badSession:
    case DisconnectReason.multideviceMismatch:
      return 3_000
    default:
      return 5_000
  }
}
