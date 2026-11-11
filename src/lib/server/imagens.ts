/**
 * Servir a capa de uma impressão.
 *
 * O outro lado de `nuvem/imagem.ts`: lá a capa é baixada e o caminho vai para
 * `impressao.imagemPath`; aqui esse caminho vira arquivo na tela.
 *
 * ⚠️ **O valor do banco é entrada hostil.** Não porque o SQLite seja público —
 * ele não é —, mas porque esta é a única função do sistema que transforma
 * *texto guardado* em *arquivo aberto no disco do host*. Basta uma linha
 * adulterada (SQL na mão, restore de backup de outra máquina, um bug futuro na
 * importação que deixe passar `../`) para `readFile(join(dir, valor))` virar
 * leitura arbitrária. Por isso o caminho NUNCA é concatenado e aberto: ele é
 * resolvido, comparado com a raiz de uploads, resolvido DE NOVO depois dos
 * links simbólicos, e só então aberto.
 *
 * A segunda resolução não é zelo excessivo. `resolve()` trabalha com texto:
 * `uploads/atalho/segredo.png` é textualmente interno, e se `atalho` for um
 * link para fora, o arquivo aberto está fora. Só `realpath` responde onde o
 * arquivo mora de verdade.
 *
 * Nada aqui lança. Todo caminho de erro termina em 404 com HTML — a rota que
 * usa este módulo não pode responder 500 por causa do que está no banco.
 */

import { readFile, realpath, stat } from 'node:fs/promises';
import { isAbsolute, resolve, sep } from 'node:path';
import { DIR_UPLOADS } from './nuvem/imagem';

/**
 * As quatro extensões que `baixarCapa` sabe gravar, e mais nenhuma.
 *
 * SVG está fora de propósito: é documento executável, e servi-lo como
 * `image/svg+xml` do mesmo domínio da aplicação seria XSS entregue de bandeja.
 * A lista também é o que dispensa farejar o conteúdo — o tipo sai daqui, nunca
 * do arquivo.
 */
const TIPO_POR_EXTENSAO: Record<string, string> = {
	png: 'image/png',
	jpg: 'image/jpeg',
	jpeg: 'image/jpeg',
	webp: 'image/webp',
	gif: 'image/gif'
};

/**
 * Um ano, imutável.
 *
 * O arquivo é escrito uma vez, na importação, e nunca reescrito: o nome carrega
 * o `taskId`, e o `taskIdNuvem` é único. A URL é `/impressoes/<id>/imagem`, e
 * `id` é `AUTOINCREMENT` — o SQLite não reaproveita id de linha excluída, então
 * uma URL nunca passa a apontar para outra peça.
 */
const CACHE = 'public, max-age=31536000, immutable';

export type ResolucaoImagem =
	| { ok: true; absoluto: string; tipo: string; bytes: number; mtimeMs: number }
	| { ok: false; motivo: MotivoRecusa };

/**
 * - `sem-imagem`: a impressão não tem capa. É o caso comum, não é erro.
 * - `invalido`: o texto não é um caminho de capa (absoluto, byte nulo,
 *   extensão que a importação não grava).
 * - `fora`: o caminho aponta para fora do diretório de uploads. É o ataque.
 * - `ausente`: caminho legítimo, arquivo não está lá.
 */
export type MotivoRecusa = 'sem-imagem' | 'invalido' | 'fora' | 'ausente';

export interface OpcoesImagem {
	dir?: string;
}

function dentro(raiz: string, alvo: string): boolean {
	return alvo === raiz || alvo.startsWith(raiz.endsWith(sep) ? raiz : raiz + sep);
}

export async function resolverImagem(
	relativo: string | null | undefined,
	opcoes: OpcoesImagem = {}
): Promise<ResolucaoImagem> {
	const bruto = (relativo ?? '').trim();
	if (!bruto) return { ok: false, motivo: 'sem-imagem' };

	// Byte nulo: o Node joga `ERR_INVALID_ARG_VALUE` ao ver um em caminho, e o
	// throw viraria 500. Barrado aqui, vira 404 como qualquer outro lixo.
	if (bruto.includes('\0')) return { ok: false, motivo: 'invalido' };

	// Barra invertida nunca aparece num caminho gravado por `baixarCapa`. No
	// Linux ela seria só um nome de arquivo esquisito; recusar mantém a regra
	// idêntica em qualquer sistema, em vez de depender de qual é o `sep`.
	if (bruto.includes('\\')) return { ok: false, motivo: 'invalido' };

	// Caminho absoluto e prefixo de unidade do Windows: `join` os respeitaria, e
	// o arquivo aberto não teria relação nenhuma com o diretório de uploads.
	if (isAbsolute(bruto) || /^[A-Za-z]:/.test(bruto)) return { ok: false, motivo: 'invalido' };

	const raiz = resolve(opcoes.dir ?? DIR_UPLOADS);
	const alvo = resolve(raiz, bruto);
	// A comparação é o coração da defesa, e vem ANTES de qualquer toque no
	// disco: `../../etc/passwd` nem chega a ser aberto para saber se existe.
	if (!dentro(raiz, alvo)) return { ok: false, motivo: 'fora' };

	const ext = bruto.toLowerCase().match(/\.([a-z0-9]+)$/);
	const tipo = ext ? TIPO_POR_EXTENSAO[ext[1]] : undefined;
	if (!tipo) return { ok: false, motivo: 'invalido' };

	try {
		// Depois dos links simbólicos: onde o arquivo mora DE VERDADE.
		const real = await realpath(alvo);
		const raizReal = await realpath(raiz);
		if (!dentro(raizReal, real)) return { ok: false, motivo: 'fora' };

		const info = await stat(real);
		// Diretório, socket, FIFO: um `readFile` num FIFO pendura a requisição
		// para sempre. Só arquivo comum passa.
		if (!info.isFile()) return { ok: false, motivo: 'invalido' };

		return { ok: true, absoluto: real, tipo, bytes: info.size, mtimeMs: info.mtimeMs };
	} catch {
		// ENOENT (arquivo sumiu, volume novo, restore parcial), EACCES, ELOOP:
		// nenhum deles é motivo para derrubar a página.
		return { ok: false, motivo: 'ausente' };
	}
}

