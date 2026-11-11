/**
 * A PRÉVIA DO SALDO na conferência do registro de impressão.
 *
 * A regra é do servidor e não muda aqui (`$lib/server/estoque`): o saldo parte
 * da pesagem mais recente e só desconta a impressão cujo início é POSTERIOR a
 * ela. Início anterior ou igual à pesagem não baixa nada. Este módulo existe
 * para a tela dizer a mesma coisa antes de gravar — ou dizer que não sabe.
 *
 * Três respostas, e nunca um palpite:
 * - `baixa`: a impressão entra na conta; `depoisG` é o saldo que o servidor vai
 *   calcular, com as mesmas parcelas e o mesmo arredondamento.
 * - `nao-baixa`: o início informado não é posterior à pesagem; o saldo fica.
 * - `indeterminado`: daqui não dá para afirmar (ver os motivos).
 *
 * ## O fuso
 *
 * O campo de data manda um texto sem fuso ("2026-11-03T10:00") e quem o
 * transforma em instante é o servidor, no fuso DELE. O navegador pode estar em
 * outro. Por isso a conta não usa o relógio do navegador: o servidor descreve
 * a pesagem junto com o próprio deslocamento naquele instante (`fusoMin`), e o
 * texto é lido com esse deslocamento. Longe da pesagem (mais de três horas) o
 * sinal da comparação não depende de horário de verão. Perto dela, só vale se
 * o servidor disser que o deslocamento não muda naquela janela
 * (`fusoEstavel`); numa virada de horário a resposta é `indeterminado`.
 */

/** O que o servidor entrega de cada rolo para a prévia. */
export interface BaseDaPrevia {
	/** De onde o saldo parte: a pesagem mais recente, ou o peso inicial. */
	baseG: number;
	/** O que já foi descontado depois da base. */
	consumidoG: number;
	/** Instante da pesagem mais recente, ou null se o rolo nunca foi pesado. */
	baseEm: number | null;
	/** `getTimezoneOffset()` do servidor no instante da pesagem (minutos). */
	fusoMin: number | null;
	/** O deslocamento do servidor é o mesmo em toda a janela de ±3 h da pesagem. */
	fusoEstavel: boolean;
	/** Relógio do servidor quando a tela foi montada. */
	agoraEm: number;
}

export type Previa =
	| { efeito: 'baixa'; depoisG: number }
	| { efeito: 'nao-baixa' }
	| { efeito: 'indeterminado'; motivo: 'pesagem-futura' | 'virada-de-horario' | 'data-ilegivel' };

/** Janela, em torno da pesagem, em que o deslocamento do servidor precisa ser conhecido. */
export const JANELA_FUSO_MS = 3 * 3_600_000;

/** O arredondamento do saldo: nunca abaixo de zero, uma casa decimal. O mesmo de `calcularRestante`. */
export function saldoArredondado(baseG: number, consumidoG: number): number {
	return Math.max(0, Math.round((baseG - consumidoG) * 10) / 10);
}

/**
 * Monta a descrição da base. Roda NO SERVIDOR: é o fuso do processo que conta,
 * porque é ele que vai interpretar o texto do campo de data.
 */
export function descreverBase(
	parcelas: { baseG: number; consumidoG: number; baseEm: number | null },
	agoraEm: number
): BaseDaPrevia {
	if (parcelas.baseEm === null) return { ...parcelas, fusoMin: null, fusoEstavel: true, agoraEm };
	const fuso = (ms: number) => new Date(ms).getTimezoneOffset();
	const fusoMin = fuso(parcelas.baseEm);
	// Uma virada de horário dentro da janela aparece como deslocamento
	// diferente em algum ponto dela; de hora em hora não escapa nenhuma.
	let fusoEstavel = true;
	for (let d = -JANELA_FUSO_MS; d <= JANELA_FUSO_MS; d += 3_600_000) {
		if (fuso(parcelas.baseEm + d) !== fusoMin) fusoEstavel = false;
	}
	return { ...parcelas, fusoMin, fusoEstavel, agoraEm };
}

const TEXTO_DATA_HORA = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?$/;

/**
 * O instante que o servidor dará ao texto do campo, supondo o deslocamento
 * `fusoMin`. Null quando o texto não é o que um campo `datetime-local` produz
 * ou não é uma data de calendário.
 */
export function instanteNoFuso(texto: string, fusoMin: number): number | null {
	const m = TEXTO_DATA_HORA.exec(texto.trim());
	if (!m) return null;
	const [ano, mes, dia, hora, minuto] = m.slice(1, 6).map(Number);
	const segundo = Number(m[6] ?? 0);
	const milis = Number((m[7] ?? '0').padEnd(3, '0'));
	const utc = Date.UTC(ano, mes - 1, dia, hora, minuto, segundo, milis);
	const conferida = new Date(utc);
	// 31 de fevereiro "vira" março no Date.UTC; um campo de data não produz isso.
	if (conferida.getUTCMonth() !== mes - 1 || conferida.getUTCDate() !== dia) return null;
	if (hora > 23 || minuto > 59 || segundo > 59) return null;
	return utc + fusoMin * 60_000;
}

/**
 * O que esta impressão fará com o saldo do rolo, pela regra do servidor.
 * `inicioTexto` é o valor cru do campo de data; vazio significa "agora".
 */
export function preverSaldo(base: BaseDaPrevia, gramas: number, inicioTexto: string): Previa {
	const baixa = (): Previa => ({
		efeito: 'baixa',
		// Mesma ordem de soma do servidor: o consumo anterior e, por último, esta impressão.
		depoisG: saldoArredondado(base.baseG, base.consumidoG + gramas)
	});

	// Rolo nunca pesado: o corte é "desde sempre", toda impressão conta.
	if (base.baseEm === null || base.fusoMin === null) return baixa();

	const texto = inicioTexto.trim();
	if (!texto) {
		// Em branco, o servidor usa o próprio relógio na hora de gravar, que é
		// depois de a tela ter sido montada. Se a pesagem já tinha passado, conta.
		return base.baseEm < base.agoraEm
			? baixa()
			: { efeito: 'indeterminado', motivo: 'pesagem-futura' };
	}

	const inicio = instanteNoFuso(texto, base.fusoMin);
	if (inicio === null) return { efeito: 'indeterminado', motivo: 'data-ilegivel' };

	const distancia = inicio - base.baseEm;
	if (Math.abs(distancia) <= JANELA_FUSO_MS && !base.fusoEstavel) {
		return { efeito: 'indeterminado', motivo: 'virada-de-horario' };
	}
	return distancia > 0 ? baixa() : { efeito: 'nao-baixa' };
}
