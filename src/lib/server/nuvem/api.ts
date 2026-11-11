/**
 * Cliente da Cloud API da Bambu.
 *
 * A API é não-oficial e o levantamento feito contra ela em 09/08/2026 (spec,
 * seção "Importação da nuvem") diverge da documentação pública em pontos que
 * produzem bug silencioso. Os dois que moram aqui:
 *
 * 1. **A paginação é `offset` + `limit`.** Toda fonte pública fala em `after`.
 *    `after` é aceito e ignorado: devolve sempre a primeira página. Quem
 *    pagina por ele importa 20 registros e acha que acabou.
 * 2. **O token é opaco**, não é JWT. Qualquer tentativa de decodificar quebra.
 *    Vale ~1 ano e não tem renovação programática (o endpoint de refresh
 *    responde 401 sempre), então a única resposta possível a um 401 é pedir
 *    um token novo ao usuário.
 *
 * E uma regra de endereço: nunca chamar `bambulab.com` puro, que está atrás do
 * desafio da Cloudflare e devolve HTML. `api.bambulab.com` responde a cliente
 * HTTP comum.
 */

import { normalizarTarefa, type TarefaNuvem } from './parse';

const BASE = 'https://api.bambulab.com';

/** Teto de páginas. Trava de segurança contra laço infinito, não regra de negócio. */
const MAX_PAGINAS = 200;

/**
 * Teto por requisição. O app roda num processo Node único no ZimaCube: sem
 * timeout, um endpoint lento pendura a action inteira, e `?/gravar` faz uma
 * paginação completa antes de escrever qualquer linha. O default do undici não
 * tem teto de resposta, então o teto tem que vir daqui.
 */
const TIMEOUT_MS = 20_000;

export type MotivoErro = 'token' | 'rede' | 'servidor' | 'resposta';

export interface ErroNuvem {
	motivo: MotivoErro;
	mensagem: string;
}

export type Resultado<T> = { ok: true; valor: T } | { ok: false; erro: ErroNuvem };

export interface OpcoesNuvem {
	fetch?: typeof fetch;
	limite?: number;
	/** Teto por requisição, em ms. */
	timeoutMs?: number;
}

export interface ColheitaNuvem {
	tarefas: TarefaNuvem[];
	/**
	 * `total` declarado pela API, guardado só para CONFERÊNCIA. Ele não é
	 * condição de parada: um `total` menor que a realidade truncaria a leitura
	 * em silêncio, e o levantamento nunca confirmou que ele conta o mesmo
	 * universo que `hits`.
	 */
	total: number | null;
	/**
	 * `true` **somente** quando a paginação chegou até uma página vazia — que é
	 * a única prova de que o histórico acabou.
	 *
	 * Vale reparar no que isto NÃO faz: não vira `true` por falta de `total`.
	 * Quando a janela não anda (o comportamento do `after`, que é o bug nº 1 que
	 * este módulo existe para evitar), o laço sai pela trava de repetição, e é
	 * exatamente aí que a tela precisa avisar. Um sinal de completude que
	 * mente no modo de falha que ele existe para pegar é pior que não ter sinal.
	 */
	completa: boolean;
	/** Hits que nem viraram tarefa (sem id, ou não eram objeto). */
	descartadas: number;
}

export interface PerfilNuvem {
	pesoTotalG: number | null;
	tempoTotalS: number | null;
}

function erro(motivo: MotivoErro, mensagem: string): { ok: false; erro: ErroNuvem } {
	return { ok: false, erro: { motivo, mensagem } };
}

/**
 * Uma requisição autenticada, com TODO modo de falha convertido em resultado.
 *
 * Nada aqui lança: a regra do projeto é que nenhuma action responde 500 por
 * entrada do usuário, e um token colado errado é entrada do usuário.
 */
async function pedir(
	caminho: string,
	token: string,
	fetchFn: typeof fetch,
	timeoutMs: number
): Promise<Resultado<Record<string, unknown>>> {
	let resposta: Response;
	try {
		resposta = await fetchFn(`${BASE}${caminho}`, {
			headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
			signal: AbortSignal.timeout(timeoutMs)
		});
	} catch (e) {
		if (e instanceof Error && (e.name === 'TimeoutError' || e.name === 'AbortError')) {
			return erro('rede', `a nuvem da Bambu não respondeu em ${Math.round(timeoutMs / 1000)}s`);
		}
		const detalhe = e instanceof Error ? e.message : String(e);
		return erro('rede', `não deu para falar com a nuvem da Bambu (${detalhe})`);
	}

	if (resposta.status === 401 || resposta.status === 403) {
		// Não existe renovação automática: o refresh responde 401 sempre e o
		// refreshToken é igual ao accessToken. A saída é humana.
		return erro('token', 'o token da nuvem expirou ou é inválido; cole um token novo na Config');
	}

	if (!resposta.ok) {
		return erro('servidor', `a nuvem da Bambu respondeu ${resposta.status}`);
	}

	let corpoTexto: string;
	try {
		corpoTexto = await resposta.text();
	} catch (e) {
		const detalhe = e instanceof Error ? e.message : String(e);
		return erro('rede', `a resposta da nuvem foi interrompida (${detalhe})`);
	}

	let corpo: unknown;
	try {
		corpo = JSON.parse(corpoTexto);
	} catch {
		// Caso clássico: caiu num domínio protegido pela Cloudflare e voltou HTML.
		return erro('resposta', 'a nuvem devolveu algo que não é JSON');
	}

	if (typeof corpo !== 'object' || corpo === null || Array.isArray(corpo)) {
		return erro('resposta', 'a nuvem devolveu um JSON em formato inesperado');
	}

	return { ok: true, valor: corpo as Record<string, unknown> };
}

