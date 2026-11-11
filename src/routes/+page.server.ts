import { db, schema } from '$lib/server/db';
import { estaEncerrado } from '$lib/server/encerramento';
import { alertasDoRolo } from '$lib/server/estoque';
import { listarAtivos } from '$lib/server/filamentos-ativos';
import { resolverImagem } from '$lib/server/imagens';
import { resumoDoPeriodo } from '$lib/server/painel';
import { estoqueDoRolo, lerConfig } from '$lib/server/repo';
import type { PageServerLoad } from './$types';

const DIAS_PADRAO = 30;
/** Quantas impressões do período a tela inicial lista antes de mandar para /impressoes. */
const RECENTES_NA_TELA = 5;

export const load: PageServerLoad = async ({ url }) => {
	// "?dias=abc" ou "?dias=-5" não pode virar NaN/negativo dentro da janela —
	// aqui é load, não action, mas a mesma regra de nunca quebrar por entrada
	// de usuário vale.
	const diasBruto = Number(url.searchParams.get('dias'));
	const dias = Number.isFinite(diasBruto) && diasBruto > 0 ? diasBruto : DIAS_PADRAO;

	const fimEm = Date.now();
	const inicioEm = fimEm - dias * 86_400_000;

	const todas = db.select().from(schema.impressao).all();

	const impressoes = todas.map((i) => ({
		inicioEm: i.inicioEm.getTime(),
		gramas: i.gramas,
		duracaoS: i.duracaoS,
		status: i.status,
		custoTotalCents: i.custoTotalCents,
		finalidade: i.finalidade
	}));

	// O HISTÓRICO do intervalo: a mesma janela que `resumoDoPeriodo` usa
	// (`inicioEm` entre o começo do período e agora), para que a lista e os
	// totais ao lado dela nunca contem coisas diferentes. São as últimas da
	// janela; o total continua vindo do resumo, não do tamanho desta lista.
	const todosOsRolos = db.select().from(schema.rolo).all();

	// Cada peça da lista leva o que a tela precisa para MOSTRAR a peça: se há
	// capa guardada (perguntado ao disco, como em /impressoes — uma linha
	// apontando para arquivo que sumiu não pode virar imagem quebrada) e a cor
	// do rolo, para a capa aparecer na cor do filamento. O caminho no disco não
	// sai do servidor.
	const recentes = await Promise.all(
		todas
			.filter((i) => i.inicioEm.getTime() >= inicioEm && i.inicioEm.getTime() <= fimEm)
			.sort((a, b) => b.inicioEm.getTime() - a.inicioEm.getTime())
			.slice(0, RECENTES_NA_TELA)
			.map(async (i) => ({
				id: i.id,
				nomeLivre: i.nomeLivre,
				inicioEm: i.inicioEm.getTime(),
				gramas: i.gramas,
				status: i.status,
				custoTotalCents: i.custoTotalCents,
				temImagem: (await resolverImagem(i.imagemPath)).ok,
				corHex: todosOsRolos.find((r) => r.id === i.roloId)?.corHex ?? null
			}))
	);

	// O ESTOQUE ATUAL: todo rolo que ainda está em circulação (lacrado ou
	// aberto), a mesma régua de "em estoque" da tela de filamentos. Não leva
	// `dias` em conta de propósito — o saldo é o de agora, qualquer que seja o
	// período escolhido para o resumo.
	//
	// Cada rolo carrega os PRÓPRIOS avisos e a posição em que está carregado: o
	// aviso é mostrado no rolo, com a ação dele, e não numa lista à parte. A
	// regra dos avisos é a mesma de sempre (`alertasDoRolo`, só rolo aberto);
	// `diasSemSecar` é o número que a regra de umidade usou, para a tela dizer
	// há quanto tempo em vez de só "pode estar úmido".
	const carregados = listarAtivos(db);
	const estoque = todosOsRolos
		.filter((r) => !estaEncerrado(r.status))
		.map((r) => {
			const restanteG = estoqueDoRolo(db, r.id).restanteG;
			const referenciaDaSecagem = r.dataUltimaSecagem ?? r.dataAbertura;
			return {
				id: r.id,
				codigo: r.codigo,
				marca: r.marca,
				material: r.material,
				cor: r.cor,
				corHex: r.corHex,
				status: r.status,
				pesoLiquidoInicialG: r.pesoLiquidoInicialG,
				restanteG,
				alertas:
					r.status === 'aberto'
						? alertasDoRolo({
								restanteG,
								pesoInicialG: r.pesoLiquidoInicialG,
								dataAbertura: r.dataAbertura ? r.dataAbertura.getTime() : null,
								dataUltimaSecagem: r.dataUltimaSecagem ? r.dataUltimaSecagem.getTime() : null,
								agora: fimEm
							}).map((a) => a.tipo)
						: [],
				diasSemSecar: referenciaDaSecagem
					? Math.floor((fimEm - referenciaDaSecagem.getTime()) / 86_400_000)
					: null,
				secagemRegistrada: r.dataUltimaSecagem !== null,
				posicao: carregados.find((c) => c.roloId === r.id)?.posicao ?? null
			};
		})
		.sort((a, b) => a.restanteG - b.restanteG);

	const rolos = todosOsRolos.filter((r) => r.status === 'aberto');

	const alertas = rolos.flatMap((r) => {
		const saldo = estoqueDoRolo(db, r.id);
		return alertasDoRolo({
			restanteG: saldo.restanteG,
			pesoInicialG: r.pesoLiquidoInicialG,
			dataAbertura: r.dataAbertura ? r.dataAbertura.getTime() : null,
			dataUltimaSecagem: r.dataUltimaSecagem ? r.dataUltimaSecagem.getTime() : null,
			agora: fimEm
			// O código vai junto porque "rolo #7" não diz nada na prateleira —
			// `PLA-PRETO-01` está escrito no carretel.
		}).map((a) => ({ ...a, roloId: r.id, codigo: r.codigo }));
	});

	// `config.rateioFalhas` era um interruptor morto: editável em /config,
	// gravado, e lido por ninguém. É aqui que ele age.
	const cfg = lerConfig(db);

	return {
		dias,
		resumo: resumoDoPeriodo(impressoes, inicioEm, fimEm, { rateioFalhas: cfg.rateioFalhas }),
		recentes,
		estoque,
		alertas
	};
};
