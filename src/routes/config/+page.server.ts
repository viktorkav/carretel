import { fail } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { db, schema } from '$lib/server/db';
import { textoParaCentavosPositivo } from '$lib/dinheiro';
import { lerConfig } from '$lib/server/repo';
import { CAMINHO_CATALOGO, estadoDoCatalogo, gerarCatalogo, itensDaBiblioteca } from '$lib/server/catalogo-arquivo';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
	const cfg = lerConfig(db);
	// O token NUNCA volta para a tela. Ele dá acesso à conta inteira da Bambu
	// por cerca de um ano e não tem como ser revogado daqui — a tela mostra só
	// que existe e desde quando.
	const { tokenNuvem, ...semSegredo } = cfg;
	const estado = estadoDoCatalogo();
 const biblioteca = itensDaBiblioteca();
	return {
		config: semSegredo,
  biblioteca: {itens:biblioteca.length,marcas:new Set(biblioteca.map(i=>i.marca)).size},
		temTokenNuvem: Boolean(tokenNuvem && tokenNuvem.trim()),
		ultimaImportacaoEm: cfg.ultimaImportacaoEm ? cfg.ultimaImportacaoEm.getTime() : null,
		catalogo: {
			caminho: CAMINHO_CATALOGO,
			...(estado.estado === 'ok'
				? {
						estado: 'ok' as const,
						itens: estado.catalogo.itens.length,
						commit: estado.catalogo.commit,
						geradoEm: estado.catalogo.geradoEm,
						fonte: estado.catalogo.fonte,
						licenca: estado.catalogo.licencaFonte
					}
				: estado)
		}
	};
};

export const actions: Actions = {
	/**
	 * Baixa (ou atualiza) o catálogo de filamentos.
	 *
	 * É a única parte do sistema que fala com a rede, e é sob demanda: a busca
	 * continua local, contra o arquivo já gerado. Serve pro primeiro boot que
	 * pegou o GitHub fora e pra quando a Bambu lançar filamento novo — sem
	 * redeploy.
	 */
	baixarCatalogo: async () => {
		const r = await gerarCatalogo();
		if (!r.ok) return fail(502, { erroCatalogo: r.erro });
		return { sucesso: true, avisoCatalogo: `Catálogo atualizado: ${r.itens} itens.` };
	},

	salvar: async ({ request }) => {
		const form = await request.formData();
		const cfgAtual = lerConfig(db);

		// `textoParaCentavosPositivo` devolve null pra vazio, não numérico,
		// negativo E zero — tarifa é a única config que ATUALIZA um valor
		// global em vez de criar um registro novo, então um typo aqui não pode
		// saturar em 0 e contaminar todo custo de energia calculado depois.
		// Nesses casos, preserva a tarifa atual em vez de gravar.
		const tarifaBruta = String(form.get('tarifa') ?? '');
		const tarifaValida = textoParaCentavosPositivo(tarifaBruta);
		const tarifaKwhCents = tarifaValida ?? cfgAtual.tarifaKwhCents;

		// `formatoDataPrint` controlava o parser de screenshot, que saiu do
		// escopo. O controle foi removido da tela e o campo deixou de ser
		// escrito aqui — se continuasse no `set`, todo "Salvar" gravaria o
		// padrão por cima do que estivesse lá. A COLUNA fica no schema: é
		// resíduo conhecido e não vale uma migration (decisão registrada na
		// spec).
		db.update(schema.config)
			.set({
				tarifaKwhCents,
				rateioFalhas: form.get('rateioFalhas') === 'on'
			})
			.where(eq(schema.config.id, 1))
			.run();

		// Campo vazio é "o usuário não quis trocar" — não avisa. Texto
		// digitado mas inválido é provável erro de digitação — avisa que não
		// foi gravado, em vez de deixar o usuário achar que salvou.
		if (tarifaValida === null && tarifaBruta.trim() !== '') {
			return {
				sucesso: true,
				avisoTarifa: 'tarifa inválida; mantido o valor anterior'
			};
		}

		return { sucesso: true };
	},

	/**
	 * Token da Cloud API da Bambu, colado à mão.
	 *
	 * Fica numa action própria, e não no "Salvar" geral, porque o campo volta
	 * sempre em branco (o token não é devolvido para a tela): num formulário
	 * único, todo Salvar de tarifa apagaria o token.
	 *
	 * O token é OPACO — não é JWT. Nada aqui tenta decodificá-lo para descobrir
	 * validade ou dono; qualquer código que tente isso quebra. A única
	 * verificação possível é usar e ver se volta 401, o que a tela de importação
	 * faz e reporta.
	 */
	salvarToken: async ({ request }) => {
		const form = await request.formData();
		const token = String(form.get('tokenNuvem') ?? '').trim();

		if (form.get('remover') === 'on') {
			db.update(schema.config)
				.set({ tokenNuvem: null })
				.where(eq(schema.config.id, 1))
				.run();
			return { sucesso: true, avisoToken: 'token removido' };
		}

		// Campo em branco é "não quis trocar", igual à tarifa — não apaga o que
		// está lá.
		if (!token) {
			return { sucesso: true, avisoToken: 'nada colado; o token anterior continua valendo' };
		}

		db.update(schema.config).set({ tokenNuvem: token }).where(eq(schema.config.id, 1)).run();
		return { sucesso: true };
	}
};