/**
 * Busca o histórico inteiro, página por página.
 *
 * O laço avança pelo tamanho da página **recebida**, não pelo limite pedido: a
 * API tem teto próprio, e pedir 100 para receber 20 é normal — somar 100 ao
 * offset pularia 80 tarefas por página sem erro nenhum.
 *
 * **A única condição de parada normal é `hits` vir vazio.** `total` é
 * conferência, nunca parada: um `total` declarado menor que a quantidade real
 * (5 declaradas para 45 existentes) cortaria a importação na primeira página e
 * sumiria com 25 impressões sem dizer nada. Como o levantamento nunca confirmou
 * que `total` conta o mesmo universo de `hits`, ele não manda no laço.
 *
 * As duas saídas anormais — página inteira repetida (a janela não andou) e teto
 * de páginas — devolvem o que já foi juntado com `completa: false`, para a tela
 * avisar em vez de o usuário gravar metade achando que gravou tudo.
 */
export async function buscarTarefas(
	token: string,
	opcoes: OpcoesNuvem = {}
): Promise<Resultado<ColheitaNuvem>> {
	const fetchFn = opcoes.fetch ?? fetch;
	const limite = opcoes.limite ?? 50;
	const timeoutMs = opcoes.timeoutMs ?? TIMEOUT_MS;

	if (!token || !token.trim()) {
		return erro('token', 'sem token da nuvem; cole o token na tela de Config');
	}

	const tarefas: TarefaNuvem[] = [];
	const vistos = new Set<string>();
	let total: number | null = null;
	let descartadas = 0;
	let offset = 0;
	let acabou = false;

	for (let pagina = 0; pagina < MAX_PAGINAS; pagina++) {
		const r = await pedir(
			`/v1/user-service/my/tasks?offset=${offset}&limit=${limite}`,
			token.trim(),
			fetchFn,
			timeoutMs
		);
		if (!r.ok) return r;

		const corpo = r.valor;
		const declarado = typeof corpo.total === 'number' ? corpo.total : null;
		if (declarado !== null) total = declarado;

		const hits = corpo.hits;
		if (!Array.isArray(hits)) {
			return erro('resposta', 'a nuvem devolveu um JSON sem a lista `hits`');
		}
		if (hits.length === 0) {
			acabou = true;
			break;
		}

		let novos = 0;
		for (const hit of hits) {
			const tarefa = normalizarTarefa(hit);
			if (!tarefa) {
				descartadas++;
				continue;
			}
			if (vistos.has(tarefa.taskId)) continue;
			vistos.add(tarefa.taskId);
			tarefas.push(tarefa);
			novos++;
		}

		offset += hits.length;

		// Página inteira repetida = a janela não andou. Sair aqui é o que impede
		// o laço infinito quando a paginação não funciona como se espera — e
		// `acabou` fica `false` de propósito, porque a leitura veio truncada.
		if (novos === 0) break;
	}

	return { ok: true, valor: { tarefas, total, completa: acabou, descartadas } };
}

/**
 * Totais vitalícios da conta. Servem só para conferência: se o peso somado das
 * impressões importadas ficar muito longe de `taskWeightSum`, a importação veio
 * incompleta e a tela precisa dizer isso.
 *
 * **Os totais moram dentro de `personal`**, não na raiz do envelope. Ler na
 * raiz devolvia `null` sempre — a conferência existia, aparecia na tela como
 * "—" e nunca pegou uma importação truncada (crítica de 10/08/2026, item 4). A
 * suíte não pegava porque a fixture escrevia no mesmo lugar errado.
 *
 * A leitura é ESTRITA de propósito: nada de tentar a raiz como plano B. Um
 * plano B faria o próximo nível errado passar despercebido outra vez, que é
 * exatamente o defeito que este trecho existe para não repetir.
 */
export async function buscarPerfil(
	token: string,
	opcoes: OpcoesNuvem = {}
): Promise<Resultado<PerfilNuvem>> {
	const fetchFn = opcoes.fetch ?? fetch;
	if (!token || !token.trim()) {
		return erro('token', 'sem token da nuvem; cole o token na tela de Config');
	}

	const r = await pedir(
		'/v1/user-service/my/profile',
		token.trim(),
		fetchFn,
		opcoes.timeoutMs ?? TIMEOUT_MS
	);
	if (!r.ok) return r;

	const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
	const bruto = r.valor.personal;
	// `personal` ausente, nulo, string ou array: conferência sem número, e não
	// exceção. A API é engenharia reversa e pode devolver qualquer coisa.
	const pessoal =
		typeof bruto === 'object' && bruto !== null && !Array.isArray(bruto)
			? (bruto as Record<string, unknown>)
			: {};

	return {
		ok: true,
		valor: { pesoTotalG: num(pessoal.taskWeightSum), tempoTotalS: num(pessoal.taskTimeSum) }
	};
}
