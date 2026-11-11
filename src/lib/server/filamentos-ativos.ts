import { and, asc, eq, notInArray, or } from 'drizzle-orm';
import type { Db } from './repo';
import * as schema from './db/schema';
import { estaEncerrado } from './encerramento';

export interface PosicaoFilamento { impressoraId: number; posicao: number }
export interface AtivacaoFilamento extends PosicaoFilamento { roloId: number }
export type ResultadoAtivacao = { ok: true } | { ok: false; erro: string };

const idValido = (id: number): boolean => Number.isSafeInteger(id) && id > 0;
const posicaoValida = (posicao: number): boolean => Number.isInteger(posicao) && posicao >= 1 && posicao <= 4;

/** Vínculos utilizáveis agora. Os triggers da migration 0004 removem permanentemente
 * o carregamento ao encerrar o rolo/desativar a impressora. Reabertura não o restaura.
 * Os filtros também protegem a leitura de vínculos inconsistentes inseridos fora dos helpers. */
export function listarAtivos(db: Db): AtivacaoFilamento[] {
 return db.select({
  impressoraId: schema.filamentoAtivo.impressoraId,
  posicao: schema.filamentoAtivo.posicao,
  roloId: schema.filamentoAtivo.roloId
 }).from(schema.filamentoAtivo)
  .innerJoin(schema.rolo, eq(schema.rolo.id, schema.filamentoAtivo.roloId))
  .innerJoin(schema.impressora, eq(schema.impressora.id, schema.filamentoAtivo.impressoraId))
  .where(and(eq(schema.impressora.ativa, true), notInArray(schema.rolo.status, ['vazio', 'descartado'])))
  .orderBy(asc(schema.filamentoAtivo.impressoraId), asc(schema.filamentoAtivo.posicao)).all();
}

/** Validação e troca ocorrem no mesmo lock de escrita; falhas preservam todas as posições. */
export function ativarFilamento(db: Db, dados: AtivacaoFilamento): ResultadoAtivacao {
 if (!idValido(dados.impressoraId)) return { ok: false, erro: 'Selecione uma impressora válida.' };
 if (!idValido(dados.roloId)) return { ok: false, erro: 'Selecione um filamento válido.' };
 if (!posicaoValida(dados.posicao)) return { ok: false, erro: 'Escolha uma posição de 1 a 4.' };
 return db.transaction((tx): ResultadoAtivacao => {
  const impressora = tx.select().from(schema.impressora).where(eq(schema.impressora.id, dados.impressoraId)).get();
  if (!impressora?.ativa) return { ok: false, erro: 'A impressora não existe ou está inativa.' };
  const rolo = tx.select().from(schema.rolo).where(eq(schema.rolo.id, dados.roloId)).get();
  if (!rolo) return { ok: false, erro: 'Filamento não encontrado.' };
  if (estaEncerrado(rolo.status)) return { ok: false, erro: 'Um filamento encerrado não pode ser ativado.' };
  const atual = tx.select().from(schema.filamentoAtivo).where(eq(schema.filamentoAtivo.roloId, dados.roloId)).get();
  if (atual && atual.impressoraId !== dados.impressoraId) {
   return { ok: false, erro: 'Este filamento já está associado a outra impressora. Desative essa associação antes de movê-lo.' };
  }
  if (atual?.posicao === dados.posicao) return { ok: true };
  tx.delete(schema.filamentoAtivo).where(or(
   eq(schema.filamentoAtivo.roloId, dados.roloId),
   and(eq(schema.filamentoAtivo.impressoraId, dados.impressoraId), eq(schema.filamentoAtivo.posicao, dados.posicao))
  )).run();
  tx.insert(schema.filamentoAtivo).values(dados).run();
  return { ok: true };
 }, { behavior: 'immediate' });
}

/** Liberar posição não altera abertura, estoque ou histórico. Repetir a operação é seguro. */
export function desativarFilamento(db: Db, dados: PosicaoFilamento): ResultadoAtivacao {
 if (!idValido(dados.impressoraId)) return { ok: false, erro: 'Selecione uma impressora válida.' };
 if (!posicaoValida(dados.posicao)) return { ok: false, erro: 'Escolha uma posição de 1 a 4.' };
 db.delete(schema.filamentoAtivo).where(and(
  eq(schema.filamentoAtivo.impressoraId, dados.impressoraId),
  eq(schema.filamentoAtivo.posicao, dados.posicao)
 )).run();
 return { ok: true };
}
