/**
 * Aceita "129,90", "129.90", "1.899", "1.234.567,89" etc. A entrada vem de
 * teclado humano, então precisa tolerar as duas convenções sem perder
 * centavo.
 *
 * Regra (aprovada pelo dono do projeto após a revisão da Task 6): com
 * vírgula presente, ela é sempre o separador decimal e todo ponto é milhar
 * — comportamento original, mantido. Sem vírgula, cada ponto é ambíguo por
 * si só ("129.90" é 129 reais e 90 centavos, mas "1.899" é 1899 reais); o
 * desambiguador é o tamanho do último grupo de dígitos: 3 dígitos depois do
 * último ponto → aquele ponto (e qualquer outro antes dele) é milhar; 1 ou 2
 * dígitos → o último ponto é decimal e os anteriores são milhar.
 *
 * Devolve `null` (em vez de um número) quando o texto, depois de limpo, não
 * é um número válido — usado por `textoParaCentavosPositivo` pra diferenciar
 * "não é número" de "é número negativo/zero" sem duplicar a lógica de
 * desambiguação do separador.
 */
function normalizarValorMonetario(texto: string): number | null {
	const limpo = texto.trim();
	if (!limpo) return null;

	let normalizado: string;
	if (limpo.includes(',')) {
		normalizado = limpo.replace(/\./g, '').replace(',', '.');
	} else if (limpo.includes('.')) {
		const partes = limpo.split('.');
		const ultimoGrupo = partes[partes.length - 1];

		if (ultimoGrupo.length === 3) {
			// "1.899" e "1.234.567": todo ponto é milhar, não há decimal.
			normalizado = partes.join('');
		} else if (ultimoGrupo.length === 1 || ultimoGrupo.length === 2) {
			// "129.90" e "129.9": só o último ponto é decimal.
			normalizado = partes.slice(0, -1).join('') + '.' + ultimoGrupo;
		} else {
			// Grupo final de tamanho ambíguo (nem milhar nem decimal): inválido.
			return null;
		}
	} else {
		normalizado = limpo;
	}

	// `Number.isFinite`, e não `Number.isNaN`: "1e999" não é NaN, é Infinity, e
	// Infinity atravessava tudo que só olhava NaN e o sinal. Gravado, ele vira
	// "R$ Infinity,undefined" na tela, desarma comparações (`Infinity < pico` é
	// falso, então nenhuma trava de faixa dispara) e, num recálculo, `sanitizar`
	// o converte em zero — custo zerado em lote a partir de um campo que
	// ninguém conferiu.
	const valor = Number(normalizado);
	return Number.isFinite(valor) ? valor : null;
}

export function textoParaCentavos(texto: string): number {
	const valor = normalizarValorMonetario(texto);
	if (valor === null || valor < 0) return 0;
	return Math.round(valor * 100);
}

/**
 * Variante estrita pra campos que ATUALIZAM um valor monetário global (ex.:
 * tarifa de energia em `config`) em vez de criar um registro novo. Um preço
 * zerado num cadastro (rolo, impressora) afeta só aquele registro; um zero
 * acidental aqui contamina retroativamente todo cálculo de custo futuro, e o
 * sintoma é silencioso — o custo continua aparecendo normalmente, só que
 * errado. Por isso texto vazio, não numérico, negativo E zero devolvem
 * `null` (peça o chamador pra preservar o valor atual em vez de gravar);
 * `textoParaCentavos` continua saturando esses casos em `0`, que é o
 * comportamento certo pra um cadastro novo.
 */
export function textoParaCentavosPositivo(texto: string): number | null {
	const valor = normalizarValorMonetario(texto);
	if (valor === null || valor <= 0) return null;
	return Math.round(valor * 100);
}

/**
 * Variante para EDIÇÃO de preço de cadastro: devolve `null` para tudo que não é
 * um valor monetário (vazio, lixo, negativo, infinito) mas ACEITA zero.
 *
 * Zero precisa passar porque "preço não informado" é gravado como 0 e o
 * formulário de edição volta preenchido com "0,00" — recusar aí impediria de
 * corrigir o nome de uma impressora cujo preço o usuário nunca soube. O que não
 * pode passar é o campo em branco, que é o gesto de um clique que apagaria o
 * preço guardado; isso quem recusa é `campoPrecoObrigatorio`, que distingue
 * "vazio" de "zero digitado" antes de chamar esta função.
 */
export function textoParaCentavosEstrito(texto: string): number | null {
	const valor = normalizarValorMonetario(texto);
	if (valor === null || valor < 0) return null;
	return Math.round(valor * 100);
}

export function centavosParaTexto(cents: number): string {
	return (cents / 100).toFixed(2).replace('.', ',');
}
