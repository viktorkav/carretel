/**
 * Massa derivada do COMPRIMENTO de filamento, com a densidade do rolo.
 *
 * A nuvem manda dois números para a mesma coisa: `weight`, que é o peso
 * calculado pelo fatiador, e `length`, o comprimento de filamento em
 * centímetros. Os dois estão amarrados por geometria — filamento de 1,75 mm é
 * um cilindro de raio 0,0875 cm — e a única variável livre entre eles é a
 * densidade:
 *
 *     peso = comprimento × π × 0,0875² × densidade
 *
 * A densidade que o fatiador usou é a do PERFIL escolhido no Bambu Studio, que
 * não é necessariamente a do rolo que estava na máquina. Quando as duas
 * divergem, `weight` erra na mesma proporção — e sempre para o mesmo lado, o
 * que faz a deriva acumular em vez de se cancelar. Na base real: 609,18 g
 * gravados contra 639,06 g de material de verdade, 30 g sempre para "sobra
 * mais" (crítica de 10/08/2026, item 3).
 *
 * `rolo.densidade` já é cadastrada, validada e exibida — e não entrava em
 * cálculo nenhum. É ela que reconstrói o peso certo.
 *
 * ── Por que a conta CONFERE antes de corrigir ──────────────────────────────
 *
 * A unidade de `length` é engenharia reversa como o resto da API, e um campo
 * que venha em milímetros (ou em metros) faria esta função multiplicar o
 * estoque por dez, ou dividir por dez, sem nenhum sinal. Por isso a correção
 * não é aplicada às cegas: primeiro deduz-se a densidade IMPLÍCITA no par
 * (peso, comprimento) que a própria nuvem mandou, e ela só é aceita se cair na
 * faixa em que densidade de filamento existe. Fora da faixa, o par não fecha —
 * e a função devolve o peso da nuvem intocado, com o motivo escrito.
 *
 * É o mesmo desenho do resto do módulo: **na dúvida, não inventa**.
 */

/** Raio do filamento de 1,75 mm, em centímetros. */
export const RAIO_FILAMENTO_CM = 0.0875;

/** Seção transversal do filamento de 1,75 mm, em cm². */
export const AREA_FILAMENTO_CM2 = Math.PI * RAIO_FILAMENTO_CM * RAIO_FILAMENTO_CM;

/**
 * Faixa em que densidade de filamento de impressão existe, em g/cm³.
 *
 * O mais leve em uso comum é o PP (~0,89) e o mais pesado são os carregados de
 * metal (~2,4). A faixa é generosa de propósito: ela não está aqui para julgar
 * o material, e sim para pegar erro de UNIDADE — comprimento em milímetros
 * implica densidade ~0,12, em metros implica ~12, e os dois ficam de fora com
 * uma ordem de grandeza de folga.
 */
export const DENSIDADE_MIN = 0.8;
export const DENSIDADE_MAX = 2.5;

/** Abaixo disso, perfil e rolo são a mesma densidade e não há o que corrigir. */
const TOLERANCIA_RELATIVA = 0.005;

function arredondar(valor: number, casas: number): number {
	const f = 10 ** casas;
	return Math.round(valor * f) / f;
}

/** Volume de filamento, em cm³, para um comprimento em cm. */
export function volumeDeFilamentoCm3(comprimentoCm: number): number {
	return comprimentoCm * AREA_FILAMENTO_CM2;
}

/**
 * A densidade que o fatiador usou, deduzida do par (peso, comprimento) que a
 * nuvem mandou. `null` quando algum dos dois não serve.
 */
export function densidadeImplicita(gramas: number, comprimentoCm: number): number | null {
	if (!Number.isFinite(gramas) || gramas <= 0) return null;
	if (!Number.isFinite(comprimentoCm) || comprimentoCm <= 0) return null;
	const volume = volumeDeFilamentoCm3(comprimentoCm);
	if (volume <= 0) return null;
	return gramas / volume;
}

export type MassaCorrigida =
	| {
			aplicado: true;
			gramas: number;
			densidadePerfil: number;
			densidadeRolo: number;
			/** Positivo quando o rolo é mais denso que o perfil (o peso sobe). */
			deltaG: number;
	  }
	| { aplicado: false; gramas: number; motivo: string; densidadePerfil: number | null };

/**
 * Reescreve o peso da tarefa usando a densidade do rolo no lugar da densidade
 * do perfil de fatiamento — quando, e só quando, os números fecham.
 */
export function massaPelaDensidade(entrada: {
	gramasNuvem: number;
	comprimentoCm: number | null;
	densidadeRolo: number;
}): MassaCorrigida {
	const { gramasNuvem, comprimentoCm, densidadeRolo } = entrada;
	const intacto = (motivo: string, densidadePerfil: number | null = null) => ({
		aplicado: false as const,
		gramas: gramasNuvem,
		motivo,
		densidadePerfil
	});

	if (comprimentoCm === null || !Number.isFinite(comprimentoCm) || comprimentoCm <= 0) {
		return intacto('a nuvem não mandou o comprimento de filamento desta tarefa');
	}
	if (!Number.isFinite(densidadeRolo) || densidadeRolo <= 0) {
		return intacto('o rolo não tem densidade cadastrada');
	}

	const densidadePerfil = densidadeImplicita(gramasNuvem, comprimentoCm);
	if (densidadePerfil === null) {
		return intacto('peso ou comprimento fora do domínio');
	}
	if (densidadePerfil < DENSIDADE_MIN || densidadePerfil > DENSIDADE_MAX) {
		// O par não fecha: ou a unidade do comprimento não é a esperada, ou um
		// dos dois números está corrompido. Nos dois casos, corrigir seria
		// trocar um erro pequeno por um erro de ordem de grandeza.
		return intacto(
			`peso e comprimento não fecham (implicariam densidade de ${arredondar(densidadePerfil, 3)} ` +
				`g/cm³); o peso da nuvem foi mantido`,
			densidadePerfil
		);
	}

	const desvio = Math.abs(densidadePerfil - densidadeRolo) / densidadeRolo;
	if (desvio < TOLERANCIA_RELATIVA) {
		return intacto('o perfil de fatiamento já usou a densidade deste rolo', densidadePerfil);
	}

	const gramas = arredondar(volumeDeFilamentoCm3(comprimentoCm) * densidadeRolo, 2);
	return {
		aplicado: true,
		gramas,
		densidadePerfil: arredondar(densidadePerfil, 3),
		densidadeRolo,
		deltaG: arredondar(gramas - gramasNuvem, 2)
	};
}

/** Comprimento, em cm, que um peso ocuparia numa dada densidade. Usado nos testes e nas fixtures. */
export function comprimentoParaMassaCm(gramas: number, densidade: number): number {
	return gramas / (densidade * AREA_FILAMENTO_CM2);
}

/** A nota que fica na impressão, explicando por que o peso não é o da nuvem. */
export function notaDeMassa(corrigida: MassaCorrigida, gramasNuvem: number): string | null {
	if (!corrigida.aplicado) return null;
	const n = (v: number, casas = 2) =>
		v.toLocaleString('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas });
	return (
		`Peso recalculado pelo comprimento de filamento: a nuvem mandou ${n(gramasNuvem)} g, ` +
		`fatiados com densidade ${n(corrigida.densidadePerfil, 3)} g/cm³, e este rolo tem ` +
		`${n(corrigida.densidadeRolo, 3)} g/cm³ · ${n(corrigida.gramas)} g.`
	);
}
