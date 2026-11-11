import { and, count, desc, eq, inArray, max, ne, sum } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { proximoCodigo, type TipoDoRolo } from '$lib/codigo';
import type { Finalidade } from '$lib/finalidade';
import { calcularCusto } from './custo';
import * as schema from './db/schema';
import {
	OBSERVACAO_PESAGEM_FINAL,
	compararSobra,
	estaEncerrado,
	statusDoMotivo,
	type MotivoEncerramento,
	type Rendimento
} from './encerramento';
import {
	calcularRestante,
	parcelasDoSaldo,
	validarSobraFinal,
	type EntradaEstoque,
	type Restante
} from './estoque';

export type Db = BetterSQLite3Database<typeof schema>;

/**
 * Resposta de toda operação de edição e exclusão.
 *
 * Nenhuma delas lança por entrada de usuário: quem chama é uma action, e a
 * regra do projeto é que action não responde 500 por formulário. `recalculadas`
 * é quantas impressões tiveram o custo reescrito — 0 quando o usuário recusou.
 */
export type Resultado = { ok: true; recalculadas?: number } | { ok: false; erro: string };

export interface DadosImpressao {
	pecaId?: number | null;
	nomeLivre: string;
	impressoraId: number;
	roloId: number;
	inicioEm: number;
	fimEm?: number | null;
	duracaoS: number;
	gramas: number;
	status: 'sucesso' | 'falha' | 'cancelada';
	motivoFalha?: string | null;
	camadaMm?: number | null;
	paredes?: number | null;
	infillPct?: number | null;
	bicoMm?: number | null;
	placaBuild?: string | null;
	finalidade: 'estudio' | 'homelab' | 'conteudo' | 'pessoal' | 'outro';
	imagemPath?: string | null;
	origem: 'manual' | 'ocr' | 'nuvem';
	taskIdNuvem?: string | null;
	/** Qual plate do arquivo rodou. Só a importação da nuvem sabe. */
	indicePlate?: number | null;
	/** O projeto na nuvem (`designId`), como texto. Ver `schema.impressao`. */
	projetoIdNuvem?: string | null;
	observacoes?: string | null;
}

export function lerConfig(db: Db) {
	const linha = db.select().from(schema.config).where(eq(schema.config.id, 1)).get();
	if (linha) return linha;
	return db.insert(schema.config).values({ id: 1 }).returning().get();
}

/**
 * Horas de máquina acumuladas. Falha também desgasta, então entra na conta.
 *
 * `exceto` tira UMA impressão da soma. Não é conveniência: é o que faz o
 * recálculo enxergar o mesmo denominador que o registro enxergou. No registro a
 * impressão ainda não está na tabela, então ela nunca dilui a própria parcela de
 * manutenção; no recálculo ela já está. Sem `exceto`, recalcular uma impressão
 * sem mudar nada devolveria um número que registro nenhum produziria — e a
 * primeira impressão de uma máquina passaria a ter manutenção onde tinha zero.
 */
export function horasAcumuladas(db: Db, impressoraId: number, exceto?: number): number {
	const filtro =
		exceto === undefined
			? eq(schema.impressao.impressoraId, impressoraId)
			: and(eq(schema.impressao.impressoraId, impressoraId), ne(schema.impressao.id, exceto));

	const r = db
		.select({ total: sum(schema.impressao.duracaoS) })
		.from(schema.impressao)
		.where(filtro)
		.get();
	return Number(r?.total ?? 0) / 3600;
}

export function custoManutencaoAcumulado(db: Db, impressoraId: number): number {
	const r = db
		.select({ total: sum(schema.manutencao.custoCents) })
		.from(schema.manutencao)
		.where(eq(schema.manutencao.impressoraId, impressoraId))
		.get();
	return Number(r?.total ?? 0);
}

/** As linhas do banco que decidem o saldo de um rolo, no formato do domínio. */
function entradaDoEstoque(db: Db, roloId: number): EntradaEstoque {
	const rol = db.select().from(schema.rolo).where(eq(schema.rolo.id, roloId)).get();
	if (!rol) throw new Error(`rolo ${roloId} não existe`);

	const afericoes = db
		.select({ pesoLiquidoG: schema.afericao.pesoLiquidoG, dataEm: schema.afericao.dataEm })
		.from(schema.afericao)
		.where(eq(schema.afericao.roloId, roloId))
		.all()
		.map((a) => ({ pesoLiquidoG: a.pesoLiquidoG, dataEm: a.dataEm.getTime() }));

	const impressoes = db
		.select({ gramas: schema.impressao.gramas, inicioEm: schema.impressao.inicioEm })
		.from(schema.impressao)
		.where(eq(schema.impressao.roloId, roloId))
		.all()
		.map((i) => ({ gramas: i.gramas, inicioEm: i.inicioEm.getTime() }));

	return { pesoInicialG: rol.pesoLiquidoInicialG, afericoes, impressoes };
}

