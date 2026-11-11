/**
 * Converte o texto de duração digitado no formulário em segundos.
 *
 * Formatos aceitos:
 * - Horas decimais com sufixo "h": "3.6h", "0.5h" (aceita "H" maiúsculo).
 * - hh:mm: "3:36", "0:45". Minutos precisam estar em 0-59 e só pode haver um
 *   ":" — "1:75" e "1:2:3" são rejeitados (viram 0) em vez de interpretados
 *   em silêncio, porque são erro de digitação plausível, não duração real.
 * - Número puro, interpretado como minutos: "215".
 *
 * Vírgula é aceita como separador decimal, equivalente ao ponto — decisão
 * documentada aqui porque o brief só previa ponto: "3,6h" produz o mesmo
 * resultado que "3.6h". Diferente de `textoParaCentavos` (dinheiro.ts), não
 * há ambiguidade de separador de milhar a resolver, então a troca direta
 * vírgula→ponto é suficiente.
 *
 * Espaços ao redor do texto inteiro, entre o número e o "h", ou ao redor do
 * ":" em hh:mm são tolerados.
 *
 * Nunca retorna NaN nem negativo: entrada vazia, não numérica ou negativa
 * vira 0. A duração alimenta energia, depreciação e horímetro da
 * impressora — um valor inválido aqui contamina três cálculos a jusante.
 */
export function duracaoParaSegundos(textoBruto: string): number {
	return duracaoEmSegundos(textoBruto) ?? 0;
}

/**
 * O MESMO parser, sem a saturação em zero: devolve `null` onde
 * `duracaoParaSegundos` devolveria 0 por não ter entendido o texto (vazio,
 * malformado, negativo), e 0 só quando o texto realmente diz zero.
 *
 * Existe porque o registro e a edição querem coisas diferentes do mesmo campo.
 * No registro, duração em branco vira 0 e segue — é um dado que se preenche
 * depois. Numa edição, 0 silencioso zera energia e depreciação, tira a
 * impressão do horímetro da máquina e, com "Recalcular" marcado, reescreve
 * custo congelado a partir de um número que ninguém digitou. Lá a diferença
 * entre "não entendi" e "é zero mesmo" precisa existir — e precisa existir
 * aqui, num parser só, não numa segunda leitura do formato.
 */
export function duracaoEmSegundos(textoBruto: string): number | null {
	const bruto = String(textoBruto ?? '').trim();
	if (!bruto) return null;

	const texto = bruto.replace(',', '.');

	if (/h$/i.test(texto)) {
		const horas = Number(texto.slice(0, -1).trim());
		if (!Number.isFinite(horas) || horas < 0) return null;
		return Math.round(horas * 3600);
	}

	if (texto.includes(':')) {
		const partes = texto.split(':');
		// Mais de um ":" ("1:2:3") é formato malformado, não hh:mm — rejeita
		// em vez de descartar o terceiro segmento em silêncio.
		if (partes.length !== 2) return null;

		const [horaTexto, minutoTexto] = partes;
		const horasBrutas = Number(horaTexto.trim());
		const minutosBrutos = Number(minutoTexto.trim());
		const horas = Number.isFinite(horasBrutas) ? horasBrutas : 0;
		const minutos = Number.isFinite(minutosBrutos) ? minutosBrutos : 0;
		// Minutos fora de 0-59 são erro de digitação plausível ("1:75"), não
		// uma duração válida — rejeita em vez de deixar virar 2h15 silenciosamente.
		if (horas < 0 || minutos < 0 || minutos >= 60) return null;
		return Math.round(horas * 3600 + minutos * 60);
	}

	const minutos = Number(texto);
	if (!Number.isFinite(minutos) || minutos < 0) return null;
	return Math.round(minutos * 60);
}
