import adapter from '@sveltejs/adapter-node';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vitest/config';

export default defineConfig({
	plugins: [
		sveltekit({
			// Serviço single-user, sem autenticação, em rede privada (LAN +
			// Tailscale). O dono do projeto acessa pelo IP da LAN, pelo hostname
			// do tailnet e pelo nome curto da máquina — e o `ORIGIN` fixo do
			// adapter-node só casa com UM desses, então pelos outros TODO POST de
			// formulário voltava 403 ("Cross-site POST form submissions are
			// forbidden"): dava pra navegar e não dava pra salvar nada.
			//
			// `trustedOrigins: ['*']` desliga a checagem de origem. É aceitável
			// aqui porque não há sessão, cookie nem credencial para um site
			// terceiro sequestrar — quem já está na rede privada tem acesso total
			// ao serviço de qualquer jeito, sem precisar de CSRF. Se um dia isso
			// ganhar login ou sair da rede privada, esta linha volta.
			csrf: { trustedOrigins: ['*'] },

			compilerOptions: {
				// Force runes mode for the project, except for libraries. Can be removed in svelte 6.
				runes: ({ filename }) =>
					filename.split(/[/\\]/).includes('node_modules') ? undefined : true
			},

			// O Carretel roda em container Node no ZimaCube — adapter fixo, sem auto-detecção.
			// See https://svelte.dev/docs/kit/adapters for more information about adapters.
			adapter: adapter()
		})
	],
	test: {
		// `scripts/**` entrou aqui pelo seed da prancha (`scripts/semear-prancha.test.ts`):
		// sem o padrão, o vitest não descobre teste nenhum fora de `src/`.
		include: ['src/**/*.test.ts', 'scripts/**/*.test.ts']
	}
});