export function estoqueDoRolo(db: Db, roloId: number): Restante {
	return calcularRestante(entradaDoEstoque(db, roloId));
}

/**
 * O saldo do rolo e as parcelas que o formam, lidos de uma vez. É o que a
 * conferência do registro precisa para prever, com a regra do domínio, o que
 * uma impressão ainda não gravada fará com o saldo.
 */
export function saldoEParcelasDoRolo(db: Db, roloId: number) {
	const entrada = entradaDoEstoque(db, roloId);
	return { ...calcularRestante(entrada), ...parcelasDoSaldo(entrada) };
}

export interface AlvoCusto {
	impressoraId: number;
	roloId: number;
	gramas: number;
	duracaoS: number;
	/**
	 * Id da própria impressão, quando ela JÁ existe no banco (recálculo). Ver
	 * `horasAcumuladas`: sem isto, ela entraria no próprio denominador de
	 * manutenção.
	 */
	impressaoId?: number;
}

export interface ColunasCusto {
	custoFilamentoCents: number;
	custoEnergiaCents: number;
	custoDepreciacaoCents: number;
	custoManutencaoCents: number;
	custoTotalCents: number;
}

/**
 * O ÚNICO lugar do sistema que monta as colunas de custo de uma impressão.
 *
 * O custo é congelado na linha da impressão de propósito — mexer na tarifa hoje
 * não pode reescrever o custo de uma peça de março. Mas correção de cadastro
 * exige poder reescrever, e aí passam a existir dois momentos que gravam custo:
 * o registro e o recálculo. Duas fórmulas seria a mesma conta divergindo com o
 * tempo, então as duas entram por aqui — `registrarImpressao` no insert,
 * `recalcularImpressao` no update.
 *
 * Sempre lê os valores de HOJE dos cadastros e da config. Devolve `null` quando
 * a impressora ou o rolo não existem, para quem chama decidir o que dizer ao
 * usuário em vez de receber um throw.
 */
export function colunasDeCusto(db: Db, alvo: AlvoCusto): ColunasCusto | null {
	const cfg = lerConfig(db);

	const imp = db
		.select()
		.from(schema.impressora)
		.where(eq(schema.impressora.id, alvo.impressoraId))
		.get();
	if (!imp) return null;

	const rol = db.select().from(schema.rolo).where(eq(schema.rolo.id, alvo.roloId)).get();
	if (!rol) return null;

	const custo = calcularCusto({
		gramas: alvo.gramas,
		duracaoS: alvo.duracaoS,
		rolo: {
			precoPagoCents: rol.precoPagoCents,
			pesoLiquidoInicialG: rol.pesoLiquidoInicialG
		},
		impressora: {
			precoCompraCents: imp.precoCompraCents,
			vidaUtilHoras: imp.vidaUtilHoras,
			potenciaMediaW: imp.potenciaMediaW
		},
		tarifaKwhCents: cfg.tarifaKwhCents,
		manutencao: {
			totalCents: custoManutencaoAcumulado(db, alvo.impressoraId),
			horasAcumuladas: horasAcumuladas(db, alvo.impressoraId, alvo.impressaoId)
		}
	});

	return {
		custoFilamentoCents: custo.filamentoCents,
		custoEnergiaCents: custo.energiaCents,
		custoDepreciacaoCents: custo.depreciacaoCents,
		custoManutencaoCents: custo.manutencaoCents,
		custoTotalCents: custo.totalCents
	};
}

export function registrarImpressao(db: Db, dados: DadosImpressao) {
	const custo = colunasDeCusto(db, {
		impressoraId: dados.impressoraId,
		roloId: dados.roloId,
		gramas: dados.gramas,
		duracaoS: dados.duracaoS
	});
	// Contrato antigo preservado: quem registra já validou a existência na
	// action, e um id inexistente aqui é erro de programação, não de usuário.
	if (!custo) throw new Error(`impressora ${dados.impressoraId} ou rolo ${dados.roloId} não existe`);

	return db
		.insert(schema.impressao)
		.values({
			...dados,
			inicioEm: new Date(dados.inicioEm),
			fimEm: dados.fimEm ? new Date(dados.fimEm) : null,
			...custo
		})
		.returning()
		.get();
}

