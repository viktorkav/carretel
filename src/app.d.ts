// See https://svelte.dev/docs/kit/types#app.d.ts
// for information about these interfaces
declare global {
	namespace App {
		// interface Error {}
		// interface Locals {}
		// interface PageData {}
		interface PageState {
			/**
			 * Uma correção acabou de ser salva nesta entrada do histórico: a tela
			 * saiu do modo de edição e ainda precisa dizer que salvou. Ver `$lib/edicao`.
			 */
			correcaoSalva?: { recalculadas: number };
		}
		// interface Platform {}
	}
}

export {};
