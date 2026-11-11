/**
 * Gravação das tarefas da nuvem como impressões do Carretel.
 *
 * Este é o único arquivo da pasta que fala com o banco. Ele NÃO calcula custo:
 * quem calcula e congela é `registrarImpressao`, e duplicar a conta aqui seria
 * criar dois lugares para o custo divergir com o tempo.
 *
 * Duas garantias que valem para o arquivo inteiro:
 *
 * - **Idempotência.** `impressao.taskIdNuvem` tem índice único e é conferido
 *   antes de gravar. Importar duas vezes o mesmo histórico não duplica nada.
 * - **Uma tarefa ruim não derruba o lote.** Cada linha é validada e gravada
 *   por conta própria; o que não dá vira `pulada` com motivo escrito, e as
 *   outras entram normalmente.
 */

import { and, eq, inArray, isNotNull, isNull, or } from 'drizzle-orm';
import { normalizarFinalidade, resumirFinalidades, type Finalidade } from '$lib/finalidade';
import * as schema from '../db/schema';
import { campoNumericoObrigatorio } from '../formulario';
import { registrarImpressao, type Db } from '../repo';
import { baixarCapas } from './imagem';
import { massaPelaDensidade, notaDeMassa } from './massa';
import type { TarefaNuvem } from './parse';
import type { ImpressoraCandidata, RoloCandidato } from './sugestao';

// O domínio de finalidade mora em `$lib/finalidade`, porque agora ele é usado
// dos dois lados: aqui, na importação, e na edição em lote de `/impressoes`.
// Re-exportado para não quebrar quem já importava daqui.
export type { Finalidade };

export interface EntradaImportacao {
	tarefa: TarefaNuvem;
	/** Escolhido na tela. `null` = o usuário não atribuiu, então não grava. */
	roloId: number | null;
	impressoraId: number | null;
	finalidade: Finalidade;
	/**
	 * Aceite explícito, linha a linha, para as tarefas que só entram com dado
	 * sabidamente aproximado (hoje: multimaterial). Sem ele, a tarefa é pulada.
	 */
	confirmado?: boolean;
	/**
	 * Peso digitado à mão, em gramas. Obrigatório para a tarefa que abortou —
	 * o peso que a nuvem manda dela é a estimativa cheia do fatiamento.
	 * `undefined` = o campo nem existia; `null` = existia e veio imprestável.
	 */
	gramasInformadas?: number | null;
	/** Caminho da capa já baixada, quando houve. A URL da nuvem expira em 1 h. */
	imagemPath?: string | null;
}

export interface ResultadoImportacao {
	gravadas: number;
	/** Já estavam no banco pelo `taskIdNuvem` — o caso normal da segunda rodada. */
	duplicadas: number;
	puladas: { taskId: string; nome: string; motivo: string }[];
	gramas: number;
	duracaoS: number;
	/** Quantas tiveram o peso reescrito pela densidade do rolo (ver `massa.ts`). */
	recalculadasPorDensidade: number;
	/** Quantas entraram com peso digitado à mão porque a peça abortou. */
	comPesoDigitado: number;
}

/**
 * Rolos prontos para a sugestão.
 *
 * Era um `innerJoin` com `filamento` — material, cor e `codigoBambu` moravam lá.
 * Depois da fusão eles são colunas do próprio rolo, então a amarração por
 * material e código continua exatamente a mesma, sem junção nenhuma.
 *
 * O rótulo mudou de propósito: com dois rolos iguais no banco (que é o caso
 * normal agora), `Bambu PLA Preto` aparecia duas vezes idêntico no `select` da
 * tela de importação. O **código** vai na frente porque é ele que distingue —
 * e é o mesmo que está escrito no carretel.
 */
export function candidatosDeRolo(db: Db): RoloCandidato[] {
	return db
		.select({
			id: schema.rolo.id,
			codigo: schema.rolo.codigo,
			apelido: schema.rolo.apelido,
			status: schema.rolo.status,
			dataAbertura: schema.rolo.dataAbertura,
			material: schema.rolo.material,
			corHex: schema.rolo.corHex,
			codigoBambu: schema.rolo.codigoBambu,
			cor: schema.rolo.cor,
			marca: schema.rolo.marca
		})
		.from(schema.rolo)
		.all()
		.map((r) => ({
			id: r.id,
			apelido: `${r.codigo} · ${r.marca} ${r.material} ${r.cor}${r.apelido ? ` (${r.apelido})` : ''}`,
			status: r.status,
			material: r.material,
			corHex: r.corHex,
			codigoBambu: r.codigoBambu,
			dataAbertura: r.dataAbertura ? r.dataAbertura.getTime() : null
		}));
}