/**
 * Reescreve o custo congelado de UMA impressão com os valores de hoje.
 * Devolve false quando a impressão (ou o cadastro que ela aponta) não existe.
 */
export function recalcularImpressao(db: Db, id: number): boolean {
	const imp = db.select().from(schema.impressao).where(eq(schema.impressao.id, id)).get();
	if (!imp) return false;

	const custo = colunasDeCusto(db, {
		impressoraId: imp.impressoraId,
		roloId: imp.roloId,
		gramas: imp.gramas,
		duracaoS: imp.duracaoS,
		impressaoId: imp.id
	});
	if (!custo) return false;

	db.update(schema.impressao).set(custo).where(eq(schema.impressao.id, id)).run();
	return true;
}

/** Recalcula em lote e devolve quantas impressões foram reescritas. */
function recalcularVarias(db: Db, ids: number[]): number {
	let feitas = 0;
	for (const id of ids) if (recalcularImpressao(db, id)) feitas++;
	return feitas;
}

function idsDaImpressora(db: Db, impressoraId: number): number[] {
	return db
		.select({ id: schema.impressao.id })
		.from(schema.impressao)
		.where(eq(schema.impressao.impressoraId, impressoraId))
		.all()
		.map((l) => l.id);
}

function idsDoRolo(db: Db, roloId: number): number[] {
	return db
		.select({ id: schema.impressao.id })
		.from(schema.impressao)
		.where(eq(schema.impressao.roloId, roloId))
		.all()
		.map((l) => l.id);
}

export function recalcularImpressoesDaImpressora(db: Db, impressoraId: number): number {
	return recalcularVarias(db, idsDaImpressora(db, impressoraId));
}

export function recalcularImpressoesDoRolo(db: Db, roloId: number): number {
	return recalcularVarias(db, idsDoRolo(db, roloId));
}

// ── quantas impressões dependem de cada cadastro ────────────────────────────
// É o número que a tela mostra ANTES de o usuário decidir sobre o recálculo.

export function contarImpressoesDaImpressora(db: Db, impressoraId: number): number {
	const r = db
		.select({ n: count() })
		.from(schema.impressao)
		.where(eq(schema.impressao.impressoraId, impressoraId))
		.get();
	return Number(r?.n ?? 0);
}

export function contarImpressoesDoRolo(db: Db, roloId: number): number {
	const r = db
		.select({ n: count() })
		.from(schema.impressao)
		.where(eq(schema.impressao.roloId, roloId))
		.get();
	return Number(r?.n ?? 0);
}

export function dependentesDaImpressora(db: Db, impressoraId: number) {
	const m = db
		.select({ n: count() })
		.from(schema.manutencao)
		.where(eq(schema.manutencao.impressoraId, impressoraId))
		.get();
	return {
		impressoes: contarImpressoesDaImpressora(db, impressoraId),
		manutencoes: Number(m?.n ?? 0)
	};
}

export function dependentesDoRolo(db: Db, roloId: number) {
	const a = db
		.select({ n: count() })
		.from(schema.afericao)
		.where(eq(schema.afericao.roloId, roloId))
		.get();
	return { impressoes: contarImpressoesDoRolo(db, roloId), afericoes: Number(a?.n ?? 0) };
}

// ── código do rolo ─────────────────────────────────────────────────────────
// A regra de formação é pura e mora em `$lib/codigo`. O que precisa do banco é
// só saber quais códigos já estão ocupados.

/**
 * Todos os códigos gravados.
 *
 * Sem parâmetro de exclusão de propósito: a edição não passa por aqui — ela
 * confere o código escolhido contra os outros rolos direto em `editarRolo`, com
 * a mesma consulta que o índice único vai reforçar. Um `exceto` aqui seria
 * parâmetro que ninguém usa e que o próximo leitor tomaria por contrato.
 */
export function codigosEmUso(db: Db): string[] {
	return db
		.select({ codigo: schema.rolo.codigo })
		.from(schema.rolo)
		.all()
		.map((r) => r.codigo);
}

/** O próximo código livre para um tipo, olhando o que já existe no banco. */
export function codigoDisponivel(db: Db, tipo: TipoDoRolo): string {
	return proximoCodigo(tipo, codigosEmUso(db));
}

// ── criação ────────────────────────────────────────────────────────────────

