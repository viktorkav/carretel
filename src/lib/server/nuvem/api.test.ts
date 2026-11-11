import { describe, expect, it } from 'vitest';
import { criarNuvemFalsa, criarPerfilBruto, criarTarefaBruta } from './fixtures';
import { buscarPerfil, buscarTarefas } from './api';

function conta(quantidade: number) {
	return Array.from({ length: quantidade }, (_, i) => criarTarefaBruta({ id: 1000 + i }));
}

describe('buscarTarefas — paginação', () => {
	it('atravessa todas as páginas até esgotar a conta', async () => {
		const { fetchFalso } = criarNuvemFalsa({ tarefas: conta(45), tamanhoPagina: 20 });

		const r = await buscarTarefas('tok', { fetch: fetchFalso, limite: 20 });

		expect(r.ok).toBe(true);
		if (!r.ok) return;
		// 45 e não 20: quem pagina por `after` para na primeira página, porque a
		// API aceita o parâmetro e o ignora.
		expect(r.valor.tarefas).toHaveLength(45);
		expect(r.valor.total).toBe(45);
		expect(r.valor.completa).toBe(true);
	});

	it('pagina por offset — o parâmetro `after` não move a janela na API real', async () => {
		const { fetchFalso, urls } = criarNuvemFalsa({ tarefas: conta(45), tamanhoPagina: 20 });

		await buscarTarefas('tok', { fetch: fetchFalso, limite: 20 });

		// A última chamada (offset 45) é a que devolve `hits` vazio — é ela que
		// prova que o histórico acabou, e é a única prova aceita.
		const offsets = urls.map((u) => new URL(u).searchParams.get('offset'));
		expect(offsets).toEqual(['0', '20', '40', '45']);
		expect(urls.every((u) => new URL(u).searchParams.get('limit') === '20')).toBe(true);
		expect(urls.some((u) => new URL(u).searchParams.has('after'))).toBe(false);
	});

	it('avança pelo tamanho da página RECEBIDA, não pelo limite pedido', async () => {
		// A API tem teto próprio: pedir 100 e receber 20 é normal. Avançar o
		// offset pelo limite pedido pularia 80 tarefas por página, em silêncio.
		const { fetchFalso, urls } = criarNuvemFalsa({ tarefas: conta(45), tamanhoPagina: 20 });

		const r = await buscarTarefas('tok', { fetch: fetchFalso, limite: 100 });

		expect(r.ok && r.valor.tarefas).toHaveLength(45);
		expect(urls.map((u) => new URL(u).searchParams.get('offset'))).toEqual([
			'0',
			'20',
			'40',
			'45'
		]);
	});

	it('não repete tarefa quando páginas se sobrepõem', async () => {
		const tarefas = conta(30);
		const { fetchFalso } = criarNuvemFalsa({ tarefas, tamanhoPagina: 20 });
		const r = await buscarTarefas('tok', { fetch: fetchFalso, limite: 20 });

		expect(r.ok).toBe(true);
		if (!r.ok) return;
		const ids = r.valor.tarefas.map((t) => t.taskId);
		expect(new Set(ids).size).toBe(ids.length);
	});

	it('para em vez de girar para sempre quando a janela não anda', async () => {
		// Simula o modo de falha do `after`: a API devolve a primeira página
		// sempre. Sem trava, o laço não termina nunca.
		let chamadas = 0;
		const fetchTravado = async () => {
			chamadas++;
			return new Response(JSON.stringify({ total: 999, hits: conta(20) }), { status: 200 });
		};
		const r = await buscarTarefas('tok', { fetch: fetchTravado as unknown as typeof fetch });

		expect(r.ok).toBe(true);
		if (!r.ok) return;
		expect(chamadas).toBeLessThan(5);
		// A conferência contra `total` é o que denuncia a importação incompleta.
		expect(r.valor.completa).toBe(false);
	});

	it('respeita a conta vazia', async () => {
		const { fetchFalso } = criarNuvemFalsa({ tarefas: [] });
		const r = await buscarTarefas('tok', { fetch: fetchFalso });
		expect(r.ok && r.valor.tarefas).toEqual([]);
	});
});

