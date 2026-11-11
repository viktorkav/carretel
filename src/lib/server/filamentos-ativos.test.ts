import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as schema from './db/schema';
import { ativarFilamento, desativarFilamento, listarAtivos } from './filamentos-ativos';

let sqlite: Database.Database;
let db: ReturnType<typeof drizzle<typeof schema>>;
let impressoras: Array<typeof schema.impressora.$inferSelect>;
let rolos: Array<typeof schema.rolo.$inferSelect>;
beforeEach(() => {
 sqlite = new Database(':memory:');
 sqlite.pragma('foreign_keys = ON');
 db = drizzle(sqlite, { schema });
 migrate(db, { migrationsFolder: './drizzle' });
 impressoras = db.insert(schema.impressora).values([
  { nome: 'A1', modelo: 'A1' }, { nome: 'P1S', modelo: 'P1S' }, { nome: 'Antiga', modelo: 'X', ativa: false }
 ]).returning().all();
 rolos = db.insert(schema.rolo).values([1,2,3,4,5].map((i) => ({ codigo: `PLA-PRETO-${i}`, marca: 'Bambu Lab', material: 'PLA Basic', cor: 'Preto', status: 'fechado' as const, precoPagoCents: 12900 }))).returning().all();
});
afterEach(() => sqlite.close());
const ativar = (posicao: number, indiceRolo = 0, indiceImpressora = 0) => ativarFilamento(db, { impressoraId: impressoras[indiceImpressora].id, roloId: rolos[indiceRolo].id, posicao });