export function candidatasDeImpressora(db: Db): ImpressoraCandidata[] {
	return db
		.select({
			id: schema.impressora.id,
			nome: schema.impressora.nome,
			apelidoBambu: schema.impressora.apelidoBambu
		})
		.from(schema.impressora)
		.where(eq(schema.impressora.ativa, true))
		.all();
}

/** Os `taskIdNuvem` que já existem no banco, entre os informados. */
function idsJaImportados(db: Db, taskIds: string[]): Set<string> {
	if (taskIds.length === 0) return new Set();

	const encontrados = new Set<string>();
	// SQLite tem teto de variáveis por statement (999 por padrão). O histórico
	// inteiro da conta passa disso com folga, então a consulta vai em blocos.
	const BLOCO = 400;
	for (let i = 0; i < taskIds.length; i += BLOCO) {
		const fatia = taskIds.slice(i, i + BLOCO);
		const linhas = db
			.select({ taskIdNuvem: schema.impressao.taskIdNuvem })
			.from(schema.impressao)
			.where(inArray(schema.impressao.taskIdNuvem, fatia))
			.all();
		for (const l of linhas) if (l.taskIdNuvem) encontrados.add(l.taskIdNuvem);
	}
	return encontrados;
}

/** Quantas impressões vindas da nuvem já existem no banco, no total. */
export function totalJaImportado(db: Db): number {
	return db
		.select({ taskIdNuvem: schema.impressao.taskIdNuvem })
		.from(schema.impressao)
		.where(isNotNull(schema.impressao.taskIdNuvem))
		.all().length;
}

/**
 * Divide o que veio da nuvem entre "já está aqui" e "é novo". A tela só pede
 * atribuição de rolo para as novas — é o que evita reabrir cinquenta decisões
 * a cada importação.
 */
export function separarJaImportadas(
	db: Db,
	tarefas: TarefaNuvem[]
): { novas: TarefaNuvem[]; jaImportadas: number } {
	const existentes = idsJaImportados(
		db,
		tarefas.map((t) => t.taskId)
	);
	const novas = tarefas.filter((t) => !existentes.has(t.taskId));
	return { novas, jaImportadas: tarefas.length - novas.length };
}

/**
 * Nota de rateio da peça multimaterial.
 *
 * O schema amarra UMA impressão a UM rolo, então uma peça com dois filamentos
 * tem o peso todo debitado do rolo escolhido. A divisão real não pode
 * simplesmente sumir: fica escrita nas observações, visível na tela de
 * detalhe. (Resolver isso direito pede tabela de ligação impressão⇄rolo, que
 * é mudança de schema e está fora desta rodada — ver relatório.)
 */
export function observacoesDaTarefa(tarefa: TarefaNuvem): string | null {
	if (!tarefa.multifilamento) return null;
	const lista = tarefa.filamentos
		.map((f) => `${f.material ?? f.filamentId ?? 'filamento'} ${f.corHex ?? ''} ${f.gramas} g`)
		.map((s) => s.replace(/\s+/g, ' ').trim())
		.join(', ');
	return `Importada da nuvem com mais de um filamento (${lista}). O peso total foi debitado do rolo escolhido.`;
}

/**
 * O que o banco já sabe sobre a finalidade de cada peça.
 *
 * É a fonte da primeira camada de sugestão. O MagicTray foi impresso quatro
 * vezes e o Gridfinity outras quatro: a quinta não deveria ter que ser
 * classificada do zero, e é isso que separa "a tela oferece finalidade por
 * linha" de "a tela cobra finalidade por linha".
 */
export function finalidadesConhecidas(db: Db): Map<string, Finalidade> {
	const linhas = db
		.select({
			nome: schema.impressao.nomeLivre,
			finalidade: schema.impressao.finalidade,
			inicioEm: schema.impressao.inicioEm
		})
		.from(schema.impressao)
		.all();

	return resumirFinalidades(
		linhas.map((l) => ({
			nome: l.nome,
			finalidade: l.finalidade ?? '',
			inicioEm: l.inicioEm instanceof Date ? l.inicioEm.getTime() : Number(l.inicioEm)
		}))
	);
}

