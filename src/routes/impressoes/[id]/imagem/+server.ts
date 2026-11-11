/**
 * A capa de uma impressão, servida do volume de uploads.
 *
 * A URL é `/impressoes/<id>/imagem` — o **id da impressão**, nunca o caminho do
 * arquivo. Isso não é cosmético: o caminho no disco não aparece no HTML, não
 * aparece no histórico do navegador e não é digitável por ninguém. A única
 * coisa que o cliente escolhe é um número inteiro.
 *
 * A defesa contra path traversal mora em `$lib/server/imagens` e está toda
 * testada lá. Aqui em cima ficam só as duas amarras desta camada: id que não é
 * inteiro positivo nunca chega ao banco, e nada — nem uma falha do SQLite —
 * escapa como 500.
 */

import { eq } from 'drizzle-orm';
import { db, schema } from '$lib/server/db';
import { montarRespostaImagem } from '$lib/server/imagens';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ params, request }) => {
	const ifNoneMatch = request.headers.get('if-none-match');

	// `/impressoes/..%2F..%2Fetc%2Fpasswd/imagem` chega aqui como
	// `params.id = '../../etc/passwd'`: vira NaN e morre nesta linha, antes de
	// qualquer consulta. `null` no lugar do caminho devolve o mesmo 404 em HTML
	// que uma impressão sem capa — a rota não conta ao visitante se o id existe.
	const id = Number(params.id);
	if (!Number.isInteger(id) || id <= 0) return montarRespostaImagem(null, { ifNoneMatch });

	let imagemPath: string | null = null;
	try {
		const linha = db
			.select({ imagemPath: schema.impressao.imagemPath })
			.from(schema.impressao)
			.where(eq(schema.impressao.id, id))
			.get();
		imagemPath = linha?.imagemPath ?? null;
	} catch {
		// Banco travado, arquivo corrompido: 404 em HTML, nunca 500.
		imagemPath = null;
	}

	return montarRespostaImagem(imagemPath, { ifNoneMatch });
};
