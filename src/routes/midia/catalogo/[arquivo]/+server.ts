/**
 * Imagem de catálogo guardada na própria instalação (ver
 * `$lib/catalogo/imagem-local` para o contrato).
 *
 * A única coisa que o visitante escolhe é UM nome de arquivo, e ele só chega
 * ao disco depois de casar com a lista estreita do contrato. Daí em diante o
 * caminho é o mesmo das capas: `$lib/server/imagens` confere a raiz de uploads
 * antes e depois dos links simbólicos, abre só arquivo comum e decide o tipo
 * pela extensão. Nada aqui responde 500.
 *
 * O prazo de cache é curto (um dia) porque, ao contrário de uma capa, este
 * arquivo pode ser trocado por outro com o mesmo nome; o ETag revalida.
 */
import { arquivoDeImagemLocal } from '$lib/catalogo/imagem-local';
import { montarRespostaImagem } from '$lib/server/imagens';
import type { RequestHandler } from './$types';

const PASTA = 'catalogo';
const CACHE = 'public, max-age=86400';

function naoEncontrada(): Response {
	return new Response('Imagem não encontrada.', {
		status: 404,
		headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' }
	});
}

export const GET: RequestHandler = async ({ params, request }) => {
	const arquivo = arquivoDeImagemLocal(params.arquivo);
	if (!arquivo) return naoEncontrada();
	return montarRespostaImagem(`${PASTA}/${arquivo}`, {
		ifNoneMatch: request.headers.get('if-none-match'),
		cache: CACHE
	});
};