/**
 * Campos que descrevem o filamento em si. Depois da fusão eles moram no rolo, e
 * dois rolos iguais os repetem — é essa repetição que os torna independentes.
 */
export interface FichaDoRolo {
	marca: string;
	material: string;
	cor: string;
	corHex: string | null;
	densidade: number;
	tempBico: number | null;
	tempMesa: number | null;
	codigoBambu: string | null;
	catalogoItemId?: string | null;
	fonteCatalogo: 'bambu' | 'ofd' | 'manual';
}

export interface NovoRolo extends FichaDoRolo {
	/** Ausente = o sistema gera. Só a edição digita código à mão. */
	codigo?: string;
	apelido: string | null;
	precoPagoCents: number;
	pesoLiquidoInicialG: number;
	pesoCarretelG: number;
	fornecedor: string | null;
	notas?: string | null;
	status?: 'fechado' | 'aberto' | 'vazio' | 'descartado';
}

export type Criacao = { ok: true; id: number; codigo: string } | { ok: false; erro: string };

/**
 * Cadastra um rolo. **Nunca reaproveita linha existente** — é o ponto inteiro
 * da fusão: comprar outro rolo igual cria um registro novo, com código novo,
 * porque é ele que guarda o preço daquela compra.
 *
 * O `catch` existe porque o código é único no banco: dois cadastros disputando
 * o mesmo número, ou um código digitado à mão que colide, viravam
 * `UNIQUE constraint failed` — ou seja, 500 por entrada de usuário.
 */
export function criarRolo(db: Db, dados: NovoRolo): Criacao {
	const codigo = dados.codigo ?? codigoDisponivel(db, dados);
	try {
		const linha = db
			.insert(schema.rolo)
			.values({
				codigo,
				marca: dados.marca,
				material: dados.material,
				cor: dados.cor,
				corHex: dados.corHex,
				densidade: dados.densidade,
				tempBico: dados.tempBico,
				tempMesa: dados.tempMesa,
				codigoBambu: dados.codigoBambu,
				catalogoItemId: dados.catalogoItemId ?? null,
				fonteCatalogo: dados.fonteCatalogo,
				apelido: dados.apelido,
				precoPagoCents: dados.precoPagoCents,
				pesoLiquidoInicialG: dados.pesoLiquidoInicialG,
				pesoCarretelG: dados.pesoCarretelG,
				fornecedor: dados.fornecedor,
				notas: dados.notas ?? null,
				status: dados.status ?? 'fechado'
			})
			.returning()
			.get();
		return { ok: true, id: linha.id, codigo: linha.codigo };
	} catch (e) {
		const detalhe = e instanceof Error ? e.message : String(e);
		if (detalhe.includes('UNIQUE')) {
			return { ok: false, erro: `o código ${codigo} já está em uso; escolha outro` };
		}
		throw e;
	}
}

// ── edição ─────────────────────────────────────────────────────────────────

export interface EdicaoImpressao {
	nomeLivre: string;
	impressoraId: number;
	roloId: number;
	inicioEm: number;
	/**
	 * Ausente (`undefined`) significa "não mexe"; `null` limpa de verdade.
	 *
	 * A distinção não é preciosismo: a tela de edição não expõe o horário de
	 * término, e quem preenche `fimEm` é a importação da nuvem. Tratar ausente
	 * como `null` faria corrigir as gramas de uma impressão importada apagar o
	 * término dela.
	 */
	fimEm?: number | null;
	duracaoS: number;
	gramas: number;
	status: 'sucesso' | 'falha' | 'cancelada';
	motivoFalha?: string | null;
	camadaMm?: number | null;
	paredes?: number | null;
	infillPct?: number | null;
	finalidade: 'estudio' | 'homelab' | 'conteudo' | 'pessoal' | 'outro';
	observacoes?: string | null;
}

/**
 * Corrige uma impressão já registrada.
 *
 * Estoque não precisa de nada especial: `estoqueDoRolo` deriva o restante das
 * linhas de impressão a cada leitura, então trocar as gramas ou o rolo já
 * reposiciona os dois estoques envolvidos. O que precisa de decisão é o custo,
 * que é congelado — daí `recalcular` ser um parâmetro e não um efeito.
 */