/** `"12"` → 12; ausente, vazio, `"abc"`, `"0"`, `"1.5"` e negativo → `null` (= pular). */
function idDoFormulario(bruto: FormDataEntryValue | null): number | null {
	const n = Number(String(bruto ?? '').trim());
	if (!Number.isInteger(n) || n <= 0) return null;
	return n;
}

/**
 * Lê a tela de importação: para cada tarefa, qual rolo e qual impressora o
 * usuário escolheu.
 *
 * Só entram tarefas que o formulário menciona — a tela manda `rolo:<taskId>`
 * para cada linha listada. Campo vazio (a opção "não importar") vira `roloId:
 * null`, que `importarTarefas` transforma em linha pulada com motivo, em vez de
 * gravar uma impressão sem custo.
 *
 * Tudo aqui é entrada de usuário e nada dela pode virar 500: id malformado é
 * tratado como "não atribuído", e finalidade fora da lista cai no padrão.
 *
 * **A finalidade vem por LINHA, com o lote atrás.** Era um campo só para o
 * histórico inteiro, e o resultado foi as 11 impressões reais no mesmo balde,
 * com o card "Por finalidade" desenhando uma barra de 100%. O campo do lote
 * continua existindo — ele é o que evita 50 escolhas — mas agora ele é o piso,
 * não o teto: `finalidade:<taskId>` vazio herda dele, e preenchido ganha dele.
 * É exatamente a relação que o rolo já tinha entre o select do grupo e o da
 * linha.
 */
export function lerEntradasDoFormulario(
	form: FormData,
	tarefas: TarefaNuvem[]
): EntradaImportacao[] {
	const doLote = normalizarFinalidade(form.get('finalidade')) ?? 'outro';

	return tarefas
		.filter((t) => form.has(`rolo:${t.taskId}`))
		.map((tarefa) => ({
			tarefa,
			roloId: idDoFormulario(form.get(`rolo:${tarefa.taskId}`)),
			impressoraId: idDoFormulario(form.get(`impressora:${tarefa.taskId}`)),
			// Checkbox por linha. Ausente = não confirmado, que é o padrão seguro.
			confirmado: form.get(`confirmar:${tarefa.taskId}`) === 'on',
			gramasInformadas: pesoDoFormulario(form.get(`gramas:${tarefa.taskId}`)),
			// `crit-fluxo`: a finalidade da LINHA vence a do lote. O `?? doLote` é
			// o que faz a linha em branco herdar o padrão sem JavaScript.
			finalidade: normalizarFinalidade(form.get(`finalidade:${tarefa.taskId}`)) ?? doLote
		}));
}

/**
 * O peso digitado na linha da tarefa abortada.
 *
 * Campo ausente devolve `undefined` ("a tela nem perguntou"), e campo presente
 * mas imprestável devolve `null` ("perguntou e não deu para usar"). A distinção
 * importa porque só o segundo é erro do usuário — e nenhum dos dois pode virar
 * zero, que gravaria uma impressão que não custa nada e não debita nada.
 */
function pesoDoFormulario(bruto: FormDataEntryValue | null): number | null | undefined {
	if (bruto === null) return undefined;
	const texto = String(bruto).trim();
	if (!texto) return null;
	const campo = campoNumericoObrigatorio(bruto, 'peso');
	return campo.ok ? campo.valor : null;
}

