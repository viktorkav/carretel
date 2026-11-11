/**
 * As regras da escolha de visualização, sem SvelteKit e sem banco.
 *
 * O que estes testes travam não é "grade é o padrão" — é a hierarquia inteira
 * (query > cookie > padrão), a recusa silenciosa de valor hostil dos DOIS
 * lados, e a regra de quando o cookie é reescrito. Cada uma dessas quatro
 * coisas foi quebrada de propósito e a suíte acusou (tabela em
 * `docs/relatorio-cards.md`).
 */
import { describe, expect, it } from 'vitest';
import {
	COOKIE_VISUALIZACAO,
	PARAM_VISUALIZACAO,
	VALIDADE_VISUALIZACAO_S,
	VISUALIZACAO_PADRAO,
	VISUALIZACOES,
	enderecoVisualizacao,
	escolherVisualizacao,
	lerVisualizacao
} from './visualizacao';

/**
 * Um valor de query/cookie hostil por linha, com o motivo de cada um estar
 * aqui. Nenhum pode virar exceção, `undefined` ou uma terceira visualização.
 */
const HOSTIS: Array<[string, unknown]> = [
	['ausente', null],
	['vazio', ''],
	['só espaço', '   '],
	['com espaço em volta', ' grade '],
	['caixa alta', 'GRADE'],
	['nome parecido', 'grades'],
	['prefixo', 'gra'],
	['terceira visualização inventada', 'tabela'],
	['HTML', '<script>alert(1)</script>'],
	['aspas quebrando atributo', '" onload="alert(1)'],
	['travessia de caminho', '../../etc/passwd'],
	['byte nulo', 'grade\0lista'],
	['SQL', "grade' OR '1'='1"],
	['quebra de linha (injeção de cabeçalho)', 'grade\r\nSet-Cookie: x=1'],
	['um megabyte de lixo', 'a'.repeat(1_000_000)],
	['número', 42],
	['booleano', true],
	['objeto', { toString: () => 'grade' }],
	['array com o valor certo dentro', ['grade']],
	['undefined', undefined]
];

describe('lerVisualizacao', () => {
	it('reconhece as duas visualizações que existem', () => {
		expect(lerVisualizacao('grade')).toBe('grade');
		expect(lerVisualizacao('lista')).toBe('lista');
	});

	it('reconhece toda visualização declarada em VISUALIZACOES', () => {
		for (const v of VISUALIZACOES) expect(lerVisualizacao(v)).toBe(v);
	});

	for (const [nome, valor] of HOSTIS) {
		it(`devolve null para ${nome}`, () => {
			expect(lerVisualizacao(valor)).toBe(null);
		});
	}
});

describe('escolherVisualizacao', () => {
	it('cai no padrão quando não há query nem cookie', () => {
		expect(escolherVisualizacao({})).toEqual({ visualizacao: VISUALIZACAO_PADRAO, gravar: null });
	});

	it('o padrão é a GRADE — cards, não tabela', () => {
		expect(VISUALIZACAO_PADRAO).toBe('grade');
		expect(escolherVisualizacao({}).visualizacao).toBe('grade');
	});

	it('a query manda quando ela é válida', () => {
		expect(escolherVisualizacao({ query: 'lista' }).visualizacao).toBe('lista');
		expect(escolherVisualizacao({ query: 'grade' }).visualizacao).toBe('grade');
	});

	// Sem este teste, "cookie vence query" passaria em tudo o mais: o caso em
	// que os dois discordam é o único que separa as duas ordens possíveis.
	it('a query vence o cookie quando os dois discordam', () => {
		expect(escolherVisualizacao({ query: 'grade', cookie: 'lista' }).visualizacao).toBe('grade');
		expect(escolherVisualizacao({ query: 'lista', cookie: 'grade' }).visualizacao).toBe('lista');
	});

	it('o cookie responde quando a query não diz nada — é isto que lembra a escolha', () => {
		expect(escolherVisualizacao({ cookie: 'lista' }).visualizacao).toBe('lista');
		expect(escolherVisualizacao({ query: null, cookie: 'lista' }).visualizacao).toBe('lista');
	});

	it('query hostil não derruba a preferência guardada', () => {
		for (const [, valor] of HOSTIS) {
			expect(escolherVisualizacao({ query: valor, cookie: 'lista' }).visualizacao).toBe('lista');
		}
	});

	it('cookie adulterado é ignorado e a tela cai no padrão', () => {
		for (const [, valor] of HOSTIS) {
			expect(escolherVisualizacao({ cookie: valor }).visualizacao).toBe(VISUALIZACAO_PADRAO);
		}
	});

	it('os dois lados hostis ao mesmo tempo ainda devolvem uma visualização válida', () => {
		for (const [, valor] of HOSTIS) {
			const r = escolherVisualizacao({ query: valor, cookie: valor });
			expect(VISUALIZACOES).toContain(r.visualizacao);
			expect(r.gravar).toBe(null);
		}
	});

	// ── quem grava o cookie ──────────────────────────────────────────────────

	it('grava o cookie quando a escolha veio da query', () => {
		expect(escolherVisualizacao({ query: 'lista' }).gravar).toBe('lista');
		expect(escolherVisualizacao({ query: 'grade', cookie: 'lista' }).gravar).toBe('grade');
	});

	it('NÃO grava o cookie quando a visualização veio do próprio cookie', () => {
		expect(escolherVisualizacao({ cookie: 'lista' }).gravar).toBe(null);
	});

	it('NÃO grava o cookie numa visita sem escolha nenhuma', () => {
		expect(escolherVisualizacao({}).gravar).toBe(null);
	});

	it('NÃO grava o cookie quando a query é lixo, mesmo com cookie válido atrás', () => {
		expect(escolherVisualizacao({ query: 'tabela', cookie: 'lista' }).gravar).toBe(null);
	});
});