describe('filamentos ativos por impressora', () => {
 it('preenche até quatro posições distintas em ordem', () => {
  for (const p of [4,2,1,3]) expect(ativar(p, p - 1)).toEqual({ ok: true });
  expect(listarAtivos(db)).toEqual([1,2,3,4].map((posicao) => ({ impressoraId: impressoras[0].id, posicao, roloId: rolos[posicao-1].id })));
 });
 it('troca posição ocupada e move o mesmo rolo sem duplicá-lo', () => {
  ativar(1, 0); ativar(2, 1);
  expect(ativar(2, 0)).toEqual({ ok: true });
  expect(listarAtivos(db)).toEqual([{ impressoraId: impressoras[0].id, posicao: 2, roloId: rolos[0].id }]);
  expect(ativar(2, 0)).toEqual({ ok: true });
  expect(listarAtivos(db)).toHaveLength(1);
 });
 it('recusa rolo de outra impressora sem esvaziar a posição de destino', () => {
  ativar(1, 0, 0); ativar(1, 1, 1);
  expect(ativar(1, 0, 1).ok).toBe(false);
  expect(listarAtivos(db)).toHaveLength(2);
  expect(listarAtivos(db)[1].roloId).toBe(rolos[1].id);
 });
 it('ativar e desativar não alteram rolo, consumo nem custos congelados', () => {
  db.insert(schema.impressao).values({ nomeLivre: 'Peça', impressoraId: impressoras[0].id, roloId: rolos[0].id, inicioEm: new Date(10000), duracaoS: 3600, gramas: 100, custoFilamentoCents: 1290, custoTotalCents: 1550 }).run();
  db.insert(schema.afericao).values({ roloId: rolos[0].id, pesoLiquidoG: 870 }).run();
  const antes = { rolos: db.select().from(schema.rolo).all(), impressoes: db.select().from(schema.impressao).all(), afericoes: db.select().from(schema.afericao).all() };
  ativar(1);
  expect(desativarFilamento(db, { impressoraId: impressoras[0].id, posicao: 1 })).toEqual({ ok: true });
  expect(listarAtivos(db)).toEqual([]);
  expect({ rolos: db.select().from(schema.rolo).all(), impressoes: db.select().from(schema.impressao).all(), afericoes: db.select().from(schema.afericao).all() }).toEqual(antes);
 });
 it.each([0, 5, -1, 1.5, NaN])('recusa posição inválida %s', (posicao) => {
  expect(ativar(posicao).ok).toBe(false);
  expect(desativarFilamento(db, { impressoraId: impressoras[0].id, posicao }).ok).toBe(false);
  expect(listarAtivos(db)).toEqual([]);
 });
 it.each([0, -1, 1.5, NaN, 9999])('recusa impressora e rolo inválidos %s', (id) => {
  expect(ativarFilamento(db, { impressoraId: id, roloId: rolos[0].id, posicao: 1 }).ok).toBe(false);
  expect(ativarFilamento(db, { impressoraId: impressoras[0].id, roloId: id, posicao: 1 }).ok).toBe(false);
  expect(listarAtivos(db)).toEqual([]);
 });
 it.each(['vazio', 'descartado'] as const)('recusa rolo %s e impressora inativa', (status) => {
  db.update(schema.rolo).set({ status }).where(eq(schema.rolo.id, rolos[0].id)).run();
  expect(ativar(1).ok).toBe(false);
  expect(ativar(1, 1, 2).ok).toBe(false);
 });
 it('oculta encerrados e máquinas desativadas e permite liberar seus vínculos', () => {
  ativar(1, 0, 0); ativar(1, 1, 1);
  db.update(schema.rolo).set({ status: 'vazio' }).where(eq(schema.rolo.id, rolos[0].id)).run();
  db.update(schema.impressora).set({ ativa: false }).where(eq(schema.impressora.id, impressoras[1].id)).run();
  expect(listarAtivos(db)).toEqual([]);
  expect(desativarFilamento(db, { impressoraId: impressoras[1].id, posicao: 1 })).toEqual({ ok: true });
  expect(ativar(2, 1, 0)).toEqual({ ok: true });
 });
 it.each(['vazio', 'descartado'] as const)('encerrar como %s e reabrir não restaura a posição automaticamente', (status) => {
  expect(ativar(1)).toEqual({ ok: true });
  db.update(schema.rolo).set({ status }).where(eq(schema.rolo.id, rolos[0].id)).run();
  expect(db.select().from(schema.filamentoAtivo).all()).toEqual([]);
  db.update(schema.rolo).set({ status: 'aberto' }).where(eq(schema.rolo.id, rolos[0].id)).run();
  expect(listarAtivos(db)).toEqual([]);
  expect(ativar(2, 0, 1)).toEqual({ ok: true });
 });
 it('desativar e reativar impressora não restaura seus filamentos nem remove os de outra máquina', () => {
  ativar(1, 0, 0); ativar(2, 1, 0); ativar(1, 2, 1);
  db.update(schema.impressora).set({ ativa: false }).where(eq(schema.impressora.id, impressoras[0].id)).run();
  db.update(schema.impressora).set({ ativa: true }).where(eq(schema.impressora.id, impressoras[0].id)).run();
  expect(listarAtivos(db)).toEqual([{ impressoraId: impressoras[1].id, posicao: 1, roloId: rolos[2].id }]);
  expect(ativar(2, 0, 1)).toEqual({ ok: true });
 });
 it('reverte a remoção da posição se a escrita seguinte falhar', () => {
  expect(ativar(1, 0)).toEqual({ ok: true });
  sqlite.exec(`CREATE TRIGGER falha_ativacao BEFORE INSERT ON filamento_ativo
   WHEN NEW.rolo_id = ${rolos[1].id} BEGIN SELECT RAISE(ABORT, 'falha controlada'); END`);
  expect(() => ativar(1, 1)).toThrow();
  expect(listarAtivos(db)).toEqual([{ impressoraId: impressoras[0].id, posicao: 1, roloId: rolos[0].id }]);
 });
 it('exclusão de cadastro sem histórico remove apenas seu vínculo', () => {
  ativar(1, 0, 0); ativar(1, 1, 1);
  db.delete(schema.rolo).where(eq(schema.rolo.id, rolos[0].id)).run();
  expect(listarAtivos(db)).toHaveLength(1);
  db.delete(schema.impressora).where(eq(schema.impressora.id, impressoras[1].id)).run();
  expect(listarAtivos(db)).toHaveLength(0);
  expect(db.select().from(schema.rolo).all()).toHaveLength(4);
 });
 it('constraints do banco recusam posição fora da faixa, rolo duplicado e FK inválida', () => {
  expect(ativar(1)).toEqual({ ok: true });
  const inserir = (impressoraId: number, posicao: number, roloId: number) => sqlite.prepare('INSERT INTO filamento_ativo (impressora_id,posicao,rolo_id) VALUES (?,?,?)').run(impressoraId,posicao,roloId);
  expect(() => inserir(impressoras[1].id, 2, rolos[0].id)).toThrow();
  expect(() => inserir(impressoras[0].id, 1, rolos[1].id)).toThrow();
  expect(() => inserir(impressoras[0].id, 5, rolos[1].id)).toThrow();
  expect(() => inserir(9999, 1, rolos[1].id)).toThrow();
  expect(() => inserir(impressoras[1].id, 1, 9999)).toThrow();
 });
});