export function importarTarefas(db: Db, entradas: EntradaImportacao[]): ResultadoImportacao {
	const resultado: ResultadoImportacao = {
		gravadas: 0,
		duplicadas: 0,
		puladas: [],
		gramas: 0,
		duracaoS: 0,
		recalculadasPorDensidade: 0,
		comPesoDigitado: 0
	};

	const existentes = idsJaImportados(
		db,
		entradas.map((e) => e.tarefa.taskId)
	);

	// O lote pode trazer a mesma tarefa duas vezes (formulário reenviado, dois
	// grupos apontando para a mesma linha). O índice único pegaria, mas como
	// uma exceção — e exceção no meio do lote é 500 na cara do usuário.
	const gravadosAgora = new Set<string>();

	for (const entrada of entradas) {
		const { tarefa } = entrada;
		const pular = (motivo: string) =>
			resultado.puladas.push({ taskId: tarefa.taskId, nome: tarefa.nome, motivo });

		if (existentes.has(tarefa.taskId) || gravadosAgora.has(tarefa.taskId)) {
			resultado.duplicadas++;
			continue;
		}

		if (!tarefa.importavel || tarefa.duracaoS === null || tarefa.inicioEm === null) {
			pular(tarefa.problema ?? 'tarefa incompleta na nuvem');
			continue;
		}

		// O aceite vem ANTES da checagem de rolo de propósito: a tarefa
		// multimaterial não deve nem parecer "quase pronta" por ter rolo escolhido.
		if (tarefa.exigeConfirmacao && !entrada.confirmado) {
			pular(tarefa.avisoConfirmacao ?? 'precisa de confirmação linha a linha');
			continue;
		}

		// Peça abortada não entra com o peso da nuvem. `weight` é escrito no
		// fatiamento — uma tarefa rodando havia 17 s já reportava 202,67 g —, e
		// numa peça que caiu aos 3 minutos de 5 horas ele debita do rolo
		// material que continua no rolo. O peso vem digitado, ou a tarefa fica
		// visível na tela esperando o número em vez de entrar torta.
		if (tarefa.exigePesoReal && (entrada.gramasInformadas ?? null) === null) {
			pular(
				`${tarefa.avisoPeso ?? 'a peça abortou'}; digite quanto de material saiu de verdade ` +
					'(a peça na mesa, na balança) para esta entrar'
			);
			continue;
		}

		if (entrada.roloId === null) {
			pular('sem rolo atribuído; sem rolo não dá para calcular custo');
			continue;
		}
		if (entrada.impressoraId === null) {
			pular('sem impressora atribuída');
			continue;
		}

		// Id existente no formulário mas ausente no banco viraria
		// `FOREIGN KEY constraint failed` lá dentro de `registrarImpressao`, ou
		// seja, 500 por entrada de usuário. Mesmo padrão das outras rotas.
		const rolo = db.select().from(schema.rolo).where(eq(schema.rolo.id, entrada.roloId)).get();
		if (!rolo) {
			pular('rolo não encontrado');
			continue;
		}

		// `sugerirRolo` nunca oferece rolo vazio ou descartado, mas o `<select>`
		// lista todos e o formulário aceita qualquer id — então quem escolhesse à
		// mão gravava a impressão assim mesmo, e a tela dizia "gravada".
		//
		// O furo já existia e era teórico: ninguém tinha rolo vazio. A fusão o
		// tornou real, porque é ela que FABRICA rolos vazios — um filamento que
		// não tinha rolo vira um, com o mesmo material, a mesma cor, o mesmo
		// `codigoBambu` dos rolos de verdade e um código vizinho na lista. Um
		// clique errado num decoy desses grava `custoFilamentoCents = 0`
		// (preço zero) e reporta sucesso: o pior desfecho possível aqui, que é
		// custo errado congelado sem nenhum sinal.
		//
		// Recusar é reversível e visível — o motivo aparece na tela, e mudar o
		// status do rolo e reimportar é um caminho de dois cliques. Gravar zero
		// não é.
		if (rolo.status === 'vazio' || rolo.status === 'descartado') {
			pular(
				`o filamento ${rolo.codigo} está marcado como "${rolo.status}"; troque o status ` +
					`dele, ou escolha outro, e importe de novo`
			);
			continue;
		}
		const impressora = db
			.select()
			.from(schema.impressora)
			.where(eq(schema.impressora.id, entrada.impressoraId))
			.get();
		if (!impressora) {
			pular('impressora não encontrada');
			continue;
		}

		// ── de onde saem as gramas desta linha ────────────────────────────────
		//
		// Três origens, em ordem de confiança: o que o usuário mediu, o que a
		// geometria do filamento reconstrói com a densidade DESTE rolo, e, em
		// último caso, o número que a nuvem mandou.
		let gramas = tarefa.gramas;
		let notaDoPeso: string | null = null;

		if (tarefa.exigePesoReal) {
			gramas = entrada.gramasInformadas as number;
			resultado.comPesoDigitado++;
			notaDoPeso =
				`A peça abortou. A nuvem estimava ${tarefa.gramas} g para o trabalho inteiro; ` +
				`o peso gravado (${gramas} g) foi informado à mão.`;
		} else {
			const corrigida = massaPelaDensidade({
				gramasNuvem: tarefa.gramas,
				comprimentoCm: tarefa.comprimentoCm,
				densidadeRolo: rolo.densidade
			});
			gramas = corrigida.gramas;
			notaDoPeso = notaDeMassa(corrigida, tarefa.gramas);
			if (corrigida.aplicado) resultado.recalculadasPorDensidade++;
		}

		const observacoes =
			[observacoesDaTarefa(tarefa), notaDoPeso].filter((s) => s !== null).join(' ') || null;

		try {
			registrarImpressao(db, {
				nomeLivre: tarefa.nome,
				impressoraId: entrada.impressoraId,
				roloId: entrada.roloId,
				inicioEm: tarefa.inicioEm,
				fimEm: tarefa.fimEm,
				// Sempre a subtração. `costTime` nem chega aqui — ver parse.ts.
				duracaoS: tarefa.duracaoS,
				gramas,
				status: tarefa.status === 'falha' ? 'falha' : 'sucesso',
				camadaMm: tarefa.perfil.camadaMm,
				paredes: tarefa.perfil.paredes,
				infillPct: tarefa.perfil.infillPct,
				placaBuild: tarefa.placaBuild,
				finalidade: entrada.finalidade,
				imagemPath: entrada.imagemPath ?? null,
				origem: 'nuvem',
				taskIdNuvem: tarefa.taskId,
				// Qual plate rodou e de qual projeto ela veio. São os dois campos
				// que permitem, depois, separar "a mesma plate de novo" de "outra
				// plate do mesmo arquivo" — ver `$lib/projeto`. Nenhum dos dois
				// entra em conta nenhuma de custo ou de estoque.
				indicePlate: tarefa.indicePlate,
				projetoIdNuvem: tarefa.projetoId,
				observacoes
			});
			gravadosAgora.add(tarefa.taskId);
			resultado.gravadas++;
			resultado.gramas += gramas;
			resultado.duracaoS += tarefa.duracaoS;
		} catch (e) {
			// Rede de segurança final: qualquer surpresa do banco vira uma linha
			// pulada com motivo, nunca uma action respondendo 500.
			const detalhe = e instanceof Error ? e.message : String(e);
			pular(`não deu para gravar (${detalhe})`);
		}
	}

	return resultado;
}