describe('constantes do contrato', () => {
	it('o parâmetro e o cookie têm nome estável — a URL do dono não pode mudar sozinha', () => {
		expect(PARAM_VISUALIZACAO).toBe('ver');
		expect(COOKIE_VISUALIZACAO).toBe('carretel_ver');
	});

	it('a validade do cookie é de um ano — preferência não expira em uma sessão', () => {
		expect(VALIDADE_VISUALIZACAO_S).toBe(31_536_000);
	});
});

describe('enderecoVisualizacao', () => {
	const em = (busca: string) => new URL(`http://carretel.local/impressoes${busca}`);

	it('escreve o parâmetro numa URL limpa', () => {
		expect(enderecoVisualizacao(em(''), 'lista')).toBe('?ver=lista');
		expect(enderecoVisualizacao(em(''), 'grade')).toBe('?ver=grade');
	});

	it('troca o valor que já estava lá, em vez de acumular outro', () => {
		expect(enderecoVisualizacao(em('?ver=grade'), 'lista')).toBe('?ver=lista');
	});

	it('colapsa `ver` repetido em um só', () => {
		const r = enderecoVisualizacao(em('?ver=lista&ver=grade'), 'lista');
		expect(r).toBe('?ver=lista');
		expect(r.match(/ver=/g)).toHaveLength(1);
	});

	// Hoje o único outro parâmetro é `excluida`. O dia que a lista ganhar filtro
	// ou busca, trocar de visualização não pode jogar fora o que foi filtrado.
	it('preserva os outros parâmetros da URL', () => {
		const r = new URLSearchParams(enderecoVisualizacao(em('?material=PLA&q=caixa'), 'lista'));
		expect(r.get('material')).toBe('PLA');
		expect(r.get('q')).toBe('caixa');
		expect(r.get('ver')).toBe('lista');
	});

	it('deixa `excluida` para trás — aviso de uma vez não reaparece na troca de modo', () => {
		const r = enderecoVisualizacao(em('?excluida=caixa%20de%20parafuso'), 'lista');
		expect(r).toBe('?ver=lista');
		expect(r).not.toContain('excluida');
	});

	it('devolve parâmetro hostil CODIFICADO, nunca cru no href', () => {
		const r = enderecoVisualizacao(em('?q=%22%3E%3Cscript%3E'), 'grade');
		expect(r).not.toContain('<script>');
		expect(r).not.toContain('"');
		expect(new URLSearchParams(r).get('q')).toBe('"><script>');
	});

	it('sempre devolve uma das duas visualizações no parâmetro, para qualquer URL', () => {
		for (const busca of ['', '?ver=', '?ver=tabela', '?a=1&ver=lista&b=2', '?ver=%00']) {
			for (const alvo of VISUALIZACOES) {
				expect(new URLSearchParams(enderecoVisualizacao(em(busca), alvo)).get('ver')).toBe(alvo);
			}
		}
	});
});
