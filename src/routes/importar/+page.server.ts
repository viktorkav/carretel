import { fail } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import { lerConfig } from '$lib/server/repo';
import { buscarPerfil, buscarTarefas, type ErroNuvem } from '$lib/server/nuvem/api';
import { baixarCapas } from '$lib/server/nuvem/imagem';
import {
	candidatasDeImpressora,
	candidatosDeRolo,
	completarPlates,
	contarSemCapa,
	contarSemPlate,
	finalidadesConhecidas,
	recuperarCapas,
	importarTarefas,
	lerEntradasDoFormulario,
	marcarImportacao,
	separarJaImportadas,
	totalJaImportado
} from '$lib/server/nuvem/importacao';
import { agruparParaAtribuicao } from '$lib/server/nuvem/sugestao';
import type { Actions, PageServerLoad } from './$types';

/**
 * A tela nunca chama a nuvem sozinha no `load`: importar é uma ação
 * deliberada, e uma chamada automática transformaria toda visita à página numa
 * requisição autenticada (e num 401 na cara de quem só estava navegando).
 */
export const load: PageServerLoad = async () => {
	const cfg = lerConfig(db);
	return {
		temToken: Boolean(cfg.tokenNuvem && cfg.tokenNuvem.trim()),
		ultimaImportacaoEm: cfg.ultimaImportacaoEm ? cfg.ultimaImportacaoEm.getTime() : null,
		jaImportadas: totalJaImportado(db),
		// Quantas já entraram sem capa. É o que dá pergunta ao botão de recuperar.
		semCapa: contarSemCapa(db),
		// Quantas já entraram sem plate ou sem projeto — o passivo que a ação de
		// completar resolve. Zero faz o card sumir da tela.
		semPlate: contarSemPlate(db),
		rolos: candidatosDeRolo(db),
		impressoras: candidatasDeImpressora(db)
	};
};

/** Erro da nuvem virando resposta de formulário. Nunca 500, nunca silêncio. */
function falhaDaNuvem(erro: ErroNuvem) {
	// 401 tem tratamento próprio na tela: é o único caso em que a saída é o
	// usuário colar um token novo (não existe renovação programática).
	const status = erro.motivo === 'token' ? 400 : 502;
	return fail(status, { erro: erro.mensagem, motivo: erro.motivo });
}

function conferir(
	colhidas: number,
	total: number | null,
	completa: boolean,
	descartadas: number,
	pesoColhidoG: number,
	perfil: { pesoTotalG: number | null; tempoTotalS: number | null } | null
) {
	const pesoNuvemG = perfil?.pesoTotalG ?? null;
	// A reconciliação é uma COTA, não um diff: o que interessa é a distância
	// entre os dois números. Ela só passou a existir de verdade quando
	// `buscarPerfil` foi corrigido para ler dentro de `personal` — antes disso
	// o total vinha nulo sempre e a rede de segurança era decoração.
	const deltaPesoG =
		pesoNuvemG === null ? null : Math.round((pesoColhidoG - pesoNuvemG) * 100) / 100;

	return {
		colhidas,
		total,
		completa,
		descartadas,
		pesoColhidoG: Math.round(pesoColhidoG),
		// Totais vitalícios da conta. É contra eles que se percebe importação
		// incompleta — a diferença aparece na tela em vez de passar batida.
		pesoNuvemG,
		deltaPesoG,
		// 1% de folga: os dois números são somados por caminhos diferentes e uma
		// diferença de casas decimais não é sinal de nada. Acima disso, alguma
		// tarefa não veio na leitura.
		pesoDiverge: pesoNuvemG !== null && pesoNuvemG > 0 && Math.abs(deltaPesoG!) > pesoNuvemG / 100,
		tempoNuvemS: perfil?.tempoTotalS ?? null
	};
}

