/**
 * ENCERRAR UM ROLO — as duas situações, e por que elas cabem nos dois status
 * que já existiam.
 *
 * O pedido do dono foi uma frase só: *"faltou um botão pra dar o rolo como
 * finalizado. Porque, por exemplo, o rolo branco que eu cadastrei lá são os
 * 20 g que vem pra teste da A1. Então eu imprimi o teste e sobrou muito pouco,
 * não acho que eu ainda vá usar pra algo."*
 *
 * Dentro dela moram duas coisas diferentes:
 *
 * - **Acabou** — o filamento terminou. Sobra zero, ou os poucos gramas que não
 *   dá para puxar do carretel. É um fato sobre o material.
 * - **Encerrado com sobra** — ainda tem material, e ele não vai mais ser usado.
 *   É uma decisão do dono, e é o caso da amostra de 20 g.
 *
 * **Os dois status existentes bastam, e a distinção que eles já faziam é
 * exatamente esta.** `vazio` afirma que não há filamento; `descartado` afirma
 * que o rolo saiu de circulação — sem dizer nada sobre o que sobrou nele. As
 * palavras já estavam certas: o que faltava era caminho para chegar nelas pela
 * interface, e um lugar que dissesse qual delas é qual.
 *
 * Um terceiro status seria uma coluna nova para guardar uma informação que a
 * escolha entre os dois já guarda — e o resto do sistema (importação da nuvem,
 * formulário de nova impressão) trata os dois exatamente igual, porque para ele
 * a pergunta é uma só: "este rolo ainda imprime?".
 */

export type StatusRolo = 'fechado' | 'aberto' | 'vazio' | 'descartado';

/** As duas situações, na palavra do domínio. */
export type MotivoEncerramento = 'acabou' | 'sobra';

const MOTIVOS: Record<MotivoEncerramento, 'vazio' | 'descartado'> = {
	acabou: 'vazio',
	sobra: 'descartado'
};

export function statusDoMotivo(motivo: MotivoEncerramento): 'vazio' | 'descartado' {
	return MOTIVOS[motivo];
}

export function motivoDoStatus(status: StatusRolo): MotivoEncerramento | null {
	if (status === 'vazio') return 'acabou';
	if (status === 'descartado') return 'sobra';
	return null;
}

/** Rolo fora de circulação: não imprime, não alerta, não é sugerido. */
export function estaEncerrado(status: StatusRolo): boolean {
	return motivoDoStatus(status) !== null;
}

/**
 * Lê o motivo escolhido no formulário. **Sem padrão de propósito**: motivo
 * ausente caindo em "acabou" gravaria "não sobrou nada" num rolo com 800 g, e a
 * diferença entre os dois motivos é justamente a informação que esta tela
 * existe para registrar.
 *
 * O nome do STATUS também não é aceito: quem manda `motivo=vazio` está falando
 * a língua do banco, não a da tela, e deixar isso passar criaria uma segunda
 * gramática para a mesma escolha.
 */
export function lerMotivo(bruto: FormDataEntryValue | null): MotivoEncerramento | null {
	const texto = String(bruto ?? '').trim();
	return texto === 'acabou' || texto === 'sobra' ? texto : null;
}

/**
 * O que a tela ESCREVE mora em `$lib/formato` (`STATUS_ROLO`), e não aqui: este
 * módulo é `$lib/server` e não pode ser importado por componente nenhum. Dois
 * mapas de rótulo é exatamente o que o docblock de `formato.ts` proíbe.
 */

/** Observação que marca a aferição nascida de um encerramento. */
export const OBSERVACAO_PESAGEM_FINAL = 'pesagem final';

/**
 * Abaixo deste peso inicial a comparação estimativa × realidade é ruído.
 *
 * Não é um número mágico: é o tamanho a partir do qual o erro da balança (±1 g)
 * e a purga do bico deixam de dominar o resultado. Com os 20 g da amostra da A1,
 * 6 g de diferença são 30% do rolo e não dizem nada sobre o fatiador; num rolo
 * de 1 kg, 6 g são 0,6% e dizem tudo.
 */
export const PESO_RELEVANTE_G = 100;

export interface Rendimento {
	/** Quanto o sistema achava que sobrava, um instante antes da pesagem final. */
	estimadaG: number;
	/** Quanto sobrou de verdade, na balança. */
	realG: number;
	/** `real − estimada`: negativo, o rolo rendeu menos do que o fatiador dizia. */
	diferencaG: number;
	/** A diferença em fração do rolo inteiro — é ela que se compara entre rolos. */
	fracaoDoRolo: number;
	sentido: 'a-mais' | 'a-menos' | 'bateu';
	/** Falso em rolo de amostra: o número existe, mas não corrige confiança nenhuma. */
	relevante: boolean;
}

/**
 * A pergunta que o sistema não respondia: **quanto o rolo rendeu na prática,
 * contra o que a estimativa do fatiador dizia**.
 *
 * Toda impressão desconta do estoque as gramas que o slicer estimou. Purga,
 * abortos e a própria variação de diâmetro do filamento acumulam erro nesse
 * número, e sem uma pesagem final não há como saber para que lado ele erra.
 * Encerrar um rolo é a única hora em que as duas contas se encontram no mesmo
 * carretel.
 */
export function compararSobra(p: {
	estimadaG: number;
	realG: number;
	pesoInicialG: number;
}): Rendimento {
	// Uma casa decimal, como `calcularRestante` — para os dois lados da conta
	// terem a mesma resolução e a diferença não nascer de arredondamento.
	const diferencaG = Math.round((p.realG - p.estimadaG) * 10) / 10;
	const fracaoDoRolo = p.pesoInicialG > 0 ? Math.abs(diferencaG) / p.pesoInicialG : 0;

	return {
		estimadaG: p.estimadaG,
		realG: p.realG,
		diferencaG,
		fracaoDoRolo,
		sentido: diferencaG === 0 ? 'bateu' : diferencaG > 0 ? 'a-mais' : 'a-menos',
		relevante: p.pesoInicialG >= PESO_RELEVANTE_G
	};
}
