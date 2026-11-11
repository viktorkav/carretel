/**
 * Fixtures do histórico da nuvem da Bambu.
 *
 * NÃO são capturas da conta real: o formato foi reconstruído a partir do
 * levantamento feito contra a API em 09/08/2026 (registrado na spec) e os
 * valores são inventados. Servem para exercitar parser, paginação e
 * importação sem nenhuma chamada autenticada — que é uma restrição dura
 * deste projeto.
 *
 * Os campos ficam propositalmente `unknown` na fronteira: a API é
 * engenharia reversa e pode devolver tipo diferente do documentado, então
 * o parser tem que aguentar o que vier.
 */

import { comprimentoParaMassaCm } from './massa';

export interface TarefaBrutaFixture {
	[chave: string]: unknown;
}

let sequencia = 900_000_000;

/** Densidade do perfil PLA Basic da Bambu — o padrão de fatiamento das fixtures. */
export const DENSIDADE_PERFIL_PADRAO = 1.24;

/**
 * Uma tarefa completa e bem-comportada, para ser modificada pelos casos.
 *
 * `length` é DERIVADO do peso quando o caso não o informa, e não um número
 * solto: os dois campos são a mesma grandeza vista de dois jeitos (ver
 * `massa.ts`), e uma fixture onde eles não fecham não é "um valor inventado",
 * é um payload que a API não produziria. Quem quiser justamente o par que não
 * fecha passa `length` à mão — é o que `TAREFA_COMPRIMENTO_INCOERENTE` faz.
 */
export function criarTarefaBruta(over: Record<string, unknown> = {}): TarefaBrutaFixture {
	const id = sequencia++;
	const peso = typeof over.weight === 'number' ? over.weight : 82.5;
	const comprimento =
		'length' in over
			? over.length
			: Math.round(comprimentoParaMassaCm(peso, DENSIDADE_PERFIL_PADRAO) * 10) / 10;
	return {
		id,
		designId: 0,
		designTitle: 'Suporte de microfone',
		instanceId: 0,
		title: '0.2mm layer, 2 walls, 15% infill',
		cover: `https://bambu-tasks.s3.amazonaws.com/${id}.png?X-Amz-Expires=3600&X-Amz-Signature=abc`,
		status: 2,
		feedbackStatus: 0,
		startTime: '2026-08-07T18:12:03Z',
		endTime: '2026-08-07T21:44:31Z',
		weight: peso,
		// Comprimento de filamento em CENTÍMETROS. Coerente com `weight` pela
		// geometria do 1,75 mm — ver `criarTarefaBruta`.
		length: comprimento,
		// Estimativa do fatiamento, em segundos. NÃO é o tempo real: nenhum
		// cálculo de duração, energia, depreciação ou horímetro pode encostar
		// nele. Só a fração de tempo decorrido de uma peça abortada o usa, como
		// denominador de uma sugestão declarada.
		costTime: 12_900,
		// ⚠️ PROCEDÊNCIA MAIS FRACA QUE A DOS OUTROS CAMPOS.
		//
		// `designId` (acima) e `plateIndex` estão nesta fixture desde a rodada da
		// nuvem, e o parser passou a lê-los — mas a tabela de mapeamento da spec
		// (`docs/superpowers/specs/2026-08-09-carretel-design.md`, "Importação da
		// nuvem") NÃO os lista: ela documenta `id`, `designTitle`, `title`,
		// `startTime`/`endTime`, `weight`, `status`, `deviceName`/`deviceModel`,
		// `bedType`, `amsDetailMapping[]` e `cover`, e para aí.
		//
		// Foi exatamente esse tipo de vão que escondeu o bug de `taskWeightSum`:
		// a fixture punha o total na raiz, `api.ts` o lia na raiz, os dois erros
		// se cancelavam e a conferência de importação nunca funcionou em produção.
		// Por isso o código tratou os dois campos como HIPÓTESE, não como fato:
		// nenhum deles entra em `importavel`, ausência é caso normal, e valor
		// impossível vira "não identificada" em vez de virar chave de agrupamento
		// (ver `lerIndicePlate` e `lerProjetoId` em `parse.ts`).
		//
		// A confirmação é a primeira importação real: a ação "completar" reporta
		// na tela quantas linhas a nuvem não soube preencher. Um número alto ali
		// significa nome, base de numeração ou aninhamento diferentes do suposto.
		plateIndex: 1,
		deviceId: '01P00A123456789',
		deviceModel: 'N1',
		deviceName: 'Unit-01(A1)',
		bedType: 'textured_plate',
		mode: 'cloud_file',
		amsDetailMapping: [
			{
				ams: 0,
				sourceColor: '000000FF',
				targetColor: '000000FF',
				filamentId: 'GFA18',
				filamentType: 'PLA',
				targetFilamentType: 'PLA',
				weight: 82.5
			}
		],
		...over
	};
}

