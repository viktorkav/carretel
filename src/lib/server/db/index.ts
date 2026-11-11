import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from './schema';

// Estas cinco linhas de conexão estão duplicadas de propósito em
// scripts/semear-prancha.mjs (bloco `--aplicar`): esse script não pode
// importar este módulo porque `./schema` sem extensão só resolve pela
// cadeia do Vite, não em Node puro. Lá o fallback `?? 'dev.sqlite'` NÃO
// existe — a cópia exige DATABASE_PATH e sai com erro sem ele, porque o
// script abre a conexão só para rodar seis DELETE em seguida. Aqui, sem
// DATABASE_PATH, abrir dev.sqlite é o comportamento normal de dev; lá seria
// apagar o banco de desenvolvimento de verdade. Mudou uma dessas cópias?
// Confira a outra.
const dbFile = process.env.DATABASE_PATH ?? 'dev.sqlite';
const sqlite = new Database(dbFile);
sqlite.pragma('journal_mode = WAL');
sqlite.pragma('foreign_keys = ON');
sqlite.pragma('busy_timeout = 5000');

export const db = drizzle(sqlite, { schema });
export { schema };
