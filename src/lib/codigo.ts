/**
 * O código que o dono escreve no carretel com caneta.
 *
 * Depois da fusão, cada compra é um registro novo — dois rolos iguais são duas
 * linhas independentes. Isso resolve o histórico de preço e cria um problema
 * físico: na prateleira os dois carretéis são idênticos, e o `#7` do banco não
 * está escrito em lugar nenhum. O código existe para que o objeto na estante
 * tenha o mesmo nome que o registro na tela.
 *
 * **Formato: `MATERIAL-COR-NN`** (ex.: `PLA-PRETO-03`).
 *
 * - `MATERIAL` é a PRIMEIRA palavra do material, até 6 caracteres: "PLA Basic",
 *   "PLA Matte" e "PLA Silk+" viram todos `PLA`. É de propósito — o que se
 *   escreve na caneta é a família, e a ficha técnica completa mora no registro.
 * - `COR` é a primeira palavra da cor, até 8 caracteres.
 * - `NN` é um contador **por prefixo**, de dois dígitos. É ele que carrega o
 *   sentido da mudança: `PLA-PRETO-03` é "o terceiro PLA preto que eu comprei",
 *   não "o PLA preto, terceira versão".
 *
 * Curto porque vai escrito à mão numa superfície curva; sem acento e sem
 * minúscula porque caneta em plástico preto não distingue `õ` de `o`; com
 * hífen porque é o separador que sobrevive a ser lido de longe.
 *
 * Módulo puro de propósito: quem conhece o banco é `$lib/server/repo`.
 */

export const TAMANHO_MATERIAL = 6;
export const TAMANHO_COR = 8;
/** Reservas para quando o campo não tem nenhuma letra ou dígito aproveitável. */
export const RESERVA_MATERIAL = 'ROLO';
export const RESERVA_COR = 'COR';
export const CODIGO_MAX = 24;

export interface TipoDoRolo {
	material: string;
	cor: string;
}

/**
 * Primeira palavra de um texto, sem acento, em caixa alta e truncada.
 *
 * A migração faz esta mesma conta em SQL puro (ver
 * `drizzle/0002_fusao_rolo_filamento.sql`), e o teste da migração confere que
 * as duas concordam. Se você mexer aqui, mexa lá.
 */
export function pedacoDoCodigo(texto: string, tamanho: number, reserva: string): string {
	const semAcento = String(texto ?? '')
		.normalize('NFD')
		.replace(/[\u0300-\u036f]/g, '');
	const palavras = semAcento.toUpperCase().split(/[^A-Z0-9]+/).filter(Boolean);
	const pedaco = (palavras[0] ?? '').slice(0, tamanho);
	return pedaco || reserva;
}

/** `PLA-PRETO` — tudo menos o contador. */
export function prefixoDoCodigo(tipo: TipoDoRolo): string {
	const material = pedacoDoCodigo(tipo.material, TAMANHO_MATERIAL, RESERVA_MATERIAL);
	const cor = pedacoDoCodigo(tipo.cor, TAMANHO_COR, RESERVA_COR);
	return `${material}-${cor}`;
}

/**
 * Dois dígitos até 99 e depois o número cru: `01`, `09`, `10`, `100`.
 *
 * Zero à esquerda porque `PLA-PRETO-3` e `PLA-PRETO-03` lidos na prateleira
 * viram a mesma coisa na cabeça de quem procura, e aí um dos dois some.
 */
export function contador(n: number): string {
	return n < 100 ? String(n).padStart(2, '0') : String(n);
}

/**
 * O próximo código livre para este tipo.
 *
 * `usados` é a lista completa de códigos já gravados — a busca é pelo primeiro
 * buraco, e não por `máximo + 1`, para que apagar o rolo 2 de três não deixe o
 * próximo cadastro colidindo com o 3.
 */
export function proximoCodigo(tipo: TipoDoRolo, usados: Iterable<string>): string {
	const prefixo = prefixoDoCodigo(tipo);
	const ocupados = new Set<string>();
	for (const c of usados) ocupados.add(String(c ?? '').trim().toUpperCase());

	for (let n = 1; ; n++) {
		const candidato = `${prefixo}-${contador(n)}`;
		if (!ocupados.has(candidato)) return candidato;
	}
}

export type CodigoLido = { ok: true; valor: string } | { ok: false; erro: string };

/**
 * Lê o código digitado à mão na edição.
 *
 * Normaliza antes de recusar (caixa alta, espaço vira hífen) porque quem digita
 * `pla preto 03` quis dizer `PLA-PRETO-03`, e recusar isso seria implicância.
 * O que não passa é o que não sobrevive à caneta: acento, símbolo, e um código
 * longo demais para caber no carretel.
 */
export function lerCodigo(bruto: unknown): CodigoLido {
	const texto = String(bruto ?? '')
		.trim()
		.toUpperCase()
		.replace(/\s+/g, '-');

	if (!texto) return { ok: false, erro: 'o código não pode ficar em branco' };
	if (texto.length > CODIGO_MAX) {
		return { ok: false, erro: `o código deve ter no máximo ${CODIGO_MAX} caracteres` };
	}
	if (!/^[A-Z0-9][A-Z0-9-]*$/.test(texto)) {
		return {
			ok: false,
			erro: 'o código aceita só letras sem acento, números e hífen · ex.: PLA-PRETO-03'
		};
	}
	return { ok: true, valor: texto };
}
