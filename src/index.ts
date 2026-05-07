import { startSocket, getSocket } from './core/socket'
import { attachMessageDispatcher, onMessage } from './handlers/messages'
import { attachGroupDispatcher } from './handlers/groups'
import { attachStatusTracker } from './lib/status'
import { logger } from './core/logger'
import { reply } from './lib/messages'

// ──────────────────────────────────────────────────────────────────────────────
// User code goes here. Add as many `onMessage()` handlers as you want; they all
// run for every incoming `messages.upsert` event. The example below replies
// "pong" to any message that says "ping" — delete it and write your own logic.
// ──────────────────────────────────────────────────────────────────────────────

onMessage(async ({ sock, msg }) => {
  if (msg.text.toLowerCase() === 'ping') {
    await reply(sock, msg.chatJid, '🏓 pong', msg.raw)
  }
})

// ──────────────────────────────────────────────────────────────────────────────
// Bootstrap. Don't edit below unless you know what you're doing.
// ──────────────────────────────────────────────────────────────────────────────

async function main() {
  attachMessageDispatcher()
  attachGroupDispatcher()
  attachStatusTracker()
  await startSocket()
}

main().catch(err => {
  logger.fatal({ err }, 'fatal error during startup')
  process.exit(1)
})

process.on('unhandledRejection', err => {
  logger.error({ err }, 'unhandledRejection (swallowed)')
})

process.on('uncaughtException', err => {
  logger.error({ err }, 'uncaughtException (swallowed)')
})

// re-export key APIs for IDE autocomplete when this file is imported as a lib
export { onMessage, getSocket }
