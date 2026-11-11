/**
 * O erro de validação que uma action devolveu, amarrado ao campo que o causou.
 *
 * Antes, a mensagem saía do servidor sozinha e a tela a pendurava no topo — no
 * formulário de impressão isso são 1.400 px acima do campo errado, e no celular
 * é uma tela inteira de distância. Carregar a CHAVE do campo junto é o que
 * permite três coisas ao mesmo tempo: `aria-invalid` no controle certo (a Mesa
 * já estiliza, o Carretel não usava), a mensagem repetida ao lado dele, e o
 * valor digitado de volta no `value`.
 */
export interface ErroDeCampo {
	/** O `name` do campo, ex.: `pesoInicial`. */
	campo: string;
	mensagem: string;
}

/**
 * Monta o `ErroDeCampo` a partir do que a action devolveu, ou `null`.
 *
 * Um `fail` sem `campo` (erro que não é de um controle específico — "rolo não
 * encontrado", falha da nuvem) continua válido: ele aparece no topo do
 * formulário e nenhum campo é marcado. Marcar um campo ao acaso seria pior do
 * que não marcar nenhum.
 */
export function erroDeCampo(form: unknown): ErroDeCampo | null {
	if (!form || typeof form !== 'object') return null;
	const f = form as { erro?: unknown; campo?: unknown };
	if (typeof f.erro !== 'string' || typeof f.campo !== 'string' || !f.campo) return null;
	return { campo: f.campo, mensagem: f.erro };
}
