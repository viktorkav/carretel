/**
 * Qual visualização a lista de impressões usa — grade de cards ou tabela.
 *
 * O sistema inteiro roda **sem JavaScript**: nenhuma tela tem handler de
 * clique que troque conteúdo, e a única linha de `onclick` do projeto é um
 * `confirm()` de exclusão que só ENDURECE um formulário que já funciona sem
 * ele. Uma escolha de visualização guardada em `localStorage` quebraria essa
 * regra — e pior, quebraria em silêncio: a primeira pintura viria com o modo
 * errado e trocaria depois que o script rodasse.
 *
 * Então a escolha é servidor puro, em duas peças:
 *
 *   1. **query string** (`?ver=grade`) — o que o clique no alternador faz. É um
 *      link, não um botão: funciona com JS desligado, é compartilhável e o
 *      "voltar" do navegador desfaz a troca.
 *   2. **cookie** — o que faz a escolha sobreviver entre visitas. O link do
 *      trilho aponta para `/impressoes` limpo, sem query; sem cookie, toda
 *      navegação pelo menu voltaria para o padrão.
 *
 * A query VENCE o cookie: um endereço com `?ver=` na mão mostra o que o
 * endereço diz, e é ele que reescreve a preferência. O cookie só responde
 * quando a query não disse nada.
 *
 * ⚠️ **Os dois lados são entrada hostil.** A query é digitável por qualquer
 * um e o cookie é editável no inspetor do navegador. Nada aqui interpreta
 * texto: os dois passam por `lerVisualizacao`, que compara o valor com uma
 * lista fechada de dois literais e devolve `null` para tudo o mais. Um valor
 * desconhecido não é erro, não é 400 e não é 500 — é ausência de escolha, e
 * cai no padrão. É por isso que o cookie **não precisa ser assinado**: o pior
 * que uma adulteração consegue é pedir uma das duas telas que já estão
 * públicas, ou ser ignorada.
 */

/** As duas visualizações, na ordem em que aparecem no alternador. */
export const VISUALIZACOES = ['grade', 'lista'] as const;

export type Visualizacao = (typeof VISUALIZACOES)[number];

/**
 * Grade é o padrão porque as impressões TÊM capa: as 11 de produção vieram da
 * nuvem com a foto da peça. Quem abre `/impressoes` quer reconhecer a peça, e
 * reconhecer é olhar. A tabela é para quem veio comparar número, que é a
 * minoria das visitas — e continua a um clique.
 */
export const VISUALIZACAO_PADRAO: Visualizacao = 'grade';

export const PARAM_VISUALIZACAO = 'ver';

export const COOKIE_VISUALIZACAO = 'carretel_ver';

/** Um ano. A preferência não expira sozinha: ela muda quando o dono muda. */
export const VALIDADE_VISUALIZACAO_S = 60 * 60 * 24 * 365;

/**
 * Texto → visualização, ou `null` quando o texto não é nenhuma das duas.
 *
 * Aceita `unknown` de propósito: o valor chega de `searchParams.get()` (que
 * devolve `string | null`) e de `cookies.get()` (idem), e um dia pode chegar de
 * outro lugar. Qualquer coisa que não seja exatamente `'grade'` ou `'lista'`
 * — vazio, `null`, número, objeto, `'GRADE'`, `' grade '`, um megabyte de
 * lixo — vira `null` sem tocar em nada.
 */
export function lerVisualizacao(bruto: unknown): Visualizacao | null {
	if (typeof bruto !== 'string') return null;
	return VISUALIZACOES.find((v) => v === bruto) ?? null;
}

export interface EscolhaVisualizacao {
	/** O que a tela vai desenhar. Sempre uma das duas, nunca nada. */
	visualizacao: Visualizacao;
	/**
	 * O que gravar no cookie, ou `null` para não mexer no que já está lá.
	 *
	 * Só a query grava. Isso importa em dois casos que pareceriam iguais se a
	 * regra fosse "grave sempre a visualização escolhida":
	 *
	 * - `?ver=lixo` com cookie `lista`: a tela mostra lista (o cookie), mas o
	 *   cookie NÃO é reescrito com lista — não houve escolha nenhuma, e uma
	 *   escrita aqui seria a aplicação confirmando uma preferência que o dono
	 *   não expressou nesta visita.
	 * - visita limpa sem cookie: mostra o padrão e não grava. O padrão é o que
	 *   sobra quando não há escolha; congelá-lo no cookie transformaria "nunca
	 *   escolhi" em "escolhi grade", e o dia que o padrão mudasse ele não
	 *   valeria para quem só olhou a tela uma vez.
	 */
	gravar: Visualizacao | null;
}

export function escolherVisualizacao(entrada: {
	query?: unknown;
	cookie?: unknown;
}): EscolhaVisualizacao {
	const daQuery = lerVisualizacao(entrada.query);
	if (daQuery) return { visualizacao: daQuery, gravar: daQuery };

	const doCookie = lerVisualizacao(entrada.cookie);
	return { visualizacao: doCookie ?? VISUALIZACAO_PADRAO, gravar: null };
}

/**
 * Parâmetros que valem uma vez e não sobrevivem a uma troca de visualização.
 *
 * `excluida` é o nome que a exclusão devolve na URL para a lista poder dizer
 * "'X' excluída". Carregá-lo para o outro modo faria o aviso de uma ação já
 * concluída reaparecer como se ela tivesse acabado de acontecer.
 */
const PARAMS_DE_UM_USO = ['excluida'];

/**
 * O `href` de cada lado do alternador.
 *
 * Preserva os outros parâmetros da URL em vez de montar `?ver=x` do zero: o dia
 * que a lista ganhar filtro ou busca, trocar de visualização não pode jogar
 * fora o que o usuário filtrou. `URLSearchParams` também é o que garante que
 * um parâmetro hostil volte **codificado** para o atributo `href`, em vez de
 * concatenado cru.
 */
export function enderecoVisualizacao(url: URL, alvo: Visualizacao): string {
	const params = new URLSearchParams(url.search);
	for (const nome of PARAMS_DE_UM_USO) params.delete(nome);
	// `set` substitui TODAS as ocorrências: `?ver=lista&ver=grade` não sai daqui
	// com dois `ver`.
	params.set(PARAM_VISUALIZACAO, alvo);
	return `?${params.toString()}`;
}
