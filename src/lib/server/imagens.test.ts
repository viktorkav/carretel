import { chmod, mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { montarRespostaImagem, resolverImagem } from './imagens';

let dir: string;
let fora: string;

beforeEach(async () => {
	dir = await mkdtemp(join(tmpdir(), 'carretel-uploads-'));
	fora = await mkdtemp(join(tmpdir(), 'carretel-fora-'));
	await mkdir(join(dir, 'nuvem'), { recursive: true });
	await writeFile(join(dir, 'nuvem', '912345678.png'), new Uint8Array([1, 2, 3, 4]));
	await writeFile(join(fora, 'segredo.png'), new Uint8Array([9, 9, 9]));
});

afterEach(async () => {
	await rm(dir, { recursive: true, force: true });
	await rm(fora, { recursive: true, force: true });
});

describe('resolverImagem', () => {
	it('devolve o arquivo e o tipo quando o caminho é o que a importação gravou', async () => {
		const r = await resolverImagem('nuvem/912345678.png', { dir });

		expect(r.ok).toBe(true);
		if (!r.ok) return;
		expect(r.absoluto.endsWith(join('nuvem', '912345678.png'))).toBe(true);
		expect(r.tipo).toBe('image/png');
		expect(r.bytes).toBe(4);
	});

	it.each([
		['jpg', 'image/jpeg'],
		['jpeg', 'image/jpeg'],
		['webp', 'image/webp'],
		['gif', 'image/gif']
	])('reconhece .%s como %s', async (ext, tipo) => {
		await writeFile(join(dir, 'nuvem', `77.${ext}`), new Uint8Array([1]));
		const r = await resolverImagem(`nuvem/77.${ext}`, { dir });

		expect(r.ok).toBe(true);
		if (!r.ok) return;
		expect(r.tipo).toBe(tipo);
	});

	it.each([[null], [''], ['   ']])('trata %o como impressão sem imagem', async (bruto) => {
		const r = await resolverImagem(bruto, { dir });

		expect(r.ok).toBe(false);
		if (r.ok) return;
		expect(r.motivo).toBe('sem-imagem');
	});

	// ── path traversal ───────────────────────────────────────────────────────
	// O valor vem do banco, e o banco não é fonte confiável: uma linha
	// adulterada (SQL na mão, restore de backup, bug futuro na importação) não
	// pode virar leitura de arquivo arbitrário do host.

	it('recusa a subida de diretório', async () => {
		const r = await resolverImagem('../../etc/passwd', { dir });

		expect(r.ok).toBe(false);
		if (r.ok) return;
		expect(r.motivo).toBe('fora');
	});

	it('recusa a subida disfarçada de nome de imagem', async () => {
		// Com extensão válida, para provar que a barreira é a resolução do
		// caminho e não o filtro de extensão.
		const r = await resolverImagem('nuvem/../../../../../etc/hosts.png', { dir });

		expect(r.ok).toBe(false);
		if (r.ok) return;
		expect(r.motivo).toBe('fora');
	});

	it('recusa a forma percent-encoded que chegaria por URL', async () => {
		// `..%2F..%2Fetc%2Fpasswd`: se alguém decodificar antes de nós, vira o
		// caso de cima; se não decodificar, é um nome de arquivo esquisito. Os
		// dois têm que morrer aqui.
		const r = await resolverImagem('..%2F..%2Fetc%2Fpasswd', { dir });
		expect(r.ok).toBe(false);

		const decodificado = await resolverImagem(decodeURIComponent('..%2F..%2Fetc%2Fpasswd'), {
			dir
		});
		expect(decodificado.ok).toBe(false);
		if (decodificado.ok) return;
		expect(decodificado.motivo).toBe('fora');
	});

	it('recusa caminho absoluto', async () => {
		const r = await resolverImagem('/etc/passwd', { dir });

		expect(r.ok).toBe(false);
		if (r.ok) return;
		expect(r.motivo).toBe('invalido');
	});

	it('recusa caminho absoluto com extensão de imagem', async () => {
		const r = await resolverImagem(join(fora, 'segredo.png'), { dir });

		expect(r.ok).toBe(false);
		if (r.ok) return;
		expect(r.motivo).toBe('invalido');
	});

	it('recusa byte nulo', async () => {
		// O truque clássico de truncar o nome em C: "a.png\0.txt" é lido como
		// "a.png" por uma camada e como outra coisa pela seguinte. O Node joga
		// ERR_INVALID_ARG_VALUE — que viraria 500 se não fosse barrado antes.
		// A extensão final é `.png` de propósito: assim o caso NÃO é derrubado
		// pelo filtro de extensão, e a única coisa que separa "recusado" de
		// "TypeError do Node dentro do try" é a checagem do byte nulo.
		const r = await resolverImagem('nuvem/912345678.png\u0000.png', { dir });

		expect(r.ok).toBe(false);
		if (r.ok) return;
		expect(r.motivo).toBe('invalido');

		// E a variante que truncaria o nome numa camada em C.
		const truncando = await resolverImagem('nuvem/912345678.png\u0000.txt', { dir });
		expect(truncando.ok).toBe(false);
	});

	it('recusa link simbólico que aponta para fora do diretório de uploads', async () => {
		await symlink(join(fora, 'segredo.png'), join(dir, 'nuvem', 'fuga.png'));
		const r = await resolverImagem('nuvem/fuga.png', { dir });

		expect(r.ok).toBe(false);
		if (r.ok) return;
		expect(r.motivo).toBe('fora');
	});

	it('aceita link simbólico que continua dentro do diretório de uploads', async () => {
		await symlink(join(dir, 'nuvem', '912345678.png'), join(dir, 'nuvem', 'apelido.png'));
		const r = await resolverImagem('nuvem/apelido.png', { dir });

		expect(r.ok).toBe(true);
	});

	it('recusa link simbólico de diretório que sai do diretório de uploads', async () => {
		await symlink(fora, join(dir, 'atalho'));
		const r = await resolverImagem('atalho/segredo.png', { dir });

		expect(r.ok).toBe(false);
		if (r.ok) return;
		expect(r.motivo).toBe('fora');
	});

	it('recusa diretório vizinho cujo nome começa igual ao de uploads', async () => {
		// `uploads` e `uploads-antigo` são pastas diferentes, mas um
		// `startsWith(raiz)` sem separador aprova a segunda. É o furo silencioso
		// da defesa por prefixo de texto.
		const vizinho = `${dir}-vizinho`;
		await mkdir(vizinho, { recursive: true });
		await writeFile(join(vizinho, 'segredo.png'), new Uint8Array([7]));

		const r = await resolverImagem(`../${basename(vizinho)}/segredo.png`, { dir });
		await rm(vizinho, { recursive: true, force: true });

		expect(r.ok).toBe(false);
		if (r.ok) return;
		expect(r.motivo).toBe('fora');
	});

	it('recusa barra invertida como separador', async () => {
		// No Linux `..\..\etc\passwd` é UM nome de arquivo, não uma subida. Recusar
		// mesmo assim mantém a regra igual nos dois sistemas.
		const r = await resolverImagem('..\\..\\etc\\passwd.png', { dir });

		expect(r.ok).toBe(false);
		if (r.ok) return;
		expect(r.motivo).toBe('invalido');
	});

	it.each([['nuvem/a.svg'], ['nuvem/a.php'], ['nuvem/a'], ['nuvem/a.png.txt']])(
		'recusa %s: só as quatro extensões que a importação sabe gravar',
		async (caminho) => {
			// SVG é documento executável no navegador. Servir um com
			// `image/svg+xml` de dentro do próprio domínio seria XSS de mão beijada.
			const r = await resolverImagem(caminho, { dir });

			expect(r.ok).toBe(false);
			if (r.ok) return;
			expect(r.motivo).toBe('invalido');
		}
	);

	it('devolve ausente quando o arquivo não está mais no disco', async () => {
		// Volume novo, restore parcial, arquivo apagado à mão: a linha continua
		// no banco apontando para o nada.
		const r = await resolverImagem('nuvem/nao-existe.png', { dir });

		expect(r.ok).toBe(false);
		if (r.ok) return;
		expect(r.motivo).toBe('ausente');
	});

	it('recusa diretório disfarçado de imagem', async () => {
		// Nome com extensão boa, mas é pasta. Sem a checagem de arquivo comum, o
		// `readFile` estouraria EISDIR lá na frente — e é sempre melhor recusar
		// antes de abrir do que depender do erro do sistema.
		await mkdir(join(dir, 'nuvem', 'pasta.png'), { recursive: true });
		const r = await resolverImagem('nuvem/pasta.png', { dir });

		expect(r.ok).toBe(false);
		if (r.ok) return;
		expect(r.motivo).toBe('invalido');
	});

	it('recusa caminho sem extensão nenhuma', async () => {
		const r = await resolverImagem('nuvem', { dir });

		expect(r.ok).toBe(false);
		if (r.ok) return;
		expect(r.motivo).toBe('invalido');
	});

	it('devolve ausente quando o próprio diretório de uploads não existe', async () => {
		const r = await resolverImagem('nuvem/912345678.png', { dir: join(fora, 'sem-volume') });

		expect(r.ok).toBe(false);
		if (r.ok) return;
		expect(r.motivo).toBe('ausente');
	});
});

describe('montarRespostaImagem', () => {
	it('serve os bytes com tipo, cache longo e ETag', async () => {
		const r = await montarRespostaImagem('nuvem/912345678.png', { dir });

		expect(r.status).toBe(200);
		expect(r.headers.get('content-type')).toBe('image/png');
		expect(r.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
		expect(r.headers.get('x-content-type-options')).toBe('nosniff');
		expect(r.headers.get('etag')).toBeTruthy();
		expect(new Uint8Array(await r.arrayBuffer())).toHaveLength(4);
	});

	it('devolve 304 quando o navegador já tem a versão que está no disco', async () => {
		const primeira = await montarRespostaImagem('nuvem/912345678.png', { dir });
		const etag = primeira.headers.get('etag')!;

		const segunda = await montarRespostaImagem('nuvem/912345678.png', {
			dir,
			ifNoneMatch: etag
		});

		expect(segunda.status).toBe(304);
		expect(segunda.headers.get('etag')).toBe(etag);
		expect(await segunda.text()).toBe('');
	});

	it.each([
		['../../etc/passwd'],
		['/etc/passwd'],
		['nuvem/a.png\u0000'],
		['nuvem/nao-existe.png'],
		['nuvem/a.svg'],
		[null]
	])('responde 404 em HTML para %o — nunca 500, nunca o arquivo', async (caminho) => {
		const r = await montarRespostaImagem(caminho, { dir });

		expect(r.status).toBe(404);
		expect(r.headers.get('content-type')).toContain('text/html');
		// Sem cache: a capa pode ser recuperada depois, e um 404 congelado por um
		// ano deixaria a imagem invisível mesmo depois de baixada.
		expect(r.headers.get('cache-control')).toBe('no-store');

		const html = await r.text();
		expect(html).toContain('<!doctype html>');
		expect(html).toContain('imagem');
		expect(html).not.toContain('root:');
	});

	it('não escreve o caminho recusado no HTML', async () => {
		// Eco de entrada em página de erro é injeção de HTML de graça.
		const r = await montarRespostaImagem('<script>alert(1)</script>.png', { dir });

		expect(r.status).toBe(404);
		expect(await r.text()).not.toContain('<script>alert');
	});

	it('vira 404 quando o arquivo passa na resolução mas não abre', async () => {
		// A janela entre o `stat` e o `readFile` existe: arquivo apagado no meio,
		// permissão revogada, volume desmontado. Aqui ela é forçada com um
		// arquivo sem permissão de leitura — o único jeito de provar que o
		// `try/catch` da resposta está fazendo trabalho.
		await writeFile(join(dir, 'nuvem', 'negado.png'), new Uint8Array([1, 2]));
		await chmod(join(dir, 'nuvem', 'negado.png'), 0o000);

		const resolucao = await resolverImagem('nuvem/negado.png', { dir });
		expect(resolucao.ok).toBe(true);

		const r = await montarRespostaImagem('nuvem/negado.png', { dir });
		await chmod(join(dir, 'nuvem', 'negado.png'), 0o600);

		expect(r.status).toBe(404);
		expect(r.headers.get('content-type')).toContain('text/html');
	});

	it('nunca lança, nem com o diretório de uploads apontando para o vazio', async () => {
		const r = await montarRespostaImagem('nuvem/912345678.png', { dir: ' ' });

		expect(r.status).toBe(404);
	});
});