/** 404 legível no navegador. O caminho recusado NÃO é ecoado: eco é injeção. */
function recusa(motivo: MotivoRecusa): Response {
	const explicacao =
		motivo === 'sem-imagem'
			? 'Esta impressão não tem imagem guardada.'
			: motivo === 'ausente'
				? 'O arquivo da imagem não está mais no disco.'
				: 'O caminho guardado não é uma imagem servível.';

	const html = `<!doctype html>
<meta charset="utf-8">
<title>Carretel · imagem não encontrada</title>
<body style="margin:0;padding:32px;background:#0e0e11;color:#e8e8ea;font:14px/20px ui-sans-serif,system-ui,sans-serif">
<h1 style="font-size:16px;margin:0 0 8px">Imagem não encontrada</h1>
<p style="margin:0;color:#8a8a90">${explicacao}</p>
</body>`;

	return new Response(html, {
		status: 404,
		headers: {
			'content-type': 'text/html; charset=utf-8',
			// Sem cache no erro: a capa pode ser recuperada depois pela tela de
			// importação, e um 404 congelado por um ano deixaria a imagem
			// invisível mesmo já estando no disco.
			'cache-control': 'no-store'
		}
	});
}

export interface OpcoesResposta extends OpcoesImagem {
	/** Cabeçalho `If-None-Match` da requisição, quando houver. */
	ifNoneMatch?: string | null;
	/**
	 * `Cache-Control` do sucesso. O padrão (um ano, imutável) vale para as capas,
	 * que nunca são reescritas. Quem serve arquivo que PODE ser trocado sob o
	 * mesmo nome (a imagem local do catálogo) passa um prazo curto e deixa o
	 * ETag fazer a revalidação.
	 */
	cache?: string;
}

/** `"1234-1700000000000"` — tamanho e mtime bastam: o arquivo nunca é reescrito. */
function etagDe(bytes: number, mtimeMs: number): string {
	return `"${bytes.toString(36)}-${Math.trunc(mtimeMs).toString(36)}"`;
}

function jaTem(ifNoneMatch: string | null | undefined, etag: string): boolean {
	if (!ifNoneMatch) return false;
	return ifNoneMatch
		.split(',')
		.map((e) => e.trim().replace(/^W\//, ''))
		.some((e) => e === etag || e === '*');
}

/**
 * A resposta inteira, pronta para a rota devolver.
 *
 * Vive aqui, e não no `+server.ts`, para ser testável sem subir o SvelteKit e
 * sem abrir o banco — os casos que importam (traversal, link simbólico, byte
 * nulo, arquivo ausente) são todos exercitáveis com um diretório temporário.
 */
export async function montarRespostaImagem(
	relativo: string | null | undefined,
	opcoes: OpcoesResposta = {}
): Promise<Response> {
	try {
		const r = await resolverImagem(relativo, opcoes);
		if (!r.ok) return recusa(r.motivo);

		const etag = etagDe(r.bytes, r.mtimeMs);
		const cabecalho = {
			'content-type': r.tipo,
			'cache-control': opcoes.cache ?? CACHE,
			etag,
			// Os bytes vêm de um S3 de terceiro. `nosniff` impede que o navegador
			// decida sozinho que aquilo ali é HTML.
			'x-content-type-options': 'nosniff',
			'content-disposition': 'inline'
		};

		if (jaTem(opcoes.ifNoneMatch, etag)) {
			return new Response(null, { status: 304, headers: cabecalho });
		}

		// Leitura inteira em memória, não stream: o teto por arquivo é 2 MB (ver
		// `nuvem/imagem.ts`) e a capa real tem ~15 KB. Um stream traria caminhos
		// de erro no meio da resposta, que é exatamente o que não pode existir
		// aqui — depois do primeiro byte não dá mais para responder 404.
		const bytes = await readFile(r.absoluto);
		return new Response(new Uint8Array(bytes), { status: 200, headers: cabecalho });
	} catch {
		// Rede de segurança: qualquer coisa inesperada vira 404, nunca 500.
		return recusa('ausente');
	}
}
