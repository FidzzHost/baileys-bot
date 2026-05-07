import {
  WASocket,
  WAMessage,
  proto,
  jidNormalizedUser,
} from '@whiskeysockets/baileys'
import { onSocket } from '../core/socket'
import { logger } from '../core/logger'
import { parse, type MessageKind } from './parser'
import { downloadMedia } from './messages'

/**
 * Status / Story (`status@broadcast`) tracking.
 *
 * The bot keeps an in-memory list (capped) of every status message it has
 * seen. When the WhatsApp app on the linked phone (the bot's number) views
 * a status, the multi-device sync emits a read receipt for that status —
 * we capture that and flip `readAt` on the matching entry.
 *
 * You can also explicitly `markStatusRead()` from bot code to send a read
 * receipt yourself (the status will then appear under `getReadStatuses()`).
 *
 * After you have a list of read statuses, call `downloadStatusMedia(sock, status)`
 * to grab the underlying image/video bytes (it's just a thin wrapper over
 * the standard `downloadMediaMessage` you'd use for any other media).
 */

export const STATUS_BROADCAST_JID = 'status@broadcast'

const MAX_STATUSES = 500

export interface StatusEntry {
  /** Stanza id of the status message. */
  id: string
  /** JID of the contact who posted the status. */
  from: string
  /** Semantic kind — `image` / `video` / `text` / etc. */
  kind: MessageKind
  /** Caption / text body, '' if none. */
  text: string
  /** Media mime-type, if any. */
  mimeType: string | undefined
  /** When the bot received it (ms epoch). */
  receivedAt: number
  /** When the bot's account viewed/read it, or `undefined` if still unread. */
  readAt: number | undefined
  /** Original WAMessage — needed for `downloadStatusMedia()`. */
  raw: WAMessage
}

const statuses = new Map<string, StatusEntry>()

type ReceivedHandler = (entry: StatusEntry) => void | Promise<void>
type ReadHandler = (entry: StatusEntry) => void | Promise<void>

const receivedHandlers: ReceivedHandler[] = []
const readHandlers: ReadHandler[] = []

/** Register a handler called for every new status arriving on the bot. */
export function onStatusReceived(handler: ReceivedHandler): () => void {
  receivedHandlers.push(handler)
  return () => {
    const i = receivedHandlers.indexOf(handler)
    if (i >= 0) receivedHandlers.splice(i, 1)
  }
}

/**
 * Register a handler called when a status is observed as read by the bot's
 * account — either because the linked phone viewed it (multi-device sync)
 * or because `markStatusRead()` was called explicitly.
 */
export function onStatusRead(handler: ReadHandler): () => void {
  readHandlers.push(handler)
  return () => {
    const i = readHandlers.indexOf(handler)
    if (i >= 0) readHandlers.splice(i, 1)
  }
}

/** Every status currently held in memory (newest last). */
export function getStatuses(): StatusEntry[] {
  return Array.from(statuses.values())
}

/** Statuses whose `readAt` is set — i.e. the bot has read them. */
export function getReadStatuses(): StatusEntry[] {
  return getStatuses().filter(s => s.readAt !== undefined)
}

/** Statuses still unread by the bot. */
export function getUnreadStatuses(): StatusEntry[] {
  return getStatuses().filter(s => s.readAt === undefined)
}

/**
 * Send a read receipt for the status and mark it as read locally.
 * No-op if the status isn't in the in-memory list (e.g. older than the
 * cache window).
 */
export async function markStatusRead(
  sock: WASocket,
  target: StatusEntry | string,
): Promise<StatusEntry | undefined> {
  const id = typeof target === 'string' ? target : target.id
  const entry = statuses.get(id)
  if (!entry) return undefined
  if (entry.readAt) return entry

  try {
    await sock.readMessages([entry.raw.key])
  } catch (err) {
    logger.warn({ err, statusId: id }, 'failed to send status read receipt')
  }
  entry.readAt = Date.now()
  for (const h of readHandlers) {
    try {
      await h(entry)
    } catch (err) {
      logger.error({ err, statusId: id }, 'onStatusRead handler threw')
    }
  }
  return entry
}