/** Concluída, um filamento só. O caso comum. */
export const TAREFA_CONCLUIDA = criarTarefaBruta({
	id: 912_345_678,
	designTitle: 'Suporte de microfone',
	startTime: '2026-08-07T18:00:00Z',
	endTime: '2026-08-07T20:00:00Z',
	weight: 82.5
});

/**
 * Abortada. O `costTime` carrega a estimativa cheia do fatiamento (3h35),
 * enquanto o intervalo real entre início e fim é de 12 minutos. É o caso que
 * torna `endTime - startTime` obrigatório.
 */
export const TAREFA_ABORTADA = criarTarefaBruta({
	id: 912_345_679,
	designTitle: 'Base do ventilador',
	status: 3,
	startTime: '2026-08-08T09:00:00Z',
	endTime: '2026-08-08T09:12:00Z',
	costTime: 12_900,
	weight: 4.2
});

/** Ainda rodando (ou registro truncado): sem `endTime`, não dá duração. */
export const TAREFA_SEM_FIM = criarTarefaBruta({
	id: 912_345_680,
	designTitle: 'Caixa do Rode',
	status: 2,
	startTime: '2026-08-09T22:30:00Z',
	endTime: null
});

/** Multimaterial: dois filamentos na mesma peça. */
export const TAREFA_MULTIFILAMENTO = criarTarefaBruta({
	id: 912_345_681,
	designTitle: 'Placa com relevo',
	weight: 120,
	amsDetailMapping: [
		{
			ams: 0,
			sourceColor: '000000FF',
			targetColor: '000000FF',
			filamentId: 'GFA18',
			filamentType: 'PLA',
			weight: 90
		},
		{
			ams: 1,
			sourceColor: 'FFFFFFFF',
			targetColor: 'FFFFFFFF',
			filamentId: 'GFG99',
			filamentType: 'PETG',
			weight: 30
		}
	]
});

/** Sem detalhamento de filamento: só o peso total. */
export const TAREFA_SEM_AMS = criarTarefaBruta({
	id: 912_345_682,
	designTitle: 'Gabarito de furação',
	weight: 15.75,
	amsDetailMapping: []
});

/**
 * `length` que não fecha com `weight`: o mesmo número da fixture antiga
 * (27600), que só faz sentido se o campo estivesse em MILÍMETROS. Existe para
 * provar que o recálculo por densidade se recusa a rodar quando o par não
 * fecha, em vez de multiplicar o estoque por dez.
 */
export const TAREFA_COMPRIMENTO_INCOERENTE = criarTarefaBruta({
	id: 912_345_684,
	designTitle: 'Peça com comprimento estranho',
	weight: 82.5,
	length: 27_600
});

/** `title` fora do formato conhecido — não pode derrubar a importação. */
export const TAREFA_TITULO_ESTRANHO = criarTarefaBruta({
	id: 912_345_683,
	designTitle: 'Peça sem perfil',
	title: 'Perfil personalizado do Victor'
});

