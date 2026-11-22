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
const DB_VERSION = 11;

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
  if (current < 7) {
    // Ciclo 2: investimentos por conexão (RF-008.3 aviso R-5, RF-016 patrimônio) e "Rendimentos" (UX 0.7 §7.3).
    await db.execAsync(`
      CREATE TABLE IF NOT EXISTS investments (
        id TEXT PRIMARY KEY NOT NULL,
        item_id TEXT NOT NULL,
        type TEXT,
        subtype TEXT,
        name TEXT,
        balance REAL NOT NULL DEFAULT 0,
        updated_at TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_investments_item ON investments(item_id);
      -- RF-016.4: no máximo um ponto por dia e por conexão ('manual' = conta "Dinheiro"). Ponto de dia passado não é
      -- reescrito; sai ao revogar a conexão ou apagar os dados (RF-016.7).
      CREATE TABLE IF NOT EXISTS wealth_points (
        date_key TEXT NOT NULL,
        item_id TEXT NOT NULL,
        accounts REAL NOT NULL,
        investments REAL NOT NULL,
        data_at TEXT,
        PRIMARY KEY (date_key, item_id)
      );
      ALTER TABLE accounts ADD COLUMN auto_invested REAL;
      ALTER TABLE connections ADD COLUMN investments_count INTEGER;
      UPDATE transactions SET auto_category = 'rendimentos' WHERE pluggy_category_id = '03060000';
    `);
  }
  if (current < 8) {
    // UX 0.14 / requisitos v1.18: marca "Fora do Resumo" (RF-008.8), tipo da operação (R-8.5) e documento de pagador e
    // recebedor (R-8.2, RNF-007: só tipo e número, só no aparelho; saem com a transação).
    await db.execAsync(`
      ALTER TABLE transactions ADD COLUMN out_of_summary INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE transactions ADD COLUMN operation_type TEXT;
      ALTER TABLE transactions ADD COLUMN payer_doc_type TEXT;
      ALTER TABLE transactions ADD COLUMN payer_doc TEXT;
      ALTER TABLE transactions ADD COLUMN receiver_doc_type TEXT;
      ALTER TABLE transactions ADD COLUMN receiver_doc TEXT;
    `);
  }
  if (current < 9) {
    // R-2.1 (requisitos v1.20): pagamento de fatura sem par (não reconhecido por R-8.2 nem marcado à mão).
    await db.execAsync('ALTER TABLE transactions ADD COLUMN bill_unpaired INTEGER NOT NULL DEFAULT 0;');
  }
  if (current < 10) {
    // requisitos v1.21–v1.23 / UX 0.17.
    // RF-008.10: estorno de compra no cartão (reduz a despesa da categoria; nunca receita).
    // RF-006.3: categoria lembrada por destinatário. A lembrança guarda SÓ o tipo e o número do documento, a categoria,
    // a contagem e a data do último lançamento (v1.23, seção 11.17): nunca descrição nem nome (RNF-007).
    // remembered_category = categoria que a lembrança deu à transação (a escolha da pessoa, user_category, prevalece).
    await db.execAsync(`
      ALTER TABLE transactions ADD COLUMN refund INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE transactions ADD COLUMN remembered_category TEXT;
      CREATE TABLE IF NOT EXISTS recipient_categories (
        doc_type TEXT NOT NULL,
        doc TEXT NOT NULL,
        category TEXT NOT NULL,
        tx_count INTEGER NOT NULL DEFAULT 0,
        last_tx_date TEXT,
        created_at TEXT NOT NULL,
        used_at TEXT NOT NULL,
        PRIMARY KEY (doc_type, doc)
      );
    `);
  }
  if (current < 11) {
    // requisitos v1.29–v1.32 / UX 0.21: reembolso na conta em par com a saída que ele devolveu (RF-008.11).
    // reimb_with = id da outra ponta (as duas pontas guardam); reimb_at = dia em que o app casou o par;
    // reimb_notice = 1 enquanto o aviso de mês que mudou (E-20 a) está aberto para o mês deste lançamento;
    // reimb_first = casado na primeira vez, quando o histórico todo é casado de uma vez (N-19).
    // reimb_rejected: pares que a pessoa desfez com "Não é reembolso"; nenhum dos dois casa sozinho de novo (N-18).
    // Nada do nome da outra ponta é guardado (RNF-007; Q51 b: o casamento é só pelo documento).
    await db.execAsync(`
      ALTER TABLE transactions ADD COLUMN reimb_with TEXT;
      ALTER TABLE transactions ADD COLUMN reimb_at TEXT;
      ALTER TABLE transactions ADD COLUMN reimb_notice INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE transactions ADD COLUMN reimb_first INTEGER NOT NULL DEFAULT 0;
      CREATE TABLE IF NOT EXISTS reimb_rejected (
        credit_id TEXT NOT NULL,
        debit_id TEXT NOT NULL,
        rejected_at TEXT NOT NULL,
        PRIMARY KEY (credit_id, debit_id)
      );
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
    await db.runAsync('DELETE FROM investments');
    await db.runAsync('DELETE FROM wealth_points');
    await db.runAsync('DELETE FROM recipient_categories');
    await db.runAsync('DELETE FROM reimb_rejected');
    await db.runAsync('DELETE FROM app_state');
  });
}
