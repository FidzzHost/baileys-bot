import { WASocket, proto } from '@whiskeysockets/baileys'
import { ParsedMessage, parse } from '../lib/parser'
import { logger } from '../core/logger'
import { env } from '../config/env'
import { onSocket } from '../core/socket'

export interface MessageContext {
  /** The live socket. */
  sock: WASocket
  /** Raw WAMessage from `messages.upsert`. */
  raw: proto.IWebMessageInfo
  /** Parsed view of the message (text, quoted, mentions, jids…). */
  msg: ParsedMessage
}

export type MessageHandler = (ctx: MessageContext) => void | Promise<void>
export type EventType = 'notify' | 'append' | 'replace' | 'prepend'

interface RegisteredHandler {
  handler: MessageHandler
  /** Which `messages.upsert` types to forward (default: `['notify']`). */
  types: EventType[]
  /** Skip messages where `key.fromMe === true` (default: true). */
  skipFromMe: boolean
}

const handlers: RegisteredHandler[] = []

export interface OnMessageOptions {
  types?: EventType[]
  /** Set false to receive bot's own messages (default true = skip). */
  skipFromMe?: boolean
}

/**
 * Register a handler that runs for every incoming message. Handlers run
 * sequentially in registration order; throwing inside a handler does NOT
 * affect other handlers — errors are logged.
 *
 * Returns a disposer function that unregisters the handler.
 */
export function onMessage(handler: MessageHandler, options: OnMessageOptions = {}): () => void {
  const entry: RegisteredHandler = {
    handler,
    types: options.types ?? ['notify'],
    skipFromMe: options.skipFromMe ?? true,
  }
  handlers.push(entry)
  return () => {
    const i = handlers.indexOf(entry)
    if (i >= 0) handlers.splice(i, 1)
  }
}

let attached = false

/**
 * Bind the handler chain to the socket once. Auto-rebinds across reconnects
 * via `onSocket()`. Safe to call multiple times — only the first call attaches.
 */
export function attachMessageDispatcher() {
  if (attached) return
  attached = true
  onSocket(sock => bindToSocket(sock))
}

function bindToSocket(sock: WASocket) {
  sock.ev.on('messages.upsert', async upsert => {
    const eventType = upsert.type as EventType
    for (const raw of upsert.messages) {
      let parsed: ParsedMessage | null = null
      for (const entry of handlers) {
        if (!entry.types.includes(eventType)) continue
        if (entry.skipFromMe && raw.key.fromMe) continue
        if (!parsed) {
          parsed = parse(raw)
          if (!parsed) break
        }
        if (env.autoRead && eventType === 'notify') {
          sock.readMessages([raw.key]).catch(() => undefined)
        }
        try {
          await entry.handler({ sock, raw, msg: parsed })
        } catch (err) {
          logger.error({ err, key: raw.key }, 'message handler threw')
        }
      }
    }
  })
}
