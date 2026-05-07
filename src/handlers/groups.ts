import { WASocket, ParticipantAction } from '@whiskeysockets/baileys'
import { logger } from '../core/logger'
import { onSocket } from '../core/socket'

export interface GroupUpdateContext {
  sock: WASocket
  groupJid: string
  participants: string[]
  action: ParticipantAction
}

export type GroupUpdateHandler = (ctx: GroupUpdateContext) => void | Promise<void>

const handlers: GroupUpdateHandler[] = []

/**
 * Register a handler for group-participants updates (add / remove / promote /
 * demote / modify). Use this for welcome / leave messages, anti-link kicks,
 * etc.
 *
 * Returns a disposer.
 */
export function onGroupUpdate(handler: GroupUpdateHandler): () => void {
  handlers.push(handler)
  return () => {
    const i = handlers.indexOf(handler)
    if (i >= 0) handlers.splice(i, 1)
  }
}

let attached = false

/**
 * Bind the dispatcher to the socket once. Auto-rebinds across reconnects.
 * Safe to call multiple times — only the first call attaches.
 */
export function attachGroupDispatcher() {
  if (attached) return
  attached = true
  onSocket(sock => bindToSocket(sock))
}

function bindToSocket(sock: WASocket) {
  sock.ev.on('group-participants.update', async update => {
    const ctx: GroupUpdateContext = {
      sock,
      groupJid: update.id,
      participants: update.participants,
      action: update.action,
    }
    for (const h of handlers) {
      try {
        await h(ctx)
      } catch (err) {
        logger.error({ err, update }, 'group update handler threw')
      }
    }
  })
}