describe('buscarTarefas — `total` é conferência, não parada', () => {
	it('não trunca quando `total` mente para menos', async () => {
		// A API declara 5 e tem 45. Usar `total` como condição de parada cortaria
		// na primeira página e sumiria com 40 impressões sem dizer nada.
		const { fetchFalso } = criarNuvemFalsa({ tarefas: conta(45), tamanhoPagina: 20, total: 5 });
		const r = await buscarTarefas('tok', { fetch: fetchFalso, limite: 20 });

		expect(r.ok).toBe(true);
		if (!r.ok) return;
		expect(r.valor.tarefas).toHaveLength(45);
		expect(r.valor.total).toBe(5);
		expect(r.valor.completa).toBe(true);
	});

	it('não para cedo quando `total` mente para mais', async () => {
		const { fetchFalso } = criarNuvemFalsa({ tarefas: conta(10), tamanhoPagina: 20, total: 999 });
		const r = await buscarTarefas('tok', { fetch: fetchFalso, limite: 20 });

		expect(r.ok && r.valor.tarefas).toHaveLength(10);
		// Chegou a uma página vazia, então a leitura está completa mesmo com o
		// `total` divergente — quem denuncia a divergência é a conferência.
		expect(r.ok && r.valor.completa).toBe(true);
	});

	it('conclui a leitura mesmo sem `total` nenhum', async () => {
		const { fetchFalso } = criarNuvemFalsa({ tarefas: conta(25), tamanhoPagina: 20, semTotal: true });
		const r = await buscarTarefas('tok', { fetch: fetchFalso, limite: 20 });

		expect(r.ok).toBe(true);
		if (!r.ok) return;
		expect(r.valor.tarefas).toHaveLength(25);
		expect(r.valor.total).toBeNull();
		expect(r.valor.completa).toBe(true);
	});

	it('NÃO se declara completa quando a janela trava e não há `total`', async () => {
		// É o modo de falha exato do `after`, no cenário em que o sinal de
		// completude tinha como mentir: sem `total`, o antigo `total === null`
		// forçava `completa: true` e a tela não avisava nada.
		const fetchTravado = async () =>
			new Response(JSON.stringify({ hits: conta(20) }), { status: 200 });
		const r = await buscarTarefas('tok', { fetch: fetchTravado as unknown as typeof fetch });

		expect(r.ok).toBe(true);
		if (!r.ok) return;
		expect(r.valor.tarefas).toHaveLength(20);
		expect(r.valor.total).toBeNull();
		expect(r.valor.completa).toBe(false);
	});

	it('NÃO se declara completa quando bate no teto de páginas', async () => {
		// Cada página traz ids novos, para sempre: só o teto interrompe.
		let n = 0;
		const infinita = async () =>
			new Response(JSON.stringify({ hits: [criarTarefaBruta({ id: n++ })] }), { status: 200 });
		const r = await buscarTarefas('tok', { fetch: infinita as unknown as typeof fetch });

		expect(r.ok).toBe(true);
		if (!r.ok) return;
		expect(r.valor.completa).toBe(false);
	});
});

describe('buscarTarefas — timeout', () => {
	it('manda um AbortSignal em toda requisição', async () => {
		let sinal: unknown = null;
		const espiao = async (_u: unknown, init?: RequestInit) => {
			sinal = init?.signal;
			return new Response(JSON.stringify({ hits: [] }), { status: 200 });
		};
		await buscarTarefas('tok', { fetch: espiao as unknown as typeof fetch });

		expect(sinal).toBeInstanceOf(AbortSignal);
	});

	it('trata estouro de tempo com mensagem que diz o tempo', async () => {
		const lenta = async () => {
			const e = new Error('The operation was aborted due to timeout');
			e.name = 'TimeoutError';
			throw e;
		};
		const r = await buscarTarefas('tok', {
			fetch: lenta as unknown as typeof fetch,
			timeoutMs: 3000
		});

		expect(r.ok).toBe(false);
		if (r.ok) return;
		expect(r.erro.motivo).toBe('rede');
		expect(r.erro.mensagem).toMatch(/3s/);
	});

	it('aborta de verdade uma requisição que não responde', async () => {
		// Sem timeout, este teste penduraria: é o que aconteceria com a action.
		const nuncaResponde = (_u: unknown, init?: RequestInit) =>
			new Promise<Response>((_, rejeita) => {
				init?.signal?.addEventListener('abort', () => {
					const e = new Error('abortado');
					e.name = 'TimeoutError';
					rejeita(e);
				});
			});
		const r = await buscarTarefas('tok', {
			fetch: nuncaResponde as unknown as typeof fetch,
			timeoutMs: 40
		});

		expect(r.ok).toBe(false);
		if (r.ok) return;
		expect(r.erro.motivo).toBe('rede');
	});

	it('vale também para o perfil', async () => {
		let sinal: unknown = null;
		const espiao = async (_u: unknown, init?: RequestInit) => {
			sinal = init?.signal;
			return new Response('{}', { status: 200 });
		};
		await buscarPerfil('tok', { fetch: espiao as unknown as typeof fetch });
		expect(sinal).toBeInstanceOf(AbortSignal);
	});
});