/**
 * Marca a data da última importação — **só quando algo entrou**.
 *
 * Uma rodada que não gravou nada (tudo duplicado, tudo pulado, rolo nenhum
 * atribuído) não é uma importação: carimbar a data nesse caso faz a tela de
 * Config afirmar que o histórico está em dia quando ele não está.
 */
export function marcarImportacao(db: Db, resultado: ResultadoImportacao, agora = new Date()): boolean {
	if (resultado.gravadas === 0) return false;
	db.update(schema.config).set({ ultimaImportacaoEm: agora }).where(eq(schema.config.id, 1)).run();
	return true;
}

export type ResultadoExclusao =
	| { ok: true; taskId: string | null; nome: string }
	| { ok: false; erro: string };

/**
 * Apaga uma impressão importada da nuvem, liberando o `taskIdNuvem` para ser
 * reimportada.
 *
 * **Por que excluir e não editar.** O custo é congelado no momento do registro,
 * e quem congela é `registrarImpressao`. Uma tela de edição de rolo teria que
 * recalcular e recongelar por fora, criando um segundo lugar onde o custo é
 * escrito — exatamente o que o projeto evita. Excluir e reimportar reaproveita
 * o caminho único: a nuvem ainda tem a tarefa, então nada se perde.
 *
 * **Por que só `origem = 'nuvem'`.** Uma impressão manual não tem de onde
 * voltar: apagá-la é perda definitiva de dado digitado à mão. A da nuvem é
 * recuperável a uma importação de distância, e é justamente ela que a
 * atribuição em lote pode ter errado em massa.
 */