export function editarImpressao(
	db: Db,
	id: number,
	dados: EdicaoImpressao,
	recalcular: boolean
): Resultado {
	const atual = db.select().from(schema.impressao).where(eq(schema.impressao.id, id)).get();
	if (!atual) return { ok: false, erro: 'impressão não encontrada' };

	const imp = db
		.select({ id: schema.impressora.id })
		.from(schema.impressora)
		.where(eq(schema.impressora.id, dados.impressoraId))
		.get();
	if (!imp) return { ok: false, erro: 'impressora não encontrada' };

	const rol = db
		.select({ id: schema.rolo.id })
		.from(schema.rolo)
		.where(eq(schema.rolo.id, dados.roloId))
		.get();
	if (!rol) return { ok: false, erro: 'rolo não encontrado' };

	db.update(schema.impressao)
		.set({
			nomeLivre: dados.nomeLivre,
			impressoraId: dados.impressoraId,
			roloId: dados.roloId,
			inicioEm: new Date(dados.inicioEm),
			// Espalhado condicionalmente: a chave só entra no `set` quando o
			// chamador falou dela. Ver `EdicaoImpressao.fimEm`.
			...(dados.fimEm === undefined
				? {}
				: { fimEm: dados.fimEm === null ? null : new Date(dados.fimEm) }),
			duracaoS: dados.duracaoS,
			gramas: dados.gramas,
			status: dados.status,
			motivoFalha: dados.motivoFalha ?? null,
			camadaMm: dados.camadaMm ?? null,
			paredes: dados.paredes ?? null,
			infillPct: dados.infillPct ?? null,
			finalidade: dados.finalidade,
			observacoes: dados.observacoes ?? null
		})
		.where(eq(schema.impressao.id, id))
		.run();

	if (!recalcular) return { ok: true, recalculadas: 0 };
	return { ok: true, recalculadas: recalcularImpressao(db, id) ? 1 : 0 };
}

export interface EdicaoImpressora {
	nome: string;
	modelo: string;
	apelidoBambu: string | null;
	precoCompraCents: number;
	vidaUtilHoras: number;
	potenciaMediaW: number;
	ativa: boolean;
}

export function editarImpressora(
	db: Db,
	id: number,
	dados: EdicaoImpressora,
	recalcular: boolean
): Resultado {
	const atual = db
		.select({ id: schema.impressora.id })
		.from(schema.impressora)
		.where(eq(schema.impressora.id, id))
		.get();
	if (!atual) return { ok: false, erro: 'impressora não encontrada' };

	db.update(schema.impressora).set(dados).where(eq(schema.impressora.id, id)).run();

	if (!recalcular) return { ok: true, recalculadas: 0 };
	return { ok: true, recalculadas: recalcularImpressoesDaImpressora(db, id) };
}

export interface EdicaoRolo extends FichaDoRolo {
	codigo: string;
	apelido: string | null;
	precoPagoCents: number;
	pesoLiquidoInicialG: number;
	pesoCarretelG: number;
	fornecedor: string | null;
	notas: string | null;
	status: 'fechado' | 'aberto' | 'vazio' | 'descartado';
}

export function editarRolo(db: Db, id: number, dados: EdicaoRolo, recalcular: boolean): Resultado {
	const atual = db.select({ id: schema.rolo.id }).from(schema.rolo).where(eq(schema.rolo.id, id)).get();
	if (!atual) return { ok: false, erro: 'rolo não encontrado' };

	// O código é o nome escrito no carretel: dois iguais significam dois
	// carretéis na prateleira com o mesmo nome. A trava existe no banco (índice
	// único), e ela sozinha devolveria 500; aqui ela vira mensagem de formulário.
	const ocupado = db
		.select({ id: schema.rolo.id })
		.from(schema.rolo)
		.where(and(eq(schema.rolo.codigo, dados.codigo), ne(schema.rolo.id, id)))
		.get();
	if (ocupado) {
		return { ok: false, erro: `o código ${dados.codigo} já é de outro rolo; escolha outro` };
	}

	// `validarPesoAferido` já recusa pesagem acima do peso inicial. Baixar o peso
	// inicial por baixo de uma pesagem existente recria pela porta dos fundos
	// exatamente o estado que aquela regra impede — e, pior, deixa o rolo com
	// percentual acima de 100%. Se a pesagem é que está errada, ela agora tem
	// tela para ser apagada.
	const maiorAfericao = db
		.select({ pico: max(schema.afericao.pesoLiquidoG) })
		.from(schema.afericao)
		.where(eq(schema.afericao.roloId, id))
		.get();
	const pico = Number(maiorAfericao?.pico ?? 0);
	if (pico > 0 && dados.pesoLiquidoInicialG < pico) {
		return {
			ok: false,
			erro:
				`peso líquido inicial (${dados.pesoLiquidoInicialG} g) é menor que uma pesagem já ` +
				`registrada (${pico} g); apague a pesagem errada antes, ou corrija o peso para cima`
		};
	}

	// `fonteCatalogo` NÃO entra: ela diz de onde vieram densidade e temperaturas,
	// e corrigir um erro de digitação na cor não pode rebaixar para "manual" uma
	// linha que veio do catálogo — nem promover o contrário.
	db.update(schema.rolo)
		.set({
			codigo: dados.codigo,
			marca: dados.marca,
			material: dados.material,
			cor: dados.cor,
			corHex: dados.corHex,
			densidade: dados.densidade,
			tempBico: dados.tempBico,
			tempMesa: dados.tempMesa,
			codigoBambu: dados.codigoBambu,
			apelido: dados.apelido,
			precoPagoCents: dados.precoPagoCents,
			pesoLiquidoInicialG: dados.pesoLiquidoInicialG,
			pesoCarretelG: dados.pesoCarretelG,
			fornecedor: dados.fornecedor,
			notas: dados.notas,
			status: dados.status
		})
		.where(eq(schema.rolo.id, id))
		.run();

	if (!recalcular) return { ok: true, recalculadas: 0 };
	return { ok: true, recalculadas: recalcularImpressoesDoRolo(db, id) };
}

