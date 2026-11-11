/**
 * O RECORTE da lista de impressões — período, finalidade, status, rolo e busca.
 *
 * A lista tinha teto fixo de cem registros e nenhum filtro: num sistema que se
 * propõe a durar anos, a impressão nº 101 continuava no banco e sumia da tela.
 * Este módulo é o vocabulário do recorte, e ele mora fora da rota pelo mesmo
 * motivo que `$lib/visualizacao` mora: as REGRAS são testáveis sem SvelteKit,
 * sem banco e sem navegador, e a rota fica sendo só a fiação.
 *
 * Três leis atravessam o arquivo:
 *
 * 1. **Query string, não JavaScript.** O sistema inteiro funciona com script
 *    desligado, e o alternador grade/lista já resolveu a mesma classe de
 *    problema por link. O filtro é um `<form method="GET">`: submeter é
 *    navegar, o "voltar" desfaz, e o endereço do recorte é compartilhável.
 *
 * 2. **Toda entrada é hostil.** Tudo aqui chega de `searchParams`, que é
 *    digitável por qualquer um. Nada é interpretado: cada campo é comparado
 *    com uma lista fechada e o que não estiver nela vira "não filtrei" — nunca
 *    400, nunca 500, nunca uma lista vazia por causa de um valor que ninguém
 *    escolheu. Um filtro que ESCONDE registro por lixo na URL seria pior do
 *    que o teto de cem que ele veio consertar.
 *
 * 3. **O subtotal é do recorte inteiro, não da página.** É ele que transforma
 *    a lista em instrumento: "estas 14 impressões de estúdio somam R$ 63,20"
 *    responde uma pergunta; catorze linhas na tela não respondem nenhuma.
 */
import { reais, numero } from './formato';

/** Os períodos oferecidos, na ordem em que aparecem no seletor. */
export const PERIODOS = [
	{ valor: 'tudo', nome: 'tudo', dias: null },
	{ valor: '7', nome: '7 dias', dias: 7 },
	{ valor: '30', nome: '30 dias', dias: 30 },
	{ valor: '90', nome: '90 dias', dias: 90 },
	{ valor: '365', nome: '1 ano', dias: 365 }
] as const;

export type Periodo = (typeof PERIODOS)[number]['valor'];

export const FINALIDADES = ['estudio', 'homelab', 'conteudo', 'pessoal', 'outro'] as const;
export type Finalidade = (typeof FINALIDADES)[number];

export const STATUS = ['sucesso', 'falha', 'cancelada'] as const;
export type StatusImpressao = (typeof STATUS)[number];

/** Nome de cada parâmetro na URL. Num lugar só: a tela e o `load` leem daqui. */
export const PARAM = {
	periodo: 'periodo',
	finalidade: 'finalidade',
	status: 'status',
	rolo: 'rolo',
	busca: 'q',
	pagina: 'pagina'
} as const;

/**
 * Cinquenta por página.
 *
 * O teto anterior era cem e era um TETO — não havia página dois. Cinquenta com
 * navegação alcança o histórico inteiro e ainda corta pela metade o número de
 * capas que a grade pede ao disco de uma vez (a lista faz um `stat` por linha
 * para saber se a miniatura existe).
 */
export const POR_PAGINA = 50;

/** Teto do texto de busca. Ninguém procura peça por oitenta caracteres. */
const TETO_BUSCA = 80;

export interface Recorte {
	periodo: Periodo;
	/** Dias do período, ou `null` para "tudo". */
	dias: number | null;
	finalidade: Finalidade | 'todas';
	status: StatusImpressao | 'todos';
	roloId: number | null;
	/** Texto já normalizado: sem espaço sobrando e com teto de tamanho. */
	busca: string;
	/** 1 na primeira. Ver `paginar` para o ajuste contra o total real. */
	pagina: number;
	/** `true` quando algum campo deixou de ser o padrão. Página não conta. */
	filtrando: boolean;
}

/** O recorte que não recorta nada — o padrão de `/impressoes` sem query. */
export function recorteVazio(): Recorte {
	return {
		periodo: 'tudo',
		dias: null,
		finalidade: 'todas',
		status: 'todos',
		roloId: null,
		busca: '',
		pagina: 1,
		filtrando: false
	};
}

