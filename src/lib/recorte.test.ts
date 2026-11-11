import { describe, expect, it } from 'vitest';
import {
	POR_PAGINA,
	casaBusca,
	desdeEm,
	enderecoDoRecorte,
	lerRecorte,
	paginar,
	recorteVazio,
	subtotal,
	textoDoRecorte
} from './recorte';

/** Atalho: query string → recorte. */
function ler(busca: string, rolos?: number[]) {
	return lerRecorte(new URL(`http://192.0.2.10:3316/impressoes${busca}`).searchParams, { rolos });
}

describe('lerRecorte — padrões', () => {
	it('sem query nenhuma, não filtra nada e abre na primeira página', () => {
		const r = ler('');
		expect(r).toEqual(recorteVazio());
		expect(r.periodo).toBe('tudo');
		expect(r.dias).toBe(null);
		expect(r.finalidade).toBe('todas');
		expect(r.status).toBe('todos');
		expect(r.roloId).toBe(null);
		expect(r.busca).toBe('');
		expect(r.pagina).toBe(1);
		expect(r.filtrando).toBe(false);
	});

	it('marca `filtrando` assim que qualquer recorte deixa de ser o padrão', () => {
		expect(ler('?periodo=30').filtrando).toBe(true);
		expect(ler('?finalidade=estudio').filtrando).toBe(true);
		expect(ler('?status=falha').filtrando).toBe(true);
		expect(ler('?rolo=4', [4]).filtrando).toBe(true);
		expect(ler('?q=tray').filtrando).toBe(true);
		// Página não é recorte: virar a página não é filtrar.
		expect(ler('?pagina=3').filtrando).toBe(false);
	});
});

describe('lerRecorte — período', () => {
	it('lê os períodos oferecidos e traduz para dias', () => {
		expect(ler('?periodo=7').dias).toBe(7);
		expect(ler('?periodo=30').dias).toBe(30);
		expect(ler('?periodo=90').dias).toBe(90);
		expect(ler('?periodo=365').dias).toBe(365);
		expect(ler('?periodo=tudo').dias).toBe(null);
	});

	it('período fora da lista fechada cai em "tudo" — nunca esconde registro', () => {
		for (const q of ['?periodo=', '?periodo=1', '?periodo=-30', '?periodo=abc', '?periodo=1e9']) {
			expect(ler(q).periodo).toBe('tudo');
			expect(ler(q).dias).toBe(null);
		}
	});

	it('recorta a partir de agora, para trás', () => {
		const agora = 1_786_400_000_000;
		expect(desdeEm(ler('?periodo=30'), agora)).toBe(agora - 30 * 86_400_000);
		expect(desdeEm(ler('?periodo=tudo'), agora)).toBe(null);
	});
});

describe('lerRecorte — finalidade e status', () => {
	it('aceita só as finalidades do domínio', () => {
		expect(ler('?finalidade=estudio').finalidade).toBe('estudio');
		expect(ler('?finalidade=homelab').finalidade).toBe('homelab');
		expect(ler('?finalidade=conteudo').finalidade).toBe('conteudo');
		expect(ler('?finalidade=pessoal').finalidade).toBe('pessoal');
		expect(ler('?finalidade=outro').finalidade).toBe('outro');
	});

	it('finalidade desconhecida não filtra nada', () => {
		for (const q of ['?finalidade=estúdio', '?finalidade=ESTUDIO', '?finalidade=lixo', '?finalidade=']) {
			expect(ler(q).finalidade).toBe('todas');
		}
	});

	it('aceita só os três status do domínio', () => {
		expect(ler('?status=sucesso').status).toBe('sucesso');
		expect(ler('?status=falha').status).toBe('falha');
		expect(ler('?status=cancelada').status).toBe('cancelada');
		expect(ler('?status=abortada').status).toBe('todos');
	});
});