describe('buscarTarefas — falhas', () => {
	it('trata 401 como token expirado, com pedido de token novo', async () => {
		const { fetchFalso } = criarNuvemFalsa({ tarefas: conta(3), tokenValido: 'certo' });
		const r = await buscarTarefas('errado', { fetch: fetchFalso });

		expect(r.ok).toBe(false);
		if (r.ok) return;
		expect(r.erro.motivo).toBe('token');
		expect(r.erro.mensagem).toMatch(/token/i);
	});

	it('recusa token em branco sem nem bater na rede', async () => {
		let chamou = false;
		const espiao = async () => {
			chamou = true;
			return new Response('{}', { status: 200 });
		};
		const r = await buscarTarefas('   ', { fetch: espiao as unknown as typeof fetch });

		expect(r.ok).toBe(false);
		expect(chamou).toBe(false);
	});

	it('trata queda de rede como erro tratado, não como exceção', async () => {
		const caindo = async () => {
			throw new TypeError('fetch failed');
		};
		const r = await buscarTarefas('tok', { fetch: caindo as unknown as typeof fetch });

		expect(r.ok).toBe(false);
		if (r.ok) return;
		expect(r.erro.motivo).toBe('rede');
	});

	it('trata 500 da nuvem sem virar 500 aqui', async () => {
		const quebrada = async () => new Response('oops', { status: 500 });
		const r = await buscarTarefas('tok', { fetch: quebrada as unknown as typeof fetch });

		expect(r.ok).toBe(false);
		if (r.ok) return;
		expect(r.erro.motivo).toBe('servidor');
		expect(r.erro.mensagem).toMatch(/500/);
	});

	it('trata corpo que não é JSON', async () => {
		const html = async () => new Response('<html>Cloudflare</html>', { status: 200 });
		const r = await buscarTarefas('tok', { fetch: html as unknown as typeof fetch });

		expect(r.ok).toBe(false);
		if (r.ok) return;
		expect(r.erro.motivo).toBe('resposta');
	});

	it('trata JSON válido com envelope inesperado', async () => {
		const estranho = async () => new Response(JSON.stringify({ message: 'ok' }), { status: 200 });
		const r = await buscarTarefas('tok', { fetch: estranho as unknown as typeof fetch });

		expect(r.ok).toBe(false);
		if (r.ok) return;
		expect(r.erro.motivo).toBe('resposta');
	});

	it('descarta hit malformado sem perder a página inteira', async () => {
		let pagina = 0;
		const misto = async () =>
			new Response(
				JSON.stringify({
					total: 2,
					hits: pagina++ === 0 ? [criarTarefaBruta({ id: 1 }), null, 'lixo', {}] : []
				}),
				{ status: 200 }
			);
		const r = await buscarTarefas('tok', { fetch: misto as unknown as typeof fetch });

		expect(r.ok).toBe(true);
		if (!r.ok) return;
		expect(r.valor.tarefas.map((t) => t.taskId)).toEqual(['1']);
		expect(r.valor.descartadas).toBe(3);
	});
});

