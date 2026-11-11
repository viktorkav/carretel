/**
 * A RÉGUA COMPARTILHADA das barras de estoque.
 *
 * As barras de rolo usavam uma régua cada uma: `6 g de 20 g` desenhava 30% e
 * `391 g de 1000 g` desenhava 39%. Empilhadas, com a mesma cor e o mesmo
 * trilho, o rolo com seis gramas parecia quase tão cheio quanto o de
 * trezentos e noventa e um — e essa é exatamente a tela que existe para
 * responder "qual está acabando".
 *
 * A correção é a mesma que a tela de custo aberto já aplica às parcelas: uma
 * régua só para todas as barras, **declarada** numa cota acima delas. A cota é
 * o que a Mesa exige — e ela também limita a uma por tela, o que decide onde a
 * declaração mora: uma vez, no card de estoque, valendo para todas as barras
 * da página.
 *
 * ## Duas leituras, duas perguntas
 *
 * Percentual e massa absoluta não respondem a mesma coisa:
 *
 * - **"qual acaba primeiro?"** é massa absoluta. Um rolo de amostra com 30% de
 *   20 g acaba antes de um rolo de 1 kg com 39%.
 * - **"quanto sobrou deste rolo?"** é percentual, e é o que importa quando se
 *   olha um rolo sozinho.
 *
 * Por isso a BARRA é massa na régua compartilhada (é ela que compara) e o
 * TEXTO ao lado carrega as duas: `6 g de 20 g · 30%`. Nenhuma das duas
 * leituras some, e a que engana quando empilhada deixa de ser a que desenha.
 */

/**
 * A régua de todos: o maior peso líquido inicial da tela.
 *
 * Peso corrompido (zero, negativo, NaN, infinito) é ignorado em vez de virar a
 * régua — um `Infinity` gravado num cadastro antigo achataria TODAS as barras
 * da página em zero, e um zero como régua daria NaN na largura.
 */
export function reguaCompartilhada(rolos: { pesoLiquidoInicialG: number }[]): number {
	let maior = 0;
	for (const r of rolos) {
		const p = r.pesoLiquidoInicialG;
		if (Number.isFinite(p) && p > maior) maior = p;
	}
	// Piso de 1 g: uma tela sem rolo nenhum (ou só com peso corrompido) não pode
	// devolver zero, porque zero é o denominador de toda barra desta página.
	return maior > 0 ? maior : 1;
}

/** Onde uma massa cai na régua compartilhada, em fração de 0 a 1. */
export function fracaoNaRegua(gramas: number, regua: number): number {
	if (!Number.isFinite(regua) || regua <= 0) return 0;
	if (!Number.isFinite(gramas) || gramas <= 0) return 0;
	return Math.min(1, gramas / regua);
}