// ── encerramento ───────────────────────────────────────────────────────────
// Encerrar NÃO é apagar: o rolo continua no banco, as impressões dele continuam
// intactas e o custo delas continua congelado. O que muda é uma coluna de
// status — e é ela que tira o rolo do formulário de nova impressão, da sugestão
// da nuvem e dos alertas do painel.

export interface Encerramento {
	motivo: MotivoEncerramento;
	/** Sobra pesada na balança. `null` = não pesou; `0` é um valor legítimo. */
	sobraG: number | null;
}

/**
 * Encerra um rolo, opcionalmente gravando a pesagem final.
 *
 * **A ordem aqui é a feature.** A sobra ESTIMADA é lida antes de a pesagem
 * entrar no banco, porque a pesagem vira a âncora de `calcularRestante` no
 * instante em que é gravada — lida depois, a estimativa seria a própria
 * pesagem, e a comparação estimativa × realidade daria zero de diferença
 * sempre. Não é otimização de leitura: é a diferença entre a feature funcionar
 * e ser uma tautologia.
 *
 * Valida tudo ANTES de escrever qualquer coisa: uma sobra impossível não pode
 * deixar o rolo encerrado "pela metade".
 */
export function encerrarRolo(db: Db, id: number, dados: Encerramento): Resultado {
	const rol = db.select().from(schema.rolo).where(eq(schema.rolo.id, id)).get();
	if (!rol) return { ok: false, erro: 'rolo não encontrado' };

	if (dados.sobraG !== null) {
		const valido = validarSobraFinal(dados.sobraG, rol.pesoLiquidoInicialG);
		if (!valido.ok) return { ok: false, erro: valido.erro };
	}

	const sobraG = dados.sobraG;
	db.transaction((tx) => {
		if (sobraG !== null) {
			tx.insert(schema.afericao)
				.values({ roloId: id, pesoLiquidoG: sobraG, observacao: OBSERVACAO_PESAGEM_FINAL })
				.run();
		}
		tx.update(schema.rolo)
			.set({ status: statusDoMotivo(dados.motivo) })
			.where(eq(schema.rolo.id, id))
			.run();
	});

	return { ok: true };
}

/**
 * Desfaz o encerramento.
 *
 * **A pesagem final CONTINUA registrada** — e isso é uma decisão, não um
 * esquecimento. A pesagem é uma medida real da balança; o status é uma
 * intenção. Reabrir corrige a intenção, e a medida continua sendo a melhor
 * âncora do que existe no carretel agora. Apagá-la de carona destruiria dado
 * por um caminho que não é sobre dado — e, se a pesagem é que estava errada,
 * ela já tem tela própria para ser apagada, com a explicação da âncora junto.
 *
 * O status de volta é `aberto` ou `fechado` conforme o rolo já tivesse sido
 * aberto: devolver como `aberto` um rolo lacrado inventaria uma abertura que
 * nunca houve, e é `dataAbertura` que liga o alerta de umidade.
 */