/**
 * Texto de qualquer origem → um dos literais da lista, ou `null`.
 *
 * Mesma peça de `lerVisualizacao`, e pelo mesmo motivo: comparação com lista
 * fechada é o que garante que `'GRADE'`, `' estudio '`, um objeto ou um
 * megabyte de lixo não cheguem a lugar nenhum.
 */
function daLista<T extends string>(bruto: unknown, lista: readonly T[]): T | null {
	if (typeof bruto !== 'string') return null;
	return lista.find((v) => v === bruto) ?? null;
}

/** Inteiro positivo, ou `null`. Cobre ausente, vazio, "abc", "0", "-1", "1.5". */
function inteiroPositivo(bruto: unknown): number | null {
	if (typeof bruto !== 'string' || bruto.trim() === '') return null;
	const n = Number(bruto);
	return Number.isInteger(n) && n > 0 ? n : null;
}

/**
 * Normaliza texto de busca: tira o espaço das pontas, colapsa o do meio e
 * corta no teto.
 *
 * O colapso não é capricho: o nome que vem da nuvem já apareceu com espaço
 * sobrando, e quem digita "magic  tray" está procurando "magic tray".
 */
function normalizarBusca(bruto: unknown): string {
	if (typeof bruto !== 'string') return '';
	return bruto.trim().replace(/\s+/g, ' ').slice(0, TETO_BUSCA);
}

export interface OpcoesRecorte {
	/**
	 * Ids de rolo que a tela de fato oferece.
	 *
	 * Sem esta lista, `?rolo=99999` produziria um recorte legítimo e VAZIO — a
	 * tela diria "nenhuma impressão" sem nada de errado à vista, e o seletor
	 * não teria opção marcada. Id que a tela não oferece é ausência de filtro.
	 */
	rolos?: number[];
}

export function lerRecorte(params: URLSearchParams, opcoes: OpcoesRecorte = {}): Recorte {
	// `get` devolve a PRIMEIRA ocorrência: `?periodo=30&periodo=tudo` fica com
	// 30, que é a mesma regra que a visualização já usa para o parâmetro dela.
	const periodo = daLista(params.get(PARAM.periodo), PERIODOS.map((p) => p.valor)) ?? 'tudo';
	const finalidade = daLista(params.get(PARAM.finalidade), FINALIDADES);
	const status = daLista(params.get(PARAM.status), STATUS);

	const roloBruto = inteiroPositivo(params.get(PARAM.rolo));
	const roloId =
		roloBruto !== null && (opcoes.rolos === undefined || opcoes.rolos.includes(roloBruto))
			? roloBruto
			: null;

	const busca = normalizarBusca(params.get(PARAM.busca));

	return {
		periodo,
		dias: PERIODOS.find((p) => p.valor === periodo)?.dias ?? null,
		finalidade: finalidade ?? 'todas',
		status: status ?? 'todos',
		roloId,
		busca,
		pagina: inteiroPositivo(params.get(PARAM.pagina)) ?? 1,
		filtrando:
			periodo !== 'tudo' ||
			finalidade !== null ||
			status !== null ||
			roloId !== null ||
			busca !== ''
	};
}

/**
 * Instante a partir do qual o período vale, ou `null` quando é "tudo".
 *
 * Recebe `agora` em vez de chamar `Date.now()`: o mesmo motivo de
 * `alertasDoRolo` — uma função que lê o relógio por dentro é uma função que só
 * dá para testar com relógio falso.
 */
export function desdeEm(recorte: Recorte, agora: number): number | null {
	return recorte.dias === null ? null : agora - recorte.dias * 86_400_000;
}

/**
 * Texto sem acento e em caixa baixa, para comparar nome com busca.
 *
 * Sem a dobra de acento, procurar "peca" não acha "Peça" — e ninguém digita
 * cedilha no campo de busca de uma bancada. A dobra vale para os DOIS lados,
 * então "peça" também acha "Peca".
 */
function dobrar(texto: string): string {
	return texto
		.normalize('NFD')
		.replace(/\p{Diacritic}/gu, '')
		.toLowerCase()
		.trim();
}

