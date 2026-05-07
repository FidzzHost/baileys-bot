import 'dotenv/config'

function getEnv(name: string, fallback?: string): string {
  const value = process.env[name]
  if (value === undefined || value === '') {
    if (fallback !== undefined) return fallback
    throw new Error(`Missing required env var: ${name}`)
  }
  return value
}

function getBool(name: string, fallback: boolean): boolean {
  const v = process.env[name]
  if (v === undefined) return fallback
  return v.toLowerCase() === 'true' || v === '1'
}

function getList(name: string, fallback: string[] = []): string[] {
  const v = process.env[name]
  if (!v) return fallback
  return v.split(',').map(s => s.trim()).filter(Boolean)
}

export const env = {
  botNumber: getEnv('BOT_NUMBER', ''),
  authMethod: (getEnv('AUTH_METHOD', 'pairing').toLowerCase() as 'qr' | 'pairing'),
  owners: getList('OWNERS'),
  prefix: getEnv('PREFIX', '.'),
  botName: getEnv('BOT_NAME', 'BaileysBot'),
  logLevel: getEnv('LOG_LEVEL', 'info'),
  autoRead: getBool('AUTO_READ', false),
  sessionDir: getEnv('SESSION_DIR', './session'),
} as const

export type Env = typeof env