export function reabrirRolo(db: Db, id: number): Resultado {
	const rol = db.select().from(schema.rolo).where(eq(schema.rolo.id, id)).get();
	if (!rol) return { ok: false, erro: 'rolo não encontrado' };
	if (!estaEncerrado(rol.status)) {
		return { ok: false, erro: `o filamento ${rol.codigo} não está encerrado` };
	}

	db.update(schema.rolo)
		.set({ status: rol.dataAbertura ? 'aberto' : 'fechado' })
		.where(eq(schema.rolo.id, id))
		.run();
	return { ok: true };
}

/** A pesagem final mais recente de um rolo, ou `null` se ele nunca teve uma. */
export function pesagemFinalDoRolo(db: Db, roloId: number) {
	return (
		db
			.select()
			.from(schema.afericao)
			.where(
				and(
					eq(schema.afericao.roloId, roloId),
					eq(schema.afericao.observacao, OBSERVACAO_PESAGEM_FINAL)
				)
			)
			.orderBy(desc(schema.afericao.dataEm), desc(schema.afericao.id))
			.get() ?? null
	);
}

/**
 * A comparação, ou o motivo de não haver uma. Os dois motivos pedem frases
 * diferentes na tela — "pese da próxima vez" e "esta pesagem já ficou para trás"
 * são conselhos diferentes —, então eles não se fundem num `null`.
 */
export type LeituraRendimento =
	| { ok: true; rendimento: Rendimento }
	| { ok: false; motivo: 'sem-pesagem' | 'usado-depois' };

/**
 * A comparação que dá valor ao encerramento: sobra estimada × sobra real.
 *
 * A estimada é RECALCULADA, e não guardada em lugar nenhum — o sistema inteiro
 * deriva estoque das linhas a cada leitura, e um número congelado aqui seria a
 * primeira redundância a divergir. O jeito de recuperá-la é tirar a pesagem
 * final da conta: sem ela, a âncora volta a ser a pesagem anterior (ou o peso
 * inicial), que é exatamente o estado em que o sistema estava um instante antes
 * do encerramento.
 *
 * Só a pesagem final MAIS RECENTE sai da conta. Encerrar, reabrir, imprimir e
 * encerrar de novo é um caminho real, e nesse caso a pesagem final anterior é
 * uma âncora legítima da segunda estimativa.
 */
export function rendimentoDoRolo(db: Db, roloId: number): LeituraRendimento {
	const rol = db.select().from(schema.rolo).where(eq(schema.rolo.id, roloId)).get();
	if (!rol) return { ok: false, motivo: 'sem-pesagem' };

	const pesagem = pesagemFinalDoRolo(db, roloId);
	if (!pesagem) return { ok: false, motivo: 'sem-pesagem' };

	const impressoes = db
		.select({ gramas: schema.impressao.gramas, inicioEm: schema.impressao.inicioEm })
		.from(schema.impressao)
		.where(eq(schema.impressao.roloId, roloId))
		.all()
		.map((i) => ({ gramas: i.gramas, inicioEm: i.inicioEm.getTime() }));

	// Para o par de números significar alguma coisa, a pesagem final precisa ser
	// a ÚLTIMA coisa que aconteceu com o rolo. Encerrar, reabrir, imprimir mais e
	// encerrar de novo sem pesar deixaria a estimativa descontando peças que a
	// balança nunca viu — dois números de instantes diferentes lado a lado, com
	// um rótulo dizendo que são o mesmo.
	if (impressoes.some((i) => i.inicioEm > pesagem.dataEm.getTime())) {
		return { ok: false, motivo: 'usado-depois' };
	}

	const afericoes = db
		.select()
		.from(schema.afericao)
		.where(eq(schema.afericao.roloId, roloId))
		.all()
		.filter((a) => a.id !== pesagem.id)
		.map((a) => ({ pesoLiquidoG: a.pesoLiquidoG, dataEm: a.dataEm.getTime() }));

	const estimada = calcularRestante({
		pesoInicialG: rol.pesoLiquidoInicialG,
		afericoes,
		impressoes
	});

	return {
		ok: true,
		rendimento: compararSobra({
			estimadaG: estimada.restanteG,
			realG: pesagem.pesoLiquidoG,
			pesoInicialG: rol.pesoLiquidoInicialG
		})
	};
}

// ── exclusão ───────────────────────────────────────────────────────────────
// Cadastro só sai quando nada depende dele. Impressão órfã não existe: o custo
// dela é histórico e o painel soma por ela.

