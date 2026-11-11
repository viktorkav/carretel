export interface ImpressaoResumo {
	inicioEm: number;
	gramas: number;
	duracaoS: number;
	status: 'sucesso' | 'falha' | 'cancelada';
	custoTotalCents: number;
	finalidade: string;
}

export interface OpcoesResumo {
	/** Vem de `config.rateioFalhas`. Ver `ratearDesperdicio` abaixo. */
	rateioFalhas?: boolean;
}

export interface Resumo {
	totalImpressoes: number;
	gramas: number;
	horas: number;
	custoTotalCents: number;
	gramasDesperdicadas: number;
	custoDesperdicadoCents: number;
	taxaSucesso: number;
	porFinalidade: Record<string, number>;
	/** true quando o rateio estava ligado E havia desperdício para ratear. */
	rateioAtivo: boolean;
	/** Quanto o custo por finalidade foi inflado pelo rateio. 1 = nada. */
	fatorDesperdicio: number;
}

/**
 * Redistribui o custo das falhas sobre as finalidades que deram certo,
 * mantendo a soma dos baldes igual ao custo total do período.
 *
 * O arredondamento por balde não fecha sozinho (dois baldes de 1000 com 1
 * centavo de desperdício viram 1001 + 1001 = 2002 contra um total de 2001), e
 * um centavo a mais no painel é o tipo de coisa que faz o usuário desconfiar do
 * sistema inteiro. Por isso o resíduo é jogado no maior balde — o único em que
 * um centavo não muda a leitura.
 */
function ratearDesperdicio(
	porFinalidadeSucesso: Record<string, number>,
	fator: number,
	custoTotalCents: number
): Record<string, number> {
	const rateado: Record<string, number> = {};
	let soma = 0;
	let maior: string | null = null;

	for (const [finalidade, cents] of Object.entries(porFinalidadeSucesso)) {
		rateado[finalidade] = Math.round(cents * fator);
		soma += rateado[finalidade];
		if (maior === null || rateado[finalidade] > rateado[maior]) maior = finalidade;
	}

	if (maior !== null) rateado[maior] += custoTotalCents - soma;
	return rateado;
}

export function resumoDoPeriodo(
	impressoes: ImpressaoResumo[],
	inicioEm: number,
	fimEm: number,
	opcoes: OpcoesResumo = {}
): Resumo {
	const janela = impressoes.filter((i) => i.inicioEm >= inicioEm && i.inicioEm <= fimEm);

	const resumo: Resumo = {
		totalImpressoes: janela.length,
		gramas: 0,
		horas: 0,
		custoTotalCents: 0,
		gramasDesperdicadas: 0,
		custoDesperdicadoCents: 0,
		taxaSucesso: 0,
		porFinalidade: {},
		rateioAtivo: false,
		fatorDesperdicio: 1
	};

	// Dois recortes do mesmo gasto: com tudo (o padrão) e só o que virou peça
	// (base do rateio). Montar os dois no mesmo laço evita uma segunda varredura.
	const porFinalidadeSucesso: Record<string, number> = {};
	let sucessos = 0;

	for (const i of janela) {
		resumo.gramas += i.gramas;
		resumo.horas += i.duracaoS / 3600;
		resumo.custoTotalCents += i.custoTotalCents;
		resumo.porFinalidade[i.finalidade] =
			(resumo.porFinalidade[i.finalidade] ?? 0) + i.custoTotalCents;

		if (i.status === 'sucesso') {
			sucessos++;
			porFinalidadeSucesso[i.finalidade] =
				(porFinalidadeSucesso[i.finalidade] ?? 0) + i.custoTotalCents;
		} else {
			// Falha e cancelamento consomem filamento que não virou peça.
			// Fica separado do custo das peças de propósito: ratear o
			// desperdício de uma impressão sobre outra tornaria o custo
			// individual impossível de auditar.
			resumo.gramasDesperdicadas += i.gramas;
			resumo.custoDesperdicadoCents += i.custoTotalCents;
		}
	}

	resumo.gramas = Math.round(resumo.gramas * 10) / 10;
	resumo.taxaSucesso = janela.length > 0 ? sucessos / janela.length : 0;

	// `config.rateioFalhas` ligado: o desperdício do período deixa de ser uma
	// linha à parte no relatório por finalidade e passa a inflar o custo do que
	// deu certo — que é o que o desperdício de fato custou. O custo da PEÇA não
	// muda (continua congelado e auditável em /impressoes/[id]); o que muda é a
	// leitura do período.
	//
	// Período sem desperdício não tem o que ratear, e período em que tudo falhou
	// não tem sobre o que ratear — nos dois casos o fator fica em 1 e os baldes
	// ficam como estavam, em vez de sumir com o gasto do período.
	const custoSucessoCents = resumo.custoTotalCents - resumo.custoDesperdicadoCents;
	if (opcoes.rateioFalhas && resumo.custoDesperdicadoCents > 0 && custoSucessoCents > 0) {
		resumo.rateioAtivo = true;
		resumo.fatorDesperdicio = resumo.custoTotalCents / custoSucessoCents;
		resumo.porFinalidade = ratearDesperdicio(
			porFinalidadeSucesso,
			resumo.fatorDesperdicio,
			resumo.custoTotalCents
		);
	}

	return resumo;
}