describe('buscarTarefas — endereço', () => {
	it('fala com api.bambulab.com, nunca com o domínio nu', async () => {
		const { fetchFalso, urls } = criarNuvemFalsa({ tarefas: conta(1) });
		await buscarTarefas('tok', { fetch: fetchFalso });

		// `bambulab.com` puro está atrás do desafio da Cloudflare e devolve
		// HTML para cliente HTTP comum.
		expect(urls[0].startsWith('https://api.bambulab.com/v1/user-service/my/tasks?')).toBe(true);
	});

	it('manda o token como Bearer', async () => {
		let auth: string | null = null;
		const espiao = async (_u: unknown, init?: RequestInit) => {
			auth = new Headers(init?.headers).get('Authorization');
			return new Response(JSON.stringify({ total: 0, hits: [] }), { status: 200 });
		};
		await buscarTarefas('abc123', { fetch: espiao as unknown as typeof fetch });
		expect(auth).toBe('Bearer abc123');
	});
});

describe('buscarPerfil', () => {
	it('devolve os totais vitalícios para conferir a importação', async () => {
		const { fetchFalso } = criarNuvemFalsa({
			tarefas: [],
			perfil: criarPerfilBruto({ taskWeightSum: 4321, taskTimeSum: 987_654 })
		});
		const r = await buscarPerfil('tok', { fetch: fetchFalso });

		expect(r.ok).toBe(true);
		if (!r.ok) return;
		expect(r.valor.pesoTotalG).toBe(4321);
		expect(r.valor.tempoTotalS).toBe(987_654);
	});

	// O bug que fazia a conferência ser decorativa: `api.ts` lia `taskWeightSum`
	// na RAIZ do envelope, e a API o coloca dentro de `personal`. Como a fixture
	// também escrevia na raiz, os dois erros se cancelavam e a suíte passava.
	// Este teste fixa o nível certo pelos dois lados.
	it('lê os totais de dentro de `personal`, que é onde a API os coloca', async () => {
		const real = async () =>
			new Response(
				JSON.stringify({
					uid: 1,
					name: 'viktor',
					personal: { taskWeightSum: 623.33, taskTimeSum: 70_812, bio: '' }
				}),
				{ status: 200 }
			);
		const r = await buscarPerfil('tok', { fetch: real as unknown as typeof fetch });

		expect(r.ok).toBe(true);
		if (!r.ok) return;
		expect(r.valor.pesoTotalG).toBe(623.33);
		expect(r.valor.tempoTotalS).toBe(70_812);
	});

	it('ignora total escrito na raiz do envelope — não é onde a API escreve', async () => {
		const raiz = async () =>
			new Response(JSON.stringify({ uid: 1, taskWeightSum: 4321, taskTimeSum: 99 }), {
				status: 200
			});
		const r = await buscarPerfil('tok', { fetch: raiz as unknown as typeof fetch });

		expect(r.ok).toBe(true);
		if (!r.ok) return;
		expect(r.valor.pesoTotalG).toBeNull();
		expect(r.valor.tempoTotalS).toBeNull();
	});

	it('devolve null nos totais quando o perfil não os traz', async () => {
		const magro = async () => new Response(JSON.stringify({ uid: 1 }), { status: 200 });
		const r = await buscarPerfil('tok', { fetch: magro as unknown as typeof fetch });

		expect(r.ok).toBe(true);
		if (!r.ok) return;
		expect(r.valor.pesoTotalG).toBeNull();
	});

	it('devolve null quando `personal` vem com tipo estranho', async () => {
		const torto = async () =>
			new Response(JSON.stringify({ uid: 1, personal: 'nada' }), { status: 200 });
		const r = await buscarPerfil('tok', { fetch: torto as unknown as typeof fetch });

		expect(r.ok).toBe(true);
		if (!r.ok) return;
		expect(r.valor.pesoTotalG).toBeNull();
	});

	it('também trata 401', async () => {
		const { fetchFalso } = criarNuvemFalsa({ tarefas: [], tokenValido: 'certo' });
		const r = await buscarPerfil('errado', { fetch: fetchFalso });
		expect(r.ok).toBe(false);
		if (r.ok) return;
		expect(r.erro.motivo).toBe('token');
	});
});