export function excluirImpressora(db: Db, id: number): Resultado {
	const atual = db
		.select({ id: schema.impressora.id })
		.from(schema.impressora)
		.where(eq(schema.impressora.id, id))
		.get();
	if (!atual) return { ok: false, erro: 'impressora não encontrada' };

	const dep = dependentesDaImpressora(db, id);
	if (dep.impressoes > 0 || dep.manutencoes > 0) {
		return {
			ok: false,
			erro:
				`impressora em uso: ${dep.impressoes} impressão(ões) e ${dep.manutencoes} manutenção(ões) ` +
				`apontam para ela; apague-as antes, ou marque a impressora como inativa`
		};
	}

	db.delete(schema.impressora).where(eq(schema.impressora.id, id)).run();
	return { ok: true };
}

/**
 * O rolo sai com as pesagens dele. A pesagem não é um cadastro independente: é
 * uma medida DAQUELE rolo, sem sentido fora dele. O que trava a exclusão é a
 * impressão, que é histórico com custo próprio.
 */
export function excluirRolo(db: Db, id: number): Resultado {
	const atual = db.select({ id: schema.rolo.id }).from(schema.rolo).where(eq(schema.rolo.id, id)).get();
	if (!atual) return { ok: false, erro: 'rolo não encontrado' };

	const dep = dependentesDoRolo(db, id);
	if (dep.impressoes > 0) {
		return {
			ok: false,
			erro: `rolo em uso: ${dep.impressoes} impressão(ões) saíram dele; apague-as antes`
		};
	}

	db.transaction((tx) => {
		tx.delete(schema.afericao).where(eq(schema.afericao.roloId, id)).run();
		tx.delete(schema.rolo).where(eq(schema.rolo.id, id)).run();
	});
	return { ok: true };
}

/**
 * Apaga uma pesagem errada. É a âncora de `calcularRestante`: sem esta tela, um
 * número digitado torto travava o restante do rolo para sempre. Apagada, a
 * âncora volta a ser a pesagem anterior — ou o peso inicial do cadastro.
 */
export function excluirAfericao(db: Db, id: number): Resultado {
	const atual = db
		.select({ id: schema.afericao.id })
		.from(schema.afericao)
		.where(eq(schema.afericao.id, id))
		.get();
	if (!atual) return { ok: false, erro: 'pesagem não encontrada' };

	db.delete(schema.afericao).where(eq(schema.afericao.id, id)).run();
	return { ok: true };
}

/** A impressão é folha: nada aponta para ela, então some sem deixar órfão. */
export function excluirImpressao(db: Db, id: number): Resultado {
	const atual = db
		.select({ id: schema.impressao.id })
		.from(schema.impressao)
		.where(eq(schema.impressao.id, id))
		.get();
	if (!atual) return { ok: false, erro: 'impressão não encontrada' };

	db.delete(schema.impressao).where(eq(schema.impressao.id, id)).run();
	return { ok: true };
}

/**
 * Reclassifica a finalidade de várias impressões de uma vez.
 *
 * **Por que isto existe:** as 11 impressões reais entraram todas como `outro`,
 * e consertá-las uma a uma custava abrir a peça, entrar em edição, trocar o
 * campo, salvar e voltar — cinco interações vezes onze. O defeito foi de lote;
 * a correção precisa ser de lote também.
 *
 * **Por que é um `update` direto e não passa por `editarImpressao`.** Finalidade
 * é CLASSIFICAÇÃO, não parcela de custo: ela não entra em `calcularCusto` e não
 * muda nem uma casa do valor congelado. Passar por uma edição completa aqui
 * obrigaria a reenviar duração, gramas e início de cada linha, e abriria a porta
 * para o recálculo — que é como corrigir o balde de uma peça de março acabaria
 * usando a tarifa de agosto.
 *
 * Devolve quantas linhas existiam de fato: id que não está no banco não é erro
 * (a lista pode ter envelhecido numa aba aberta), só não conta.
 */
export function aplicarFinalidadeEmLote(
	db: Db,
	ids: number[],
	finalidade: Finalidade
): number {
	let alteradas = 0;
	// Mesmo teto de variáveis por statement que a importação já respeita (999 no
	// SQLite padrão): sem os blocos, um lote grande vira exceção de driver, e
	// exceção de driver numa action é 500 por entrada de usuário.
	const BLOCO = 400;
	for (let i = 0; i < ids.length; i += BLOCO) {
		const fatia = ids.slice(i, i + BLOCO);
		if (fatia.length === 0) continue;
		const r = db
			.update(schema.impressao)
			.set({ finalidade })
			.where(inArray(schema.impressao.id, fatia))
			.run();
		alteradas += r.changes;
	}
	return alteradas;
}
