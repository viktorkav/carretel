/**
 * O rolo desenhado na tela.
 *
 * A figura do rolo é um render em oito níveis de enrolamento (`static/midia/rolo`),
 * tingido na tela com a cor cadastrada. Este módulo decide QUAL nível mostrar e
 * escreve o peso do jeito curto que vai ao lado dele.
 *
 * A fração que entra aqui é a mesma das barras de antes: massa restante sobre
 * a régua compartilhada (`$lib/regua`, o peso líquido inicial do maior rolo da
 * tela). Assim um rolo de 250 g cheio não aparece tão cheio quanto um de 1 kg
 * cheio — a pergunta que a prateleira responde é "qual acaba primeiro".
 *
 * A figura é ilustração em degraus, não instrumento: o número exato vai sempre
 * escrito ao lado ("640 g de 1 kg").
 */

/** Quanto do carretel cada um dos oito renders mostra enrolado (1 = cheio, 8 = vazio). */
export const ENCHIMENTO_DO_NIVEL = [1, 0.85, 0.7, 0.55, 0.4, 0.25, 0.08, 0] as const;

export type NivelDoRolo = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;

/**
 * O nível mais próximo da fração. Qualquer resto de filamento, por menor que
 * seja, ainda é o nível 7 ("quase vazio"): o carretel vazio (8) fica só para o
 * zero de verdade, porque desenhar vazio um rolo que ainda tem fio seria erro.
 */
export function nivelDoRolo(fracao: number | null | undefined): NivelDoRolo {
	if (fracao == null || !Number.isFinite(fracao) || fracao <= 0) return 8;
	const f = Math.min(1, fracao);
	let melhor = 0;
	for (let n = 1; n < 7; n++) {
		if (Math.abs(ENCHIMENTO_DO_NIVEL[n] - f) < Math.abs(ENCHIMENTO_DO_NIVEL[melhor] - f)) melhor = n;
	}
	return (melhor + 1) as NivelDoRolo;
}

/**
 * Peso por extenso curto: gramas até 999, quilos daí em diante ("1 kg",
 * "1,64 kg"). É o denominador e o total de prateleira; o saldo de um rolo
 * continua sempre em gramas, que é a unidade em que ele é pesado e consumido.
 */
export function pesoCurto(gramas: number): string {
	if (!Number.isFinite(gramas)) return '—';
	if (Math.abs(gramas) >= 1000) {
		return `${(gramas / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 2 })} kg`;
	}
	return `${gramas.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} g`;
}

/** Gramas de saldo: inteiro sem casas, o resto com uma (o saldo é guardado com uma casa). */
export function gramasDeSaldo(gramas: number): string {
	return gramas.toLocaleString('pt-BR', {
		minimumFractionDigits: Number.isInteger(gramas) ? 0 : 1,
		maximumFractionDigits: 1
	});
}