/** Mark every currently-unread status as read in one shot. */
export async function readAllStatuses(sock: WASocket): Promise<StatusEntry[]> {
  const unread = getUnreadStatuses()
  if (unread.length === 0) return []
  try {
    await sock.readMessages(unread.map(s => s.raw.key))
  } catch (err) {
    logger.warn({ err, count: unread.length }, 'failed to bulk-read statuses')
  }
  const now = Date.now()
  for (const entry of unread) {
    entry.readAt = now
    for (const h of readHandlers) {
      try {
        await h(entry)
      } catch (err) {
        logger.error({ err, statusId: entry.id }, 'onStatusRead handler threw')
      }
    }
  }
  return unread
}

/**
 * Download the underlying media (image / video / audio / document /
 * sticker) bytes for a status. Throws if the status carries no media.
 */
export function downloadStatusMedia(
  sock: WASocket,
  status: StatusEntry,
): Promise<Buffer> {
  return downloadMedia(sock, status.raw)
}

/** Drop the in-memory store (e.g. on session reset). */
export function clearStatuses(): void {
  statuses.clear()
}

function rememberStatus(raw: WAMessage): StatusEntry | undefined {
  const parsed = parse(raw)
  if (!parsed) return undefined

  const existing = statuses.get(parsed.id)
  if (existing) return existing

  const entry: StatusEntry = {
    id: parsed.id,
    from: jidNormalizedUser(raw.key.participant ?? raw.participant ?? ''),
    kind: parsed.kind,
    text: parsed.text,
    mimeType: parsed.mimeType,
    receivedAt: Date.now(),
    readAt: undefined,
    raw,
  }
  statuses.set(parsed.id, entry)

  // FIFO cap.
  while (statuses.size > MAX_STATUSES) {
    const oldest = statuses.keys().next().value
    if (oldest === undefined) break
    statuses.delete(oldest)
  }
  return entry
}

function isReadStatus(status: number | null | undefined): boolean {
  if (status === null || status === undefined) return false
  return (
    status === proto.WebMessageInfo.Status.READ ||
    status === proto.WebMessageInfo.Status.PLAYED
  )
}

let attached = false

/**
 * Wire status tracking onto every (re)connected socket. Safe to call many
 * times — only the first call attaches.
 */
export function attachStatusTracker(): void {
  if (attached) return
  attached = true

  onSocket(sock => {
    sock.ev.on('messages.upsert', async ({ messages, type }) => {
      if (type !== 'notify') return
      for (const raw of messages) {
        if (raw.key.remoteJid !== STATUS_BROADCAST_JID) continue
        // Ignore the bot's own posted status echoes.
        if (raw.key.fromMe) continue

        const entry = rememberStatus(raw)
        if (!entry) continue

        for (const h of receivedHandlers) {
          try {
            await h(entry)
          } catch (err) {
            logger.error({ err, statusId: entry.id }, 'onStatusReceived handler threw')
          }
        }
      }
    })

    // Multi-device sync: when the linked phone views a status, we get a
    // `messages.update` for that key flipping status to READ/PLAYED.
    sock.ev.on('messages.update', async updates => {
      for (const u of updates) {
        if (u.key.remoteJid !== STATUS_BROADCAST_JID) continue
        if (!u.key.id) continue
        const entry = statuses.get(u.key.id)
        if (!entry) continue
        if (entry.readAt) continue
        if (!isReadStatus(u.update?.status)) continue
        entry.readAt = Date.now()
        for (const h of readHandlers) {
          try {
            await h(entry)
          } catch (err) {
            logger.error({ err, statusId: entry.id }, 'onStatusRead handler threw')
          }
        }
      }
    })

    // Some builds surface status read events through `message-receipt.update`
    // instead of `messages.update`. Handle both for safety.
    sock.ev.on('message-receipt.update', async receipts => {
      for (const r of receipts) {
        if (r.key.remoteJid !== STATUS_BROADCAST_JID) continue
        if (!r.key.id) continue
        const entry = statuses.get(r.key.id)
        if (!entry || entry.readAt) continue
        const recType = r.receipt?.readTimestamp ?? r.receipt?.playedTimestamp
        if (!recType) continue
        entry.readAt = Date.now()
        for (const h of readHandlers) {
          try {
            await h(entry)
          } catch (err) {
            logger.error({ err, statusId: entry.id }, 'onStatusRead handler threw')
          }
        }
      }
    })
  })
}
