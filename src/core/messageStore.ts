import { proto, WASocket, jidNormalizedUser } from '@whiskeysockets/baileys'

const MAX_MESSAGES = 1000
const MAX_GROUP_METADATA = 200
const GROUP_METADATA_TTL_MS = 10 * 60 * 1000

interface CachedGroup {
  meta: Awaited<ReturnType<WASocket['groupMetadata']>>
  fetchedAt: number
}

const messages = new Map<string, proto.IMessage>()
const groups = new Map<string, CachedGroup>()

function key(remoteJid: string, id: string): string {
  return `${jidNormalizedUser(remoteJid)}|${id}`
}

/** Cap a Map by FIFO insertion order — drop oldest entries beyond `max`. */
function cap<K, V>(map: Map<K, V>, max: number): void {
  while (map.size > max) {
    const oldest = map.keys().next().value
    if (oldest === undefined) break
    map.delete(oldest)
  }
}

/** Remember the IMessage payload of a stanza we've seen, keyed by chat+id. */
export function rememberMessage(
  remoteJid: string | null | undefined,
  id: string | null | undefined,
  message: proto.IMessage | null | undefined,
): void {
  if (!remoteJid || !id || !message) return
  messages.set(key(remoteJid, id), message)
  cap(messages, MAX_MESSAGES)
}

/**
 * Look up a previously-remembered IMessage. Used as Baileys' `getMessage`
 * callback so that retry-receipts from peers can be answered with the
 * original payload, preventing message loss / "waiting for this message"
 * states.
 */
export function recallMessage(
  remoteJid: string,
  id: string,
): proto.IMessage | undefined {
  return messages.get(key(remoteJid, id))
}

/** Cache group metadata so we don't pay an XMPP round-trip on every send. */
export async function cachedGroupMetadata(
  sock: WASocket,
  jid: string,
): Promise<Awaited<ReturnType<WASocket['groupMetadata']>>> {
  const k = jidNormalizedUser(jid)
  const cached = groups.get(k)
  if (cached && Date.now() - cached.fetchedAt < GROUP_METADATA_TTL_MS) {
    return cached.meta
  }
  const meta = await sock.groupMetadata(jid)
  groups.set(k, { meta, fetchedAt: Date.now() })
  cap(groups, MAX_GROUP_METADATA)
  return meta
}

/** Invalidate cached metadata for a single group (call on participants/promote/etc.). */
export function invalidateGroupMetadata(jid: string): void {
  groups.delete(jidNormalizedUser(jid))
}

/** Drop the entire metadata cache (e.g. on reconnect). */
export function clearGroupCache(): void {
  groups.clear()
}