describe('lerRecorte — rolo', () => {
	it('aceita id inteiro positivo que exista na lista oferecida', () => {
		expect(ler('?rolo=4', [4, 5]).roloId).toBe(4);
	});

	it('ignora id que não está na lista — filtro por rolo fantasma esconderia tudo', () => {
		expect(ler('?rolo=99', [4, 5]).roloId).toBe(null);
	});

	it('ignora id malformado', () => {
		for (const q of ['?rolo=0', '?rolo=-1', '?rolo=abc', '?rolo=1.5', '?rolo=']) {
			expect(ler(q, [1, 4, 5]).roloId).toBe(null);
		}
	});
});

describe('lerRecorte — busca', () => {
	it('normaliza espaço em volta e no meio', () => {
		expect(ler('?q=%20%20magic%20%20%20tray%20%20').busca).toBe('magic tray');
	});

	it('corta busca absurdamente longa em vez de carregá-la inteira', () => {
		const r = ler('?q=' + 'a'.repeat(4000));
		expect(r.busca).toHaveLength(80);
	});

	it('busca só de espaço é busca nenhuma', () => {
		expect(ler('?q=%20%20%20').busca).toBe('');
		expect(ler('?q=%20%20%20').filtrando).toBe(false);
	});
});

describe('lerRecorte — página', () => {
	it('lê inteiro positivo', () => {
		expect(ler('?pagina=3').pagina).toBe(3);
	});

	it('página malformada volta para a primeira', () => {
		for (const q of ['?pagina=0', '?pagina=-2', '?pagina=abc', '?pagina=1.5', '?pagina=']) {
			expect(ler(q).pagina).toBe(1);
		}
	});
});

describe('lerRecorte — entrada hostil não vira exceção nem valor fora da lista', () => {
	const hostis = [
		'?periodo[]=30',
		'?q=' + encodeURIComponent('<script>alert(1)</script>'),
		'?q=' + encodeURIComponent("'; drop table impressao; --"),
		'?rolo=' + encodeURIComponent('1 OR 1=1'),
		'?pagina=1e999',
		'?finalidade=estudio&finalidade=pessoal',
		'?periodo=30&periodo=tudo',
		'?status=' + encodeURIComponent('sucesso\r\nSet-Cookie: x=1')
	];

	for (const q of hostis) {
		it(`sobrevive a "${q}"`, () => {
			const r = ler(q, [1]);
			expect(['tudo', '7', '30', '90', '365']).toContain(r.periodo);
			expect(['todas', 'estudio', 'homelab', 'conteudo', 'pessoal', 'outro']).toContain(r.finalidade);
			expect(['todos', 'sucesso', 'falha', 'cancelada']).toContain(r.status);
			expect(r.roloId === null || Number.isInteger(r.roloId)).toBe(true);
			expect(Number.isInteger(r.pagina)).toBe(true);
			expect(r.pagina).toBeGreaterThanOrEqual(1);
			expect(r.busca.length).toBeLessThanOrEqual(80);
		});
	}

	it('parâmetro repetido fica com o primeiro, como a visualização já faz', () => {
		expect(ler('?periodo=30&periodo=tudo').periodo).toBe('30');
	});
});

describe('casaBusca', () => {
	it('acha pedaço no meio do nome, sem ligar para caixa', () => {
		expect(casaBusca('MagicTray - Apple Magic Keyboard', 'magic')).toBe(true);
		expect(casaBusca('MagicTray', 'TRAY')).toBe(true);
	});

	it('ignora acento dos dois lados — "peca" acha "peça"', () => {
		expect(casaBusca('Peça de teste', 'peca')).toBe(true);
		expect(casaBusca('Peca de teste', 'peça')).toBe(true);
	});

	it('não casa o que não está lá', () => {
		expect(casaBusca('MagicTray', 'gridfinity')).toBe(false);
	});

	it('busca vazia casa com tudo — filtro em branco não é filtro', () => {
		expect(casaBusca('qualquer coisa', '')).toBe(true);
	});

	it('espaço em volta do nome guardado não atrapalha', () => {
		expect(casaBusca('  MagicTray  ', 'magictray')).toBe(true);
	});
});

