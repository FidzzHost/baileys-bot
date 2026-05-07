import { useMultiFileAuthState, AuthenticationState, SignalKeyStore } from '@whiskeysockets/baileys'
import * as fs from 'fs'
import * as path from 'path'

export interface AuthBundle {
  state: AuthenticationState
  saveCreds: () => Promise<void>
  /** Wipe the auth folder. Use when DisconnectReason.loggedOut is observed. */
  clear: () => Promise<void>
}

export async function loadAuth(sessionDir: string): Promise<AuthBundle> {
  if (!fs.existsSync(sessionDir)) fs.mkdirSync(sessionDir, { recursive: true })
  const { state, saveCreds } = await useMultiFileAuthState(sessionDir)
  return {
    state,
    saveCreds,
    clear: async () => {
      await fs.promises.rm(sessionDir, { recursive: true, force: true })
      fs.mkdirSync(sessionDir, { recursive: true })
    },
  }
}

/**
 * Sanitize the pairing phone number — Baileys requires digits only,
 * with country code, no '+' / spaces / dashes.
 */
export function normalizePhone(input: string): string {
  return input.replace(/[^0-9]/g, '')
}

export function authPathFor(sessionDir: string, file: string): string {
  return path.join(sessionDir, file)
}

export type { SignalKeyStore }
