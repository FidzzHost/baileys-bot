import Database from 'better-sqlite3'
import * as path from 'path'
import * as fs from 'fs'

const DATA_DIR = path.resolve(process.cwd(), 'data')
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true })

/**
 * Shared SQLite database. Use it directly for any custom tables you create —
 * `db.prepare('CREATE TABLE IF NOT EXISTS …').run()` etc.
 *
 * The default schema below provides a generic key/value store and a per-group
 * settings table. Both are optional; ignore them if you don't need them.
 */
export const db = new Database(path.join(DATA_DIR, 'bot.db'))
db.pragma('journal_mode = WAL')

db.exec(`
  CREATE TABLE IF NOT EXISTS kv (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS group_settings (
    jid TEXT PRIMARY KEY,
    settings TEXT NOT NULL DEFAULT '{}'
  );
`)

/** Generic key/value store. Values are JSON-encoded. */
export const kv = {
  get<T = unknown>(key: string): T | undefined {
    const row = db.prepare<[string], { value: string }>('SELECT value FROM kv WHERE key = ?').get(key)
    if (!row) return undefined
    return JSON.parse(row.value) as T
  },
  set<T = unknown>(key: string, value: T) {
    db.prepare(
      `INSERT INTO kv (key, value, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    ).run(key, JSON.stringify(value), Date.now())
  },
  delete(key: string) {
    db.prepare('DELETE FROM kv WHERE key = ?').run(key)
  },
  keys(prefix = ''): string[] {
    const rows = db
      .prepare<[string], { key: string }>('SELECT key FROM kv WHERE key LIKE ?')
      .all(`${prefix}%`)
    return rows.map(r => r.key)
  },
}

/** Per-group JSON settings bag. */
export const groupSettings = {
  get<T extends Record<string, unknown> = Record<string, unknown>>(jid: string): T {
    const row = db
      .prepare<[string], { settings: string }>('SELECT settings FROM group_settings WHERE jid = ?')
      .get(jid)
    if (!row) {
      db.prepare('INSERT INTO group_settings (jid, settings) VALUES (?, ?)').run(jid, '{}')
      return {} as T
    }
    return JSON.parse(row.settings) as T
  },
  set<T extends Record<string, unknown>>(jid: string, patch: Partial<T>) {
    const current = this.get<T>(jid)
    const merged = { ...current, ...patch }
    db.prepare(
      `INSERT INTO group_settings (jid, settings) VALUES (?, ?)
       ON CONFLICT(jid) DO UPDATE SET settings = excluded.settings`,
    ).run(jid, JSON.stringify(merged))
    return merged
  },
}