/** A busca casa quando ela aparece em qualquer ponto do nome. Vazia casa com tudo. */
export function casaBusca(nome: string, busca: string): boolean {
	if (busca === '') return true;
	return dobrar(nome).includes(dobrar(busca));
}

export interface Subtotal {
	impressoes: number;
	custoTotalCents: number;
	gramas: number;
}

/**
 * O subtotal do recorte. Recebe o recorte INTEIRO, nunca a página — é a
 * diferença entre "estas 14 somam R$ 63,20" e "estas 50 primeiras somam".
 */
export function subtotal(linhas: { custoTotalCents: number; gramas: number }[]): Subtotal {
	let custoTotalCents = 0;
	let gramas = 0;
	for (const l of linhas) {
		custoTotalCents += l.custoTotalCents;
		gramas += l.gramas;
	}
	return {
		impressoes: linhas.length,
		custoTotalCents,
		// Mesma casa decimal do resumo do painel: somar float acumula lixo
		// ("47.72 + 54.29 + 59.4 + 52.15" sai com treze casas).
		gramas: Math.round(gramas * 10) / 10
	};
}

export interface Pagina {
	pagina: number;
	totalPaginas: number;
	inicio: number;
	fim: number;
}

/**
 * A fatia da página, com a página pedida ajustada ao total REAL.
 *
 * Pedir a página 99 de seis não pode devolver tela vazia: quem chegou lá
 * chegou por endereço colado ou por filtro que encolheu a lista embaixo dele,
 * e uma lista vazia é indistinguível de "não tem nada". Volta para a última.
 */
export function paginar(total: number, pagina: number, porPagina = POR_PAGINA): Pagina {
	const totalPaginas = Math.max(1, Math.ceil(total / porPagina));
	const atual = Math.min(Math.max(1, pagina), totalPaginas);
	const inicio = (atual - 1) * porPagina;
	return { pagina: atual, totalPaginas, inicio, fim: Math.min(total, inicio + porPagina) };
}

/**
 * Parâmetros que valem uma vez e não sobrevivem a uma troca de página.
 *
 * `excluida` é o nome que a exclusão devolve na URL. Levá-lo para a página
 * seguinte faria o aviso de uma ação concluída reaparecer como se tivesse
 * acabado de acontecer — a mesma razão de `PARAMS_DE_UM_USO` em
 * `$lib/visualizacao`.
 */
const PARAMS_DE_UM_USO = ['excluida'];

/**
 * O `href` de outra página do MESMO recorte.
 *
 * Parte da URL atual em vez de montar a query do zero, pelo mesmo motivo que
 * `enderecoVisualizacao`: virar a página não pode jogar fora o filtro nem a
 * visualização escolhida. `URLSearchParams` é o que garante que um valor
 * hostil volte codificado para o atributo `href`.
 */
export function enderecoDoRecorte(url: URL, alvo: { pagina: number }): string {
	const params = new URLSearchParams(url.search);
	for (const nome of PARAMS_DE_UM_USO) params.delete(nome);
	// A primeira página é o padrão: `?pagina=1` na URL é ruído que ainda
	// desalinha o endereço da página um com o da tela sem query nenhuma.
	if (alvo.pagina <= 1) params.delete(PARAM.pagina);
	else params.set(PARAM.pagina, String(alvo.pagina));
	const busca = params.toString();
	return busca === '' ? '?' : `?${busca}`;
}

/**
 * O subtotal escrito — o texto que vai no cabeçalho do card.
 *
 * Recorte vazio não escreve "0 impressões · R$ 0,00 · 0,0 g": três zeros
 * alinhados parecem um resultado, e o que houve foi ausência de resultado.
 */
export function textoDoRecorte(recorte: Recorte, total: Subtotal): string {
	if (total.impressoes === 0) {
		return recorte.filtrando ? 'nenhuma impressão neste recorte' : 'nenhuma impressão registrada';
	}
	const plural = total.impressoes === 1 ? 'impressão' : 'impressões';
	return `${total.impressoes} ${plural} · ${reais(total.custoTotalCents)} · ${numero(total.gramas)} g`;
}