export const actions: Actions = {
	/** Passo 1: lê a nuvem e monta a lista para atribuição. Não grava nada. */
	buscar: async () => {
		const cfg = lerConfig(db);
		const token = cfg.tokenNuvem?.trim() ?? '';
		if (!token) {
			return fail(400, {
				erro: 'sem token da nuvem; cole o token na tela de Config',
				motivo: 'token'
			});
		}

		const colheita = await buscarTarefas(token);
		if (!colheita.ok) return falhaDaNuvem(colheita.erro);

		const perfil = await buscarPerfil(token);

		const { novas, jaImportadas } = separarJaImportadas(db, colheita.valor.tarefas);
		const rolos = candidatosDeRolo(db);
		const impressoras = candidatasDeImpressora(db);

		return {
			buscou: true,
			jaImportadas,
			// A quarta camada da chamada é o histórico de finalidade por peça: é
			// ela que faz a quinta impressão do MagicTray já chegar classificada,
			// em vez de cair no balde único que o painel denunciou.
			grupos: agruparParaAtribuicao(novas, rolos, impressoras, finalidadesConhecidas(db)),
			conferencia: conferir(
				colheita.valor.tarefas.length,
				colheita.valor.total,
				colheita.valor.completa,
				colheita.valor.descartadas,
				colheita.valor.tarefas.reduce((s, t) => s + t.gramas, 0),
				perfil.ok ? perfil.valor : null
			)
		};
	},

	/**
	 * Fora dos dois passos: baixa a capa de quem já foi importado sem ela.
	 *
	 * Existe porque a URL da capa expira em 1 h e a tarefa não. Quem importou
	 * antes desta rodada (ou com o antigo checkbox desmarcado) não precisa
	 * excluir e reimportar — o que reabriria a atribuição de rolo e recongelaria
	 * custo — só para ganhar uma miniatura.
	 */
	capas: async () => {
		const cfg = lerConfig(db);
		const token = cfg.tokenNuvem?.trim() ?? '';
		if (!token) {
			return fail(400, {
				erro: 'sem token da nuvem; cole o token na tela de Config',
				motivo: 'token'
			});
		}

		const colheita = await buscarTarefas(token);
		if (!colheita.ok) return falhaDaNuvem(colheita.erro);

		return { capas: await recuperarCapas(db, colheita.valor.tarefas) };
	},

	/**
	 * Também fora dos dois passos: completa a plate e o projeto de quem já foi
	 * importado sem eles.
	 *
	 * **Por que reimportar não resolve.** A deduplicação por `taskIdNuvem` é o
	 * que torna a importação idempotente: uma segunda rodada devolve
	 * `duplicadas: 11, gravadas: 0`, e as linhas antigas nunca são reescritas.
	 * E excluir para reimportar traria os campos junto com a perda da
	 * atribuição de rolo feita uma a uma, da finalidade, do peso corrigido na
	 * balança e do custo congelado no dia certo.
	 *
	 * O que esta ação escreve são **duas colunas, e só onde estão vazias** —
	 * ver `completarPlates`. É o mesmo desenho da recuperação de capas: o
	 * passivo de uma importação antiga se resolve no lugar, sem reabrir decisão
	 * nenhuma.
	 */
	completar: async () => {
		const cfg = lerConfig(db);
		const token = cfg.tokenNuvem?.trim() ?? '';
		if (!token) {
			return fail(400, {
				erro: 'sem token da nuvem; cole o token na tela de Config',
				motivo: 'token'
			});
		}

		const colheita = await buscarTarefas(token);
		if (!colheita.ok) return falhaDaNuvem(colheita.erro);

		return { completou: completarPlates(db, colheita.valor.tarefas) };
	},

	/**
	 * Passo 2: grava.
	 *
	 * O histórico é buscado DE NOVO em vez de vir do formulário. Duas razões: o
	 * formulário só carrega `taskId → rolo`, então nenhum número que alimenta
	 * custo vem do navegador; e `cover` é URL pré-assinada de 1 h, que precisa
	 * estar fresca na hora de baixar a imagem.
	 */
	gravar: async ({ request }) => {
		const form = await request.formData();
		const cfg = lerConfig(db);
		const token = cfg.tokenNuvem?.trim() ?? '';
		if (!token) {
			return fail(400, {
				erro: 'sem token da nuvem; cole o token na tela de Config',
				motivo: 'token'
			});
		}

		const colheita = await buscarTarefas(token);
		if (!colheita.ok) return falhaDaNuvem(colheita.erro);

		const entradas = lerEntradasDoFormulario(form, colheita.valor.tarefas);
		if (entradas.length === 0) {
			return fail(400, { erro: 'nenhuma tarefa selecionada para importar' });
		}

		{
			// A capa é SEMPRE baixada. Era um checkbox, e o checkbox era uma
			// armadilha: `cover` é URL pré-assinada de 1 h, então desmarcar a
			// caixa custava a imagem daquele lote e a única saída era reimportar
			// tudo. O custo do lado marcado é ridículo perto disso — as 11 capas
			// que já estão em produção somam 164 KB, e uma falha de download
			// nunca interrompe a importação (`baixarCapas` engole tudo).
			//
			// O que sobrou do checkbox virou o botão "recuperar capas que faltam",
			// que resolve o passivo em vez de criar mais.
			//
			// Só baixa o que vai mesmo virar linha: tarefa atribuída, importável,
			// aceita (quando exige aceite) e ainda não importada. Baixar a capa de
			// uma duplicata gastaria requisição e disco para nada.
			const alvo = entradas.filter(
				(e) =>
					e.roloId !== null &&
					e.impressoraId !== null &&
					e.tarefa.importavel &&
					(!e.tarefa.exigeConfirmacao || e.confirmado) &&
					// Peça abortada sem peso digitado vai ser pulada: baixar a capa
					// dela gastaria requisição e disco por uma linha que não nasce.
					(!e.tarefa.exigePesoReal || (e.gramasInformadas ?? null) !== null) &&
					e.tarefa.capaUrl
			);
			const { novas } = separarJaImportadas(
				db,
				alvo.map((e) => e.tarefa)
			);
			const novosIds = new Set(novas.map((t) => t.taskId));
			const aBaixar = alvo.filter((e) => novosIds.has(e.tarefa.taskId));

			// Com teto de simultaneidade: dezenas de downloads disparados juntos
			// num processo Node único no ZimaCube é o que engasga a importação.
			const capas = await baixarCapas(
				aBaixar.map((e) => ({ taskId: e.tarefa.taskId, url: e.tarefa.capaUrl }))
			);
			for (const e of aBaixar) e.imagemPath = capas.get(e.tarefa.taskId) ?? null;
		}

		const resultado = importarTarefas(db, entradas);

		// A data só é carimbada quando algo entrou de verdade — ver `marcarImportacao`.
		marcarImportacao(db, resultado);

		const perfil = await buscarPerfil(token);

		return {
			gravou: true,
			resultado,
			conferencia: conferir(
				colheita.valor.tarefas.length,
				colheita.valor.total,
				colheita.valor.completa,
				colheita.valor.descartadas,
				colheita.valor.tarefas.reduce((s, t) => s + t.gramas, 0),
				perfil.ok ? perfil.valor : null
			)
		};
	}
};
