/**
 * `/filamentos` existia como a tela do TIPO de filamento, separada de `/rolos`.
 * A fusão a eliminou: agora há uma coisa só, e ela mora em `/rolos` — que é
 * onde a lógica de custo e estoque já vivia.
 *
 * A rota continua aqui, redirecionando, e não some, porque foi exatamente para
 * cá que o dono veio procurar o preço do filamento. Um 404 nesse caminho seria
 * a mesma confusão de antes, com outra cara.
 *
 * Leva a query string junto, para que um `?q=petg` guardado continue caindo na
 * busca certa.
 *
 * **302, e não 301, de propósito.** Para o usuário os dois são idênticos. A
 * diferença é o cache: o 301 é permanente e o navegador guarda para sempre.
 * Se a publicação der errado e o plano de reversão for executado (restaurar o
 * backup, voltar para a `main`, redeploy), `/filamentos` volta a ser uma tela
 * de verdade — e o navegador que cacheou o permanente nunca mais chegaria
 * nela, em silêncio. O 302 mantém a reversão possível do lado do cliente, que
 * é o único lugar onde nós não mandamos.
 */
import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ url }) => {
	redirect(302, `/rolos${url.search}`);
};
