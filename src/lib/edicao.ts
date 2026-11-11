import { goto } from '$app/navigation';
import type { SubmitFunction } from '@sveltejs/kit';

/**
 * Salvar uma correção e SAIR do modo de edição.
 *
 * As telas de edição (uma impressão, uma impressora, um filamento) são um
 * passo revelado pela URL (`?editar`). Sem JavaScript, o envio responde em
 * `?/editar` e a tela já volta fora da edição, com o aviso de que salvou. Com
 * JavaScript o padrão do `use:enhance` fazia outra coisa: mantinha a URL em
 * `?editar` e reiniciava o formulário, e o que a pessoa via depois de salvar
 * era a edição ainda aberta com os campos em branco.
 *
 * Aqui os dois caminhos passam a terminar no mesmo lugar. O formulário não é
 * reiniciado (uma recusa conserva o que foi digitado) e, quando o servidor
 * confirma, a tela navega para `destino` — a mesma rota sem `?editar` —
 * levando o aviso no estado da navegação, que é onde ele pertence: vale para
 * essa entrada do histórico e some na próxima.
 */
export function salvarESair(destino: () => string): SubmitFunction {
	return () =>
		async ({ result, update }) => {
			await update({ reset: false });
			if (result.type !== 'success') return;
			const dados = (result.data ?? {}) as { recalculadas?: number };
			await goto(destino(), {
				replaceState: true,
				state: { correcaoSalva: { recalculadas: dados.recalculadas ?? 0 } }
			});
		};
}

/** Enviar sem reiniciar o formulário: os campos continuam mostrando o que foi salvo. */
export const manterCampos: SubmitFunction = () => async ({ update }) => {
	await update({ reset: false });
};
