/**
 * Download da capa da tarefa.
 *
 * `cover` vem como URL S3 **pré-assinada, com validade de uma hora**. Guardar a
 * URL não serve para nada: no dia seguinte ela responde 403. Por isso o arquivo
 * é baixado no instante da importação, e é o caminho local que vai para
 * `impressao.imagemPath`.
 *
 * A imagem é anexo, não fonte de dado (a spec é explícita: nada é extraído
 * dela). Logo, **nenhuma falha aqui pode interromper a importação** — tudo que
 * dá errado vira `null` e a impressão entra sem imagem.
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

/** Volume `carretel-uploads` do compose. */
export const DIR_UPLOADS = process.env.UPLOADS_PATH ?? 'uploads';

/** Teto por arquivo. O host já teve disco cheio uma vez; capa de peça é miniatura. */
const MAX_BYTES = 2_000_000;

/** Teto por download. Sem ele, uma capa lenta pendura a action inteira. */
const TIMEOUT_MS = 10_000;

/**
 * Downloads simultâneos. Importar o histórico de uma vez são dezenas de capas;
 * disparar todas juntas num mini-PC com um processo Node só é a diferença
 * entre uma importação que termina e uma que engasga.
 */
const CONCORRENCIA = 4;

const EXTENSAO_POR_TIPO: Record<string, string> = {
	'image/png': 'png',
	'image/jpeg': 'jpg',
	'image/jpg': 'jpg',
	'image/webp': 'webp',
	'image/gif': 'gif'
};

export interface OpcoesCapa {
	dir?: string;
	fetch?: typeof fetch;
	maxBytes?: number;
	timeoutMs?: number;
}

function extensaoDe(url: string, contentType: string | null): string {
	const daUrl = url.split('?')[0].match(/\.(png|jpe?g|webp|gif)$/i);
	if (daUrl) return daUrl[1].toLowerCase() === 'jpeg' ? 'jpg' : daUrl[1].toLowerCase();
	const tipo = (contentType ?? '').split(';')[0].trim().toLowerCase();
	return EXTENSAO_POR_TIPO[tipo] ?? 'png';
}

export async function baixarCapa(
	url: string | null,
	taskId: string,
	opcoes: OpcoesCapa = {}
): Promise<string | null> {
	if (!url) return null;

	const fetchFn = opcoes.fetch ?? fetch;
	const dir = opcoes.dir ?? DIR_UPLOADS;
	const maxBytes = opcoes.maxBytes ?? MAX_BYTES;

	// O taskId vem da rede: qualquer coisa fora de dígito e letra sai fora, para
	// que ele não possa montar caminho ("../../") nem nome de arquivo esquisito.
	const nome = taskId.replace(/[^A-Za-z0-9_-]/g, '');
	if (!nome) return null;

	try {
		const alvo = new URL(url);
		if (alvo.protocol !== 'https:' && alvo.protocol !== 'http:') return null;

		const resposta = await fetchFn(url, {
			signal: AbortSignal.timeout(opcoes.timeoutMs ?? TIMEOUT_MS)
		});
		if (!resposta.ok) return null;

		const declarado = Number(resposta.headers.get('content-length') ?? NaN);
		if (Number.isFinite(declarado) && declarado > maxBytes) return null;

		const bytes = new Uint8Array(await resposta.arrayBuffer());
		if (bytes.byteLength > maxBytes) return null;

		const relativo = join('nuvem', `${nome}.${extensaoDe(url, resposta.headers.get('content-type'))}`);
		const absoluto = join(dir, relativo);
		await mkdir(dirname(absoluto), { recursive: true });
		await writeFile(absoluto, bytes);
		return relativo;
	} catch {
		// Rede caiu, URL expirou, disco cheio, permissão negada: em todos os
		// casos a impressão entra sem imagem, que é infinitamente melhor do que
		// perder a importação inteira por causa de uma miniatura.
		return null;
	}
}

/**
 * Baixa várias capas com teto de simultaneidade.
 *
 * Devolve um mapa `taskId → caminho`, sem as que falharam. Nenhuma exceção
 * escapa: capa é anexo, e importação que morre por causa de miniatura seria
 * trocar o dado que importa pelo enfeite.
 */
export async function baixarCapas(
	itens: { taskId: string; url: string | null }[],
	opcoes: OpcoesCapa & { concorrencia?: number } = {}
): Promise<Map<string, string>> {
	const limite = Math.max(1, opcoes.concorrencia ?? CONCORRENCIA);
	const resultado = new Map<string, string>();
	let proximo = 0;

	async function trabalhador() {
		while (proximo < itens.length) {
			const item = itens[proximo++];
			const caminho = await baixarCapa(item.url, item.taskId, opcoes);
			if (caminho) resultado.set(item.taskId, caminho);
		}
	}

	await Promise.all(Array.from({ length: Math.min(limite, itens.length) }, trabalhador));
	return resultado;
}
