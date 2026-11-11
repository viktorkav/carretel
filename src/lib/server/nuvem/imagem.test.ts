import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { baixarCapa, baixarCapas } from './imagem';

let dir: string;
beforeEach(async () => {
	dir = await mkdtemp(join(tmpdir(), 'carretel-capa-'));
});
afterEach(async () => {
	await rm(dir, { recursive: true, force: true });
});

function respostaPng(bytes = 8) {
	return async () =>
		new Response(new Uint8Array(bytes), {
			status: 200,
			headers: { 'content-type': 'image/png' }
		});
}

describe('baixarCapa', () => {
	it('salva o arquivo e devolve o caminho relativo', async () => {
		const caminho = await baixarCapa('https://s3.exemplo/abc.png?X-Amz-Signature=x', '912345678', {
			dir,
			fetch: respostaPng() as unknown as typeof fetch
		});

		expect(caminho).toBe('nuvem/912345678.png');
		const conteudo = await readFile(join(dir, caminho!));
		expect(conteudo).toHaveLength(8);
	});

	it('devolve null sem URL — a tarefa continua importável', async () => {
		expect(await baixarCapa(null, '1', { dir })).toBeNull();
	});

	it('devolve null quando a URL não é http(s)', async () => {
		let chamou = false;
		const espiao = async () => {
			chamou = true;
			return new Response('x');
		};
		const r = await baixarCapa('file:///etc/passwd', '1', {
			dir,
			fetch: espiao as unknown as typeof fetch
		});

		expect(r).toBeNull();
		expect(chamou).toBe(false);
	});

	it('engole a queda de rede — imagem é anexo, não pode travar a importação', async () => {
		const caindo = async () => {
			throw new Error('ECONNRESET');
		};
		expect(
			await baixarCapa('https://s3.exemplo/a.png', '1', {
				dir,
				fetch: caindo as unknown as typeof fetch
			})
		).toBeNull();
	});

	it('engole a URL expirada (403 do S3)', async () => {
		// `cover` é pré-assinada com validade de 1 h: expirar é caso esperado.
		const expirada = async () => new Response('expired', { status: 403 });
		expect(
			await baixarCapa('https://s3.exemplo/a.png', '1', {
				dir,
				fetch: expirada as unknown as typeof fetch
			})
		).toBeNull();
	});

	it('recusa arquivo maior que o teto, para não encher o disco do ZimaCube', async () => {
		const gigante = respostaPng(3_000_000);
		expect(
			await baixarCapa('https://s3.exemplo/a.png', '1', {
				dir,
				fetch: gigante as unknown as typeof fetch,
				maxBytes: 1000
			})
		).toBeNull();
	});

	it('não deixa o taskId escapar do diretório', async () => {
		const caminho = await baixarCapa('https://s3.exemplo/a.png', '../../etc/passwd', {
			dir,
			fetch: respostaPng() as unknown as typeof fetch
		});
		expect(caminho).toBe('nuvem/etcpasswd.png');
	});

	it('usa a extensão do content-type quando a URL não ajuda', async () => {
		const jpeg = async () =>
			new Response(new Uint8Array(4), { status: 200, headers: { 'content-type': 'image/jpeg' } });
		const caminho = await baixarCapa('https://s3.exemplo/sem-extensao?x=1', '77', {
			dir,
			fetch: jpeg as unknown as typeof fetch
		});
		expect(caminho).toBe('nuvem/77.jpg');
	});
});

describe('baixarCapas', () => {
	it('respeita o teto de downloads simultâneos', async () => {
		let ativos = 0;
		let pico = 0;
		const lento = async () => {
			ativos++;
			pico = Math.max(pico, ativos);
			await new Promise((r) => setTimeout(r, 5));
			ativos--;
			return new Response(new Uint8Array(4), {
				status: 200,
				headers: { 'content-type': 'image/png' }
			});
		};

		const itens = Array.from({ length: 20 }, (_, i) => ({
			taskId: `t${i}`,
			url: 'https://s3.exemplo/a.png'
		}));
		const mapa = await baixarCapas(itens, {
			dir,
			fetch: lento as unknown as typeof fetch,
			concorrencia: 3
		});

		expect(mapa.size).toBe(20);
		expect(pico).toBeLessThanOrEqual(3);
	});

	it('deixa de fora só as que falharam', async () => {
		let n = 0;
		const alternado = async () => {
			n++;
			if (n % 2 === 0) return new Response('nope', { status: 403 });
			return new Response(new Uint8Array(4), {
				status: 200,
				headers: { 'content-type': 'image/png' }
			});
		};
		const itens = Array.from({ length: 4 }, (_, i) => ({
			taskId: `t${i}`,
			url: 'https://s3.exemplo/a.png'
		}));
		const mapa = await baixarCapas(itens, {
			dir,
			fetch: alternado as unknown as typeof fetch,
			concorrencia: 1
		});

		expect(mapa.size).toBe(2);
	});

	it('manda AbortSignal e desiste da capa que não responde', async () => {
		const nuncaResponde = (_u: unknown, init?: RequestInit) =>
			new Promise<Response>((_, rejeita) => {
				init?.signal?.addEventListener('abort', () => rejeita(new Error('abortado')));
			});
		const r = await baixarCapa('https://s3.exemplo/a.png', '1', {
			dir,
			fetch: nuncaResponde as unknown as typeof fetch,
			timeoutMs: 40
		});
		expect(r).toBeNull();
	});
});