describe('subtotal', () => {
	const linhas = [
		{ custoTotalCents: 605, gramas: 47.72 },
		{ custoTotalCents: 689, gramas: 54.29 },
		{ custoTotalCents: 752, gramas: 59.4 },
		{ custoTotalCents: 660, gramas: 52.15 }
	];

	it('soma o RECORTE inteiro, não a página', () => {
		expect(subtotal(linhas)).toEqual({ impressoes: 4, custoTotalCents: 2706, gramas: 213.6 });
	});

	it('recorte vazio soma zero, e não NaN', () => {
		expect(subtotal([])).toEqual({ impressoes: 0, custoTotalCents: 0, gramas: 0 });
	});

	it('arredonda as gramas em uma casa, como o resto do sistema', () => {
		expect(subtotal([{ custoTotalCents: 0, gramas: 0.1 }, { custoTotalCents: 0, gramas: 0.2 }]).gramas).toBe(0.3);
	});
});

describe('paginar', () => {
	it('fatia a página pedida', () => {
		expect(paginar(300, 1)).toMatchObject({ pagina: 1, totalPaginas: 6, inicio: 0, fim: 50 });
		expect(paginar(300, 3)).toMatchObject({ pagina: 3, inicio: 100, fim: 150 });
	});

	it('página além do fim volta para a última — 200 registros não ficam inalcançáveis', () => {
		expect(paginar(300, 99)).toMatchObject({ pagina: 6, inicio: 250, fim: 300 });
	});

	it('lista vazia continua sendo uma página', () => {
		expect(paginar(0, 1)).toMatchObject({ pagina: 1, totalPaginas: 1, inicio: 0, fim: 0 });
	});

	it('o tamanho da página é o mesmo em todo lugar', () => {
		expect(POR_PAGINA).toBe(50);
		expect(paginar(51, 2)).toMatchObject({ totalPaginas: 2, inicio: 50, fim: 51 });
	});
});

describe('enderecoDoRecorte', () => {
	const url = (busca: string) => new URL(`http://192.0.2.10:3316/impressoes${busca}`);

	it('troca de página preservando o recorte', () => {
		const href = enderecoDoRecorte(url('?finalidade=estudio&q=tray'), { pagina: 3 });
		expect(href).toContain('finalidade=estudio');
		expect(href).toContain('q=tray');
		expect(href).toContain('pagina=3');
	});

	it('preserva a visualização escolhida ao virar a página', () => {
		expect(enderecoDoRecorte(url('?ver=lista'), { pagina: 2 })).toContain('ver=lista');
	});

	it('a primeira página não carrega `pagina=1` na URL', () => {
		expect(enderecoDoRecorte(url('?pagina=4'), { pagina: 1 })).not.toContain('pagina');
	});

	it('não carrega o aviso de exclusão para a página seguinte', () => {
		expect(enderecoDoRecorte(url('?excluida=MagicTray'), { pagina: 2 })).not.toContain('excluida');
	});

	it('codifica parâmetro hostil em vez de concatenar cru', () => {
		const href = enderecoDoRecorte(url('?q=' + encodeURIComponent('"><b>')), { pagina: 2 });
		expect(href).not.toContain('<b>');
	});
});

describe('textoDoRecorte', () => {
	it('escreve o recorte em uma frase, com o subtotal', () => {
		const r = ler('?finalidade=estudio');
		expect(textoDoRecorte(r, { impressoes: 14, custoTotalCents: 6320, gramas: 512.3 })).toBe(
			'14 impressões · R$ 63,20 · 512,3 g'
		);
	});

	it('uma impressão só não vira plural', () => {
		expect(textoDoRecorte(recorteVazio(), { impressoes: 1, custoTotalCents: 605, gramas: 47.7 })).toBe(
			'1 impressão · R$ 6,05 · 47,7 g'
		);
	});

	it('recorte sem nada diz que não achou, sem números zerados', () => {
		expect(textoDoRecorte(ler('?q=xyz'), { impressoes: 0, custoTotalCents: 0, gramas: 0 })).toBe(
			'nenhuma impressão neste recorte'
		);
	});
});