export function excluirImpressaoDaNuvem(db: Db, id: number): ResultadoExclusao {
	if (!Number.isInteger(id) || id <= 0) return { ok: false, erro: 'impressão inválida' };

	const linha = db.select().from(schema.impressao).where(eq(schema.impressao.id, id)).get();
	if (!linha) return { ok: false, erro: 'impressão não encontrada' };
	if (linha.origem !== 'nuvem') {
		return {
			ok: false,
			erro: 'só dá para excluir impressão vinda da nuvem; a manual não tem de onde ser recuperada'
		};
	}

	db.delete(schema.impressao).where(eq(schema.impressao.id, id)).run();
	return { ok: true, taskId: linha.taskIdNuvem, nome: linha.nomeLivre };
}

/**
 * Quantas impressões vindas da nuvem estão sem capa guardada.
 *
 * É o número que a tela de importação mostra para justificar o botão de
 * recuperação — sem ele, "recuperar capas que faltam" seria um botão sem
 * pergunta.
 */
export function contarSemCapa(db: Db): number {
	return db
		.select({ id: schema.impressao.id })
		.from(schema.impressao)
		.where(and(isNotNull(schema.impressao.taskIdNuvem), isNull(schema.impressao.imagemPath)))
		.all().length;
}

/**
 * Quantas impressões vindas da nuvem ainda não têm plate ou projeto.
 *
 * É o número que dá pergunta ao botão de completar — sem ele, "completar o que
 * falta" seria um botão sem passivo. Uma linha conta como pendente quando falta
 * QUALQUER um dos dois: o arquivo do próprio dono nunca vai ganhar projeto, mas
 * ainda pode ganhar o índice da plate, e é o índice que faz a leitura.
 */
export function contarSemPlate(db: Db): number {
	return db
		.select({ id: schema.impressao.id })
		.from(schema.impressao)
		.where(
			and(
				isNotNull(schema.impressao.taskIdNuvem),
				or(isNull(schema.impressao.indicePlate), isNull(schema.impressao.projetoIdNuvem))
			)
		)
		.all().length;
}

export interface ResultadoCompletar {
	/** Impressões da nuvem a que faltava pelo menos um dos dois, antes da rodada. */
	pendentes: number;
	/** Quantas linhas ganharam pelo menos um campo. */
	completadas: number;
	/** Quantos índices de plate foram escritos. */
	indices: number;
	/** Quantos identificadores de projeto foram escritos. */
	projetos: number;
	/** A tarefa não veio na busca — o histórico da nuvem tem teto de leitura. */
	semTarefaNaNuvem: number;
	/** A tarefa veio e a nuvem também não sabe: arquivo próprio, campo ausente. */
	semDadoNaNuvem: number;
}

/**
 * Completa a plate e o projeto das impressões que já estão no banco.
 *
 * **Por que reimportar não resolve.** A deduplicação por `taskIdNuvem` é o que
 * torna a importação idempotente, e é ela que faz uma segunda rodada devolver
 * `duplicadas: 11, gravadas: 0` — as linhas antigas nunca são reescritas.
 * Excluir e reimportar traria os campos e levaria junto a atribuição de rolo
 * que o dono fez uma a uma, mais a finalidade, mais o peso corrigido na
 * balança, mais o custo congelado no dia certo.
 *
 * **O que esta função escreve: duas colunas, e só onde estão vazias.** O `set`
 * nunca tem outra chave, e um campo já preenchido nunca é sobrescrito — nem
 * quando a nuvem passa a dizer outra coisa, porque entre o que está gravado e
 * o que a API devolve hoje, o gravado é o que o dono viu. Custo congelado,
 * rolo, finalidade, gramas, duração e observações não são lidos aqui.
 *
 * É o mesmo desenho de `recuperarCapas`, pela mesma razão: o passivo de uma
 * importação antiga se resolve no lugar, sem reabrir decisão nenhuma.
 */