/**
 * Envelope do `/my/profile` **como a API devolve de verdade**.
 *
 * Os totais vitalícios moram DENTRO de `personal`, e não na raiz. A fixture
 * antiga os punha na raiz, que é o mesmo lugar onde `api.ts` os lia — os dois
 * erros se cancelavam, a suíte passava verde e a conferência de importação
 * nunca funcionou em produção (levantamento de 09/08/2026 e crítica de
 * 10/08/2026). É por isso que este formato existe como função: para nenhum
 * teste novo voltar a escrever o envelope à mão do jeito errado.
 */
export function criarPerfilBruto(
	over: { taskWeightSum?: number; taskTimeSum?: number; [chave: string]: unknown } = {}
): Record<string, unknown> {
	const { taskWeightSum, taskTimeSum, ...resto } = over;
	return {
		uid: 1,
		name: 'viktor',
		personal: {
			taskWeightSum: taskWeightSum ?? 0,
			taskTimeSum: taskTimeSum ?? 0,
			bio: '',
			...(resto.personal as Record<string, unknown> | undefined)
		},
		...resto
	};
}

/**
 * Fabrica uma conta inteira e a devolve como um `fetch` falso.
 *
 * O comportamento imita o que foi observado na API real: `offset` + `limit`
 * paginam de verdade, e `after` é aceito e **ignorado** — quem pagina por
 * `after` recebe a primeira página para sempre.
 */
export function criarNuvemFalsa(opcoes: {
	tarefas: TarefaBrutaFixture[];
	tamanhoPagina?: number;
	/** Envelope do `/my/profile` já no formato da API — ver `criarPerfilBruto`. */
	perfil?: Record<string, unknown>;
	tokenValido?: string;
	/** `total` declarado, quando ele diverge da quantidade real de tarefas. */
	total?: number;
	/** Omite `total` do envelope, como uma API que simplesmente não manda. */
	semTotal?: boolean;
}) {
	const tamanhoPagina = opcoes.tamanhoPagina ?? 20;
	const urls: string[] = [];

	const fetchFalso = async (entrada: string | URL | Request, init?: RequestInit) => {
		const url = String(entrada);
		urls.push(url);

		const autorizacao = new Headers(init?.headers).get('Authorization');
		const token = autorizacao?.replace(/^Bearer\s+/i, '') ?? '';
		if (opcoes.tokenValido !== undefined && token !== opcoes.tokenValido) {
			return new Response(JSON.stringify({ code: 401, message: 'invalid token' }), {
				status: 401,
				headers: { 'content-type': 'application/json' }
			});
		}

		if (url.includes('/my/profile')) {
			const perfil =
				opcoes.perfil ??
				criarPerfilBruto({
					taskWeightSum: opcoes.tarefas.length * 50,
					taskTimeSum: opcoes.tarefas.length * 3600
				});
			return new Response(JSON.stringify(perfil), {
				status: 200,
				headers: { 'content-type': 'application/json' }
			});
		}

		const query = new URL(url).searchParams;
		// `after` existe, é aceito e não faz nada — exatamente como na API real.
		const offset = Number(query.get('offset') ?? 0);
		const limite = Number(query.get('limit') ?? tamanhoPagina);
		const inicio = Number.isFinite(offset) && offset > 0 ? offset : 0;
		const fim = inicio + Math.min(limite || tamanhoPagina, tamanhoPagina);

		const envelope: Record<string, unknown> = { hits: opcoes.tarefas.slice(inicio, fim) };
		if (!opcoes.semTotal) envelope.total = opcoes.total ?? opcoes.tarefas.length;

		return new Response(JSON.stringify(envelope), {
			status: 200,
			headers: { 'content-type': 'application/json' }
		});
	};

	return { fetchFalso: fetchFalso as unknown as typeof fetch, urls };
}
