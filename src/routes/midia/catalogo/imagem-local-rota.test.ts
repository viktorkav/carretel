/**
 * A rota que serve imagem de catálogo guardada na instalação
 * (`/midia/catalogo/<arquivo>`), exercitada com um volume de uploads de
 * verdade: o que existe é servido, o que não é do contrato não chega ao disco.
 */
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const uploads = mkdtempSync(join(tmpdir(), 'carretel-catalogo-'));
const fora = mkdtempSync(join(tmpdir(), 'carretel-catalogo-fora-'));
process.env.UPLOADS_PATH = uploads;
mkdirSync(join(uploads, 'catalogo'), { recursive: true });
mkdirSync(join(uploads, 'demo'), { recursive: true });
writeFileSync(join(uploads, 'catalogo', 'demo-pla-cinza.webp'), new Uint8Array([1, 2, 3, 4, 5]));
writeFileSync(join(uploads, 'catalogo', 'nota.txt'), 'não é imagem');
writeFileSync(join(uploads, 'demo', 'capa.png'), new Uint8Array([7, 7]));
writeFileSync(join(fora, 'segredo.png'), new Uint8Array([9, 9, 9]));
symlinkSync(join(fora, 'segredo.png'), join(uploads, 'catalogo', 'atalho.png'));

const { GET } = await import('./[arquivo]/+server');

const pedir = (arquivo: string, cabecalhos: Record<string, string> = {}) =>
	GET({
		params: { arquivo },
		request: new Request(`http://localhost/midia/catalogo/${encodeURIComponent(arquivo)}`, { headers: cabecalhos })
	} as never) as Promise<Response>;

describe('GET /midia/catalogo/[arquivo]', () => {
	it('serve o arquivo que está em uploads/catalogo, com o tipo da extensão e cache curto', async () => {
		const r = await pedir('demo-pla-cinza.webp');
		expect(r.status).toBe(200);
		expect(r.headers.get('content-type')).toBe('image/webp');
		expect(r.headers.get('cache-control')).toBe('public, max-age=86400');
		expect(r.headers.get('x-content-type-options')).toBe('nosniff');
		expect(new Uint8Array(await r.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3, 4, 5]));
	});

	it('revalida pelo ETag: o mesmo arquivo volta 304', async () => {
		const primeira = await pedir('demo-pla-cinza.webp');
		const etag = primeira.headers.get('etag');
		expect(etag).toBeTruthy();
		const segunda = await pedir('demo-pla-cinza.webp', { 'if-none-match': etag! });
		expect(segunda.status).toBe(304);
	});

	it('arquivo do contrato que não existe é 404, sem cache', async () => {
		const r = await pedir('nao-existe.webp');
		expect(r.status).toBe(404);
		expect(r.headers.get('cache-control')).toBe('no-store');
	});

	it.each([
		'../demo/capa.png',
		'..%2Fdemo%2Fcapa.png',
		'sub/capa.png',
		'nota.txt',
		'DEMO-PLA-CINZA.webp',
		'demo-pla-cinza.webp/',
		'.webp',
		''
	])('nome fora do contrato não chega ao disco: %j', async (arquivo) => {
		const r = await pedir(arquivo);
		expect(r.status).toBe(404);
		expect(r.headers.get('content-type')).toContain('text/plain');
	});

	it('link simbólico que aponta para fora do volume não é servido', async () => {
		const r = await pedir('atalho.png');
		expect(r.status).toBe(404);
		expect(await r.text()).not.toContain('\u0009');
	});
});
