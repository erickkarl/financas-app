// Esquema do banco local. Interface mínima compatível com expo-sqlite (SQLiteDatabase)
// e com o adaptador de node:sqlite usado nos testes.

export type SqlValue = string | number | null;

export interface Db {
  execAsync(sql: string): Promise<void>;
  runAsync(sql: string, params?: SqlValue[]): Promise<unknown>;
  getAllAsync<T>(sql: string, params?: SqlValue[]): Promise<T[]>;
  getFirstAsync<T>(sql: string, params?: SqlValue[]): Promise<T | null>;
  withTransactionAsync(task: () => Promise<void>): Promise<void>;
}

export const DB_NAME = 'financas.db';
const DB_VERSION = 6;

const MIGRATION_1 = `
CREATE TABLE IF NOT EXISTS connections (
  item_id TEXT PRIMARY KEY NOT NULL,
  connector_id INTEGER,
  institution_name TEXT,
  status TEXT,
  execution_status TEXT,
  error_code TEXT,
  origin_updated_at TEXT,
  consent_json TEXT,
  consent_checked INTEGER NOT NULL DEFAULT 0,
  item_created_at TEXT,
  last_sync_attempt_at TEXT,
  last_sync_error TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS accounts (
  id TEXT PRIMARY KEY NOT NULL,
  item_id TEXT NOT NULL,
  type TEXT NOT NULL,
  subtype TEXT,
  name TEXT NOT NULL,
  number TEXT,
  balance REAL NOT NULL,
  due_date TEXT,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_accounts_item ON accounts(item_id);
CREATE TABLE IF NOT EXISTS transactions (
  id TEXT PRIMARY KEY NOT NULL,
  account_id TEXT NOT NULL,
  date TEXT NOT NULL,
  date_key TEXT NOT NULL,
  description TEXT NOT NULL,
  search_text TEXT NOT NULL,
  amount REAL NOT NULL,
  pluggy_category_id TEXT,
  auto_category TEXT,
  user_category TEXT,
  user_category_set INTEGER NOT NULL DEFAULT 0,
  hidden INTEGER NOT NULL DEFAULT 0,
  manual INTEGER NOT NULL DEFAULT 0,
  transfer_auto INTEGER NOT NULL DEFAULT 0,
  transfer_override INTEGER,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tx_account ON transactions(account_id);
CREATE INDEX IF NOT EXISTS idx_tx_date ON transactions(date_key DESC, id);
CREATE TABLE IF NOT EXISTS app_state (
  key TEXT PRIMARY KEY NOT NULL,
  value TEXT
);
`;

export async function migrate(db: Db): Promise<void> {
  const row = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
  const current = row?.user_version ?? 0;
  if (current >= DB_VERSION) return;
  await db.execAsync('PRAGMA journal_mode = WAL;');
  if (current < 1) {
    await db.execAsync(MIGRATION_1);
  }
  if (current < 2) {
    // UX v0.4 §7.4: número fixo ("Conexão 1") e nome dado pela pessoa.
    await db.execAsync(`
      ALTER TABLE connections ADD COLUMN display_number INTEGER;
      ALTER TABLE connections ADD COLUMN user_name TEXT;
    `);
    const rows = await db.getAllAsync<{ item_id: string }>('SELECT item_id FROM connections ORDER BY created_at');
    let n = 0;
    for (const r of rows) {
      n += 1;
      await db.runAsync('UPDATE connections SET display_number = ? WHERE item_id = ?', [n, r.item_id]);
    }
    await db.runAsync("INSERT OR REPLACE INTO app_state (key, value) VALUES ('next_connection_number', ?)", [String(n + 1)]);
  }
  if (current < 3) {
    // UX 0.8 §7.4 e conexão repetida: nome sugerido pela conta e marca de repetida.
    await db.execAsync(`
      ALTER TABLE connections ADD COLUMN suggested_base TEXT;
      ALTER TABLE connections ADD COLUMN suggested_name TEXT;
      ALTER TABLE connections ADD COLUMN suggested_account_id TEXT;
      ALTER TABLE connections ADD COLUMN duplicate_of TEXT;
    `);
  }
  if (current < 4) {
    // RF-009.1.2: contas que cada conexão traz (para revogar sem apagar as compartilhadas).
    await db.execAsync('ALTER TABLE connections ADD COLUMN account_refs TEXT;');
  }
  if (current < 5) {
    // RF-002.3.1 (UX 0.9): validade da autorização do app (item.consentExpiresAt).
    await db.execAsync('ALTER TABLE connections ADD COLUMN auth_expires_at TEXT;');
  }
  if (current < 6) {
    // UX 0.11 / R-14.2: autorização excluída no Pluggy para ser substituída ("aguardando nova autorização"),
    // e conta antiga que não veio na nova autorização ("Sem autorização", R-17).
    await db.execAsync(`
      ALTER TABLE connections ADD COLUMN replaced_at TEXT;
      ALTER TABLE accounts ADD COLUMN unauthorized_at TEXT;
    `);
  }
  await db.execAsync(`PRAGMA user_version = ${DB_VERSION}`);
}

/** Apaga todos os dados financeiros do aparelho (excluir conta). */
export async function wipeAll(db: Db): Promise<void> {
  await db.withTransactionAsync(async () => {
    await db.runAsync('DELETE FROM transactions');
    await db.runAsync('DELETE FROM accounts');
    await db.runAsync('DELETE FROM connections');
    await db.runAsync('DELETE FROM app_state');
  });
}
