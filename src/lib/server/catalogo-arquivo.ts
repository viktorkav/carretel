import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { combinarBiblioteca } from '$lib/catalogo/biblioteca';
import { promisify } from 'node:util';
import type { Catalogo, ItemCatalogo } from '$lib/catalogo/busca';
import { validarCatalogo } from '$lib/catalogo/validacao';

const execFileAsync = promisify(execFile);

/**
 * Onde o catálogo mora.
 *
 * **Não é dado versionado e não vai dentro da imagem.** Ele é gerado a partir
 * dos perfis do Bambu Studio e guardado no volume de dados, ao lado do banco.
 * Distribuir a imagem passaria a ser distribuir o dado, e a questão de licença
 * (AGPL-3.0 na origem) voltaria pela porta dos fundos — assim o que se
 * distribui é o gerador, e o dado é buscado pela instalação.
 *
 * Em produção o compose aponta pra `/data`, junto do `carretel.sqlite`. Em
 * desenvolvimento cai na raiz do projeto, e o arquivo está no `.gitignore`.
 */
export const CAMINHO_CATALOGO = process.env.CATALOGO_PATH ?? 'catalogo-bambu.json';

export type EstadoCatalogo =
	| { estado: 'ok'; catalogo: Catalogo }
	/** O arquivo ainda não existe: primeira subida sem rede, ou volume novo. */
	| { estado: 'ausente' }
	/** Existe mas não serve — JSON quebrado, ou reprovado na validação. */
	| { estado: 'invalido'; erro: string };

let cache: EstadoCatalogo | null = null;
let cacheBiblioteca: ItemCatalogo[] | null = null;
export const CAMINHO_BIBLIOTECA = process.env.BIBLIOTECA_PATH ?? join(dirname(CAMINHO_CATALOGO), 'catalogo-biblioteca.json');

function carregar(): EstadoCatalogo {
	let texto: string;
	try {
		texto = readFileSync(CAMINHO_CATALOGO, 'utf8');
	} catch {
		// Qualquer erro de leitura é tratado como ausência: o app precisa subir
		// do mesmo jeito. Um sistema de controle de custo que não abre porque o
		// GitHub está fora é pior que um sem catálogo.
		return { estado: 'ausente' };
	}

	let bruto: unknown;
	try {
		bruto = JSON.parse(texto);
	} catch {
		return { estado: 'invalido', erro: 'o arquivo não é JSON válido' };
	}

	const validado = validarCatalogo(bruto);
	if (!validado.ok) return { estado: 'invalido', erro: validado.erro };
	return { estado: 'ok', catalogo: validado.catalogo };
}

/** Lê do disco na primeira chamada e guarda em memória depois. */
export function estadoDoCatalogo(): EstadoCatalogo {
	if (!cache) cache = carregar();
	return cache;
}

/** Itens pra busca. Lista vazia quando o catálogo não está disponível — a
 *  tela é quem explica o porquê, olhando `estadoDoCatalogo()`. */
export function itensDoCatalogo(): ItemCatalogo[] {
	const e = estadoDoCatalogo();
	return e.estado === 'ok' ? e.catalogo.itens : [];
}

const indice = () => {
	const e = estadoDoCatalogo();
	return e.estado === 'ok' ? new Map(e.catalogo.itens.map((i) => [i.id, i])) : new Map();
};

let cacheIndice: Map<string, ItemCatalogo> | null = null;

/** Item pelo id vindo do formulário. `null` em vez de erro: id de catálogo
 *  chega por campo escondido e não pode virar 500. */
export function itemPorId(id: string | null | undefined): ItemCatalogo | null {
	if (!id) return null;
	if (!cacheIndice) cacheIndice = indice();
	return cacheIndice.get(id) ?? null;
}

/** Descarta o que está em memória. Chamado depois de regerar o arquivo. */
export function esquecerCatalogo(): void {
	cache = null;
	cacheIndice = null;
	cacheBiblioteca = null;
}

export type ResultadoGeracao = { ok: true; itens: number } | { ok: false; erro: string };

/**
 * Roda o gerador e recarrega o catálogo. É a ação de "atualizar catálogo" da
 * tela de configuração — quando a Bambu lança filamento novo, ele atualiza sem
 * redeploy.
 *
 * É a ÚNICA parte do sistema que toca a rede, e ela é explícita e sob demanda:
 * a busca continua local e instantânea, contra o arquivo já gerado. Depender
 * da Bambu estar no ar na hora de cadastrar um rolo que está na mão seria pior
 * em tudo.
 */
export async function gerarCatalogo(): Promise<ResultadoGeracao> {
	try {
		for (const script of ['scripts/gerar-catalogo.mjs', 'scripts/gerar-biblioteca.mjs']) {
			await execFileAsync(process.execPath, [script], {
				env: { ...process.env, CATALOGO_PATH: CAMINHO_CATALOGO, BIBLIOTECA_PATH: CAMINHO_BIBLIOTECA },
				timeout: 5 * 60 * 1000,
				maxBuffer: 4 * 1024 * 1024
			});
		}
	} catch (e) {
		esquecerCatalogo();
		const detalhe = e instanceof Error ? e.message : String(e);
		return { ok: false, erro: `não deu pra baixar o catálogo: ${detalhe}` };
	}

	esquecerCatalogo();
	const agora = estadoDoCatalogo();
	if (agora.estado !== 'ok') {
		return {
			ok: false,
			erro:
				agora.estado === 'ausente'
					? 'o gerador rodou mas não escreveu o arquivo'
					: `o catálogo baixado não passou na validação: ${agora.erro}`
		};
	}
	return { ok: true, itens: itensDaBiblioteca().length };
}

/** A biblioteca nunca consulta rede durante o cadastro. O legado continua utilizável sem complemento. */
export function itensDaBiblioteca(): ItemCatalogo[] {
	if (cacheBiblioteca) return cacheBiblioteca;
	let adicionais: ItemCatalogo[] = [];
	try {
		const resultado = validarCatalogo(JSON.parse(readFileSync(CAMINHO_BIBLIOTECA, 'utf8')));
		if (resultado.ok) adicionais = resultado.catalogo.itens;
	} catch { /* Ausência/arquivo corrompido mantém catálogo legado disponível. */ }
	cacheBiblioteca = combinarBiblioteca(itensDoCatalogo(), adicionais);
	return cacheBiblioteca;
}

export function itemDaBiblioteca(id: string | null | undefined): ItemCatalogo | null {
	return id ? itensDaBiblioteca().find((i) => i.id === id) ?? null : null;
}
