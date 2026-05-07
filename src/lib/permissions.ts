import { WASocket, jidNormalizedUser } from '@whiskeysockets/baileys'
import { env } from '../config/env'

const ownerJids = new Set(
  env.owners.map(num => jidNormalizedUser(`${num.replace(/[^0-9]/g, '')}@s.whatsapp.net`)),
)

export function isOwner(jid: string): boolean {
  return ownerJids.has(jidNormalizedUser(jid))
}

export async function isGroupAdmin(
  sock: WASocket,
  groupJid: string,
  userJid: string,
): Promise<boolean> {
  const meta = await sock.groupMetadata(groupJid)
  const target = jidNormalizedUser(userJid)
  return meta.participants.some(
    p => jidNormalizedUser(p.id) === target && (p.admin === 'admin' || p.admin === 'superadmin'),
  )
}

export async function isBotAdmin(sock: WASocket, groupJid: string): Promise<boolean> {
  if (!sock.user?.id) return false
  return isGroupAdmin(sock, groupJid, sock.user.id)
}
