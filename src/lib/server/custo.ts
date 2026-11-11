export interface EntradaCusto {
	gramas: number;
	duracaoS: number;
	rolo: { precoPagoCents: number; pesoLiquidoInicialG: number };
	impressora: { precoCompraCents: number; vidaUtilHoras: number; potenciaMediaW: number };
	tarifaKwhCents: number;
	manutencao: { totalCents: number; horasAcumuladas: number };
}

export interface Custo {
	filamentoCents: number;
	energiaCents: number;
	depreciacaoCents: number;
	manutencaoCents: number;
	totalCents: number;
}

/** Divide protegendo contra denominador zero ou negativo. */
function dividir(numerador: number, denominador: number): number {
	if (!denominador || denominador <= 0) return 0;
	return numerador / denominador;
}

/**
 * Sanitiza valores numéricos que chegam da borda do sistema.
 * NaN, Infinity, -Infinity ou valores negativos viram zero.
 *
 * Este módulo é a base de todos os custos do sistema — um NaN ou Infinity
 * gravados no banco é irrecuperável. Preferimos zeragem consciente a propagação
 * silenciosa de lixo, porque:
 * - Zero é semanticamente defensável (nenhum grama, nenhuma hora = nenhum custo)
 * - NaN/Infinity no banco quebra relatórios, auditorias e cascata de cálculos
 * - Quem chama este módulo tem chance de validar e reconhecê-lo; já no banco é opaco
 */
function sanitizar(valor: number): number {
	if (!Number.isFinite(valor) || valor < 0) return 0;
	return valor;
}


export function calcularCusto(e: EntradaCusto): Custo {
	// Saneamento completo na borda: todos os 10 campos numéricos de entrada.
	// Qualquer coisa que não seja número positivo finito vira zero.
	const gramas = sanitizar(e.gramas);
	const duracaoS = sanitizar(e.duracaoS);
	const roloPrecoPagoCents = sanitizar(e.rolo.precoPagoCents);
	const roloPesoLiquidoInicialG = sanitizar(e.rolo.pesoLiquidoInicialG);
	const impressoraPrecoCompraCents = sanitizar(e.impressora.precoCompraCents);
	const impressoraVidaUtilHoras = sanitizar(e.impressora.vidaUtilHoras);
	const impressoraPotenciaMediaW = sanitizar(e.impressora.potenciaMediaW);
	const tarifaKwhCents = sanitizar(e.tarifaKwhCents);
	const manutencaoTotalCents = sanitizar(e.manutencao.totalCents);
	const manutencaoHorasAcumuladas = sanitizar(e.manutencao.horasAcumuladas);

	const horas = duracaoS / 3600;

	const centavosPorGrama = dividir(roloPrecoPagoCents, roloPesoLiquidoInicialG);
	const filamentoCents = Math.round(gramas * centavosPorGrama);

	const energiaCents = Math.round(horas * (impressoraPotenciaMediaW / 1000) * tarifaKwhCents);

	const centavosPorHoraMaquina = dividir(
		impressoraPrecoCompraCents,
		impressoraVidaUtilHoras
	);
	const depreciacaoCents = Math.round(horas * centavosPorHoraMaquina);

	const centavosPorHoraManutencao = dividir(
		manutencaoTotalCents,
		manutencaoHorasAcumuladas
	);
	const manutencaoCents = Math.round(horas * centavosPorHoraManutencao);

	return {
		filamentoCents,
		energiaCents,
		depreciacaoCents,
		manutencaoCents,
		// Soma das parcelas JÁ arredondadas: o total precisa bater com o que
		// a interface mostra linha a linha, senão o usuário vê 1 centavo de
		// diferença e desconfia do sistema inteiro.
		totalCents: filamentoCents + energiaCents + depreciacaoCents + manutencaoCents
	};
}
