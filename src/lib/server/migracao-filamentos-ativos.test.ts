import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';

it('upgrade da versão anterior preserva rolos, vínculos de impressão e custos sem inventar catálogo ou ativação', () => {
 const pasta = mkdtempSync(join(tmpdir(), 'carretel-antes-ativos-'));
 const sqlite = new Database(':memory:');
 try {
  mkdirSync(join(pasta, 'meta'));
  const diario = JSON.parse(readFileSync('drizzle/meta/_journal.json', 'utf8'));
  const anteriores = { ...diario, entries: diario.entries.filter((e: { idx: number }) => e.idx <= 3) };
  writeFileSync(join(pasta, 'meta/_journal.json'), JSON.stringify(anteriores));
  for (const e of anteriores.entries) cpSync(`drizzle/${e.tag}.sql`, join(pasta, `${e.tag}.sql`));
  sqlite.pragma('foreign_keys = ON');
  migrate(drizzle(sqlite), { migrationsFolder: pasta });
  sqlite.exec(`
   INSERT INTO config (id, tarifa_kwh_cents) VALUES (1, 99);
   INSERT INTO impressora (id,nome,modelo) VALUES (1,'A1','Bambu A1');
   INSERT INTO rolo (id,codigo,marca,material,cor,codigo_bambu,preco_pago_cents,peso_liquido_inicial_g,status)
    VALUES (1,'PLA-PRETO-01','Bambu Lab','PLA Basic','Preto','GFA00',12900,1000,'aberto');
   INSERT INTO afericao (id,rolo_id,peso_liquido_g) VALUES (1,1,600);
   INSERT INTO impressao (id,nome_livre,impressora_id,rolo_id,inicio_em,duracao_s,gramas,custo_filamento_cents,custo_energia_cents,custo_depreciacao_cents,custo_manutencao_cents,custo_total_cents)
    VALUES (1,'Peça existente',1,1,1700000000000,3600,100,1290,11,12,13,1326);
  `);
  const roloAntes = sqlite.prepare('SELECT * FROM rolo').get();
  const outras = ['config','impressora','afericao','peca','impressao','manutencao'];
  const antes = outras.map((t) => sqlite.prepare(`SELECT * FROM ${t} ORDER BY id`).all());
  migrate(drizzle(sqlite), { migrationsFolder: './drizzle' });
  const { catalogo_item_id, ...roloDepois } = sqlite.prepare('SELECT * FROM rolo').get() as Record<string, unknown>;
  expect(catalogo_item_id).toBeNull();
  expect(roloDepois).toEqual(roloAntes);
  expect(outras.map((t) => sqlite.prepare(`SELECT * FROM ${t} ORDER BY id`).all())).toEqual(antes);
  expect(sqlite.prepare('SELECT * FROM filamento_ativo').all()).toEqual([]);
  expect(sqlite.pragma('foreign_key_check')).toEqual([]);
  migrate(drizzle(sqlite), { migrationsFolder: './drizzle' });
  expect(sqlite.prepare('SELECT COUNT(*) n FROM rolo').get()).toEqual({ n: 1 });
  expect(sqlite.prepare('SELECT custo_total_cents FROM impressao').get()).toEqual({ custo_total_cents: 1326 });
 } finally {
  sqlite.close();
  rmSync(pasta, { recursive: true, force: true });
 }
});