export function completarPlates(db: Db, tarefas: TarefaNuvem[]): ResultadoCompletar {
	const pendentes = db
		.select({
			id: schema.impressao.id,
			taskId: schema.impressao.taskIdNuvem,
			indicePlate: schema.impressao.indicePlate,
			projetoIdNuvem: schema.impressao.projetoIdNuvem
		})
		.from(schema.impressao)
		.where(
			and(
				isNotNull(schema.impressao.taskIdNuvem),
				or(isNull(schema.impressao.indicePlate), isNull(schema.impressao.projetoIdNuvem))
			)
		)
		.all();

	const resultado: ResultadoCompletar = {
		pendentes: pendentes.length,
		completadas: 0,
		indices: 0,
		projetos: 0,
		semTarefaNaNuvem: 0,
		semDadoNaNuvem: 0
	};

	// Casamento por `taskIdNuvem`, que é único no schema — nenhum índice pode
	// cair na impressão errada, e a ordem em que a nuvem devolveu não importa.
	const porTask = new Map(tarefas.map((t) => [t.taskId, t]));

	for (const p of pendentes) {
		const tarefa = porTask.get(p.taskId!);
		if (!tarefa) {
			resultado.semTarefaNaNuvem++;
			continue;
		}

		const remendo: { indicePlate?: number; projetoIdNuvem?: string } = {};
		if (p.indicePlate === null && tarefa.indicePlate !== null) {
			remendo.indicePlate = tarefa.indicePlate;
		}
		if (p.projetoIdNuvem === null && tarefa.projetoId !== null) {
			remendo.projetoIdNuvem = tarefa.projetoId;
		}

		if (Object.keys(remendo).length === 0) {
			resultado.semDadoNaNuvem++;
			continue;
		}

		db.update(schema.impressao).set(remendo).where(eq(schema.impressao.id, p.id)).run();
		resultado.completadas++;
		if (remendo.indicePlate !== undefined) resultado.indices++;
		if (remendo.projetoIdNuvem !== undefined) resultado.projetos++;
	}

	return resultado;
}

export interface ResultadoRecuperacao {
	/** Impressões da nuvem sem capa no banco, antes desta rodada. */
	pendentes: number;
	recuperadas: number;
	/** A tarefa não veio na busca, ou veio sem `cover`: não há o que baixar. */
	semCapaNaNuvem: number;
	falharam: number;
}

/**
 * Baixa depois a capa de quem foi importado sem ela.
 *
 * A `cover` é URL pré-assinada de 1 h, então a URL guardada no dia da
 * importação não serve mais — mas a **tarefa** continua na nuvem, e cada busca
 * devolve uma URL nova. É por isso que "baixar depois" é possível sem
 * reimportar nada: casa-se `taskIdNuvem` com a tarefa recém-lida e usa-se a
 * URL fresca dela.
 *
 * O casamento é pelo `taskIdNuvem`, que é único no schema — nenhuma capa pode
 * cair na impressão errada. E, como na importação, imagem é anexo: qualquer
 * falha vira contagem na tela, nunca exceção.
 */
export async function recuperarCapas(
	db: Db,
	tarefas: TarefaNuvem[],
	baixar: (itens: { taskId: string; url: string | null }[]) => Promise<Map<string, string>> = (
		itens
	) => baixarCapas(itens)
): Promise<ResultadoRecuperacao> {
	const pendentes = db
		.select({ id: schema.impressao.id, taskId: schema.impressao.taskIdNuvem })
		.from(schema.impressao)
		.where(and(isNotNull(schema.impressao.taskIdNuvem), isNull(schema.impressao.imagemPath)))
		.all();

	const comCapa = new Map(tarefas.filter((t) => t.capaUrl).map((t) => [t.taskId, t.capaUrl!]));
	const alvo = pendentes.filter((p) => p.taskId && comCapa.has(p.taskId));

	const resultado: ResultadoRecuperacao = {
		pendentes: pendentes.length,
		recuperadas: 0,
		semCapaNaNuvem: pendentes.length - alvo.length,
		falharam: 0
	};
	if (alvo.length === 0) return resultado;

	let capas: Map<string, string>;
	try {
		capas = await baixar(alvo.map((p) => ({ taskId: p.taskId!, url: comCapa.get(p.taskId!)! })));
	} catch {
		// `baixarCapas` já engole tudo, mas um baixador injetado (ou uma versão
		// futura) não é obrigado a isso. Recuperar capa nunca derruba a tela.
		resultado.falharam = alvo.length;
		return resultado;
	}

	for (const p of alvo) {
		const caminho = capas.get(p.taskId!);
		if (!caminho) {
			resultado.falharam++;
			continue;
		}
		db.update(schema.impressao)
			.set({ imagemPath: caminho })
			.where(eq(schema.impressao.id, p.id))
			.run();
		resultado.recuperadas++;
	}

	return resultado;
}
