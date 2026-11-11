#!/usr/bin/env node
/**
 * Gera o catálogo de filamentos a partir dos perfis do Bambu Studio.
 *
 * Escreve em `CATALOGO_PATH` (padrão `catalogo-bambu.json` na raiz do
 * projeto; no container, `/data/catalogo-bambu.json`, no volume, ao lado do
 * banco). O arquivo é gitignorado de propósito — ver o bloco de licença abaixo.
 *
 * Fonte: bambulab/BambuStudio, `resources/profiles/BBL/filament/` —
 *   - `filaments_color_codes.json`: as cores oficiais de cada código
 *     (`fila_id`), com nome traduzido e hex.
 *   - `* @base.json`: um por linha de produto, é onde mora o `filament_id`
 *     (GFA00, GFG99...) e a densidade.
 *   - `fdm_filament_*.json`: os perfis herdados, de onde vêm temperatura de
 *     bico/mesa e o polímero base quando a linha não sobrescreve.
 *
 * O commit é fixo (COMMIT abaixo) porque catálogo que muda sozinho entre duas
 * execuções não é catálogo, é surpresa — e é ele que fica gravado no arquivo
 * gerado, pra dar pra saber qual catálogo está em uso. Para pegar filamento
 * novo da Bambu: troque o SHA e rode `npm run catalogo` (ou o botão em
 * /config).
 *
 * Licença da fonte: AGPL-3.0. O dado gerado NÃO é versionado nem embarcado na
 * imagem — cada instalação busca o seu, e o que se distribui é este gerador,
 * que é código original. Veja Catálogo de filamentos no README.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const COMMIT = 'a803118282d8208361b4584b720af175dd1a9b4e';
const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
// O catálogo NÃO é dado versionado e não vai dentro da imagem: ele mora no
// volume de dados, ao lado do banco. `CATALOGO_PATH` é o mesmo nome que o app
// lê em `src/lib/server/catalogo-arquivo.ts`.
const DESTINO = resolve(RAIZ, process.env.CATALOGO_PATH ?? 'catalogo-bambu.json');
const DIR = `https://raw.githubusercontent.com/bambulab/BambuStudio/${COMMIT}/resources/profiles/BBL/filament`;
const ARVORE = `https://api.github.com/repos/bambulab/BambuStudio/git/trees/${COMMIT}?recursive=1`;

/** GitHub raw cospe 5xx esporádico em rajada; sem retry o catálogo sai furado. */
async function baixar(url, tentativas = 4) {
	for (let i = 1; i <= tentativas; i++) {
		try {
			const r = await fetch(url);
			if (r.ok) return await r.text();
			if (r.status === 404) throw new Error(`404 em ${url}`);
			throw new Error(`HTTP ${r.status} em ${url}`);
		} catch (e) {
			if (i === tentativas) throw e;
			await new Promise((ok) => setTimeout(ok, 400 * i));
		}
	}
}

const json = async (url) => JSON.parse(await baixar(url));

/**
 * O diretório tem subpastas (`Polymaker/`, `SUNLU/`, `P1P/`) e o campo
 * `inherits` cita o perfil só pelo nome, sem caminho. Este índice
 * nome -> caminho completo resolve as duas coisas.
 */
const caminhos = new Map();
const arquivo = (caminhoRelativo) =>
	`${DIR}/${caminhoRelativo.split('/').map(encodeURIComponent).join('/')}`;
const porNome = (nome) => {
	const caminho = caminhos.get(`${nome}.json`);
	if (!caminho) throw new Error(`perfil herdado não encontrado: ${nome}`);
	return arquivo(caminho);
};

/** Perfis herdados (`inherits`), resolvidos uma vez e memoizados. */
const herdados = new Map();
async function resolverHerdado(nome) {
	if (herdados.has(nome)) return herdados.get(nome);
	const perfil = await json(porNome(nome));
	const pai = perfil.inherits ? await resolverHerdado(perfil.inherits) : {};
	const achatado = { ...pai, ...perfil };
	herdados.set(nome, achatado);
	return achatado;
}

/**
 * Cores básicas em inglês → português, para alias de busca.
 *
 * A fonte não traz `pt` para 74 das 314 cores (linhas inteiras: PETG Basic,
 * PETG Matte, TPU 85A/90A, PLA Tough+, PLA Translucent...), e nessas o nome
 * exibido acaba sendo o inglês. Sem alias, procurar "preto" não acha os
 * "Black" — o rolo do usuário simplesmente some da busca.
 *
 * Só entram palavras de cor sem ambiguidade, e o mapeamento é **aditivo**:
 * nunca troca o que é exibido nem o que é gravado, só engorda o texto
 * buscável. Nome comercial (Matte, Silk, Basic) fica de fora de propósito.
 */
const CORES_PT = {
	black: 'preto',
	white: 'branco',
	red: 'vermelho',
	blue: 'azul',
	green: 'verde',
	yellow: 'amarelo',
	orange: 'laranja',
	gray: 'cinza',
	grey: 'cinza',
	brown: 'marrom',
	pink: 'rosa',
	purple: 'roxo',
	violet: 'violeta',
	silver: 'prata',
	gold: 'dourado',
	golden: 'dourado',
	beige: 'bege',
	ivory: 'marfim',
	cyan: 'ciano',
	magenta: 'magenta',
	turquoise: 'turquesa',
	transparent: 'transparente',
	clear: 'transparente',
	natural: 'natural',
	bronze: 'bronze',
	copper: 'cobre',
	navy: 'marinho',
	dark: 'escuro',
	light: 'claro'
};

/**
 * Texto extra de busca de uma cor: o nome em inglês (que é a única língua que
 * cobre 100% das 314 cores) mais os equivalentes em português das palavras de
 * cor que ele contiver. Nunca é exibido nem gravado no cadastro.
 */
function aliasDaCor(en, exibido) {
	const termos = new Set();
	if (en && en !== exibido) termos.add(en);
	for (const palavra of String(en ?? '').toLowerCase().split(/[^a-z]+/)) {
		const pt = CORES_PT[palavra];
		if (pt) termos.add(pt);
	}
	const texto = [...termos].join(' ').trim();
	return texto || null;
}

const primeiro = (campo) => (Array.isArray(campo) ? campo[0] : campo);
const numero = (campo) => {
	const v = Number(primeiro(campo));
	return Number.isFinite(v) ? v : null;
};

async function main() {
	console.log('lendo a árvore do repositório...');
	const arvore = await json(ARVORE);
	const PREFIXO = 'resources/profiles/BBL/filament/';
	const dentro = arvore.tree.filter((n) => n.path.startsWith(PREFIXO) && n.path.endsWith('.json'));
	for (const n of dentro) caminhos.set(n.path.split('/').pop(), n.path.slice(PREFIXO.length));

	const bases = dentro.filter((n) => n.path.endsWith('@base.json')).map((n) => n.path.slice(PREFIXO.length));
	console.log(`${bases.length} perfis @base`);

	const modelos = [];
	for (const nome of bases) {
		const perfil = await json(arquivo(nome));
		if (!perfil.filament_id) continue;
		const pai = perfil.inherits ? await resolverHerdado(perfil.inherits) : {};
		const p = { ...pai, ...perfil };
		const marca = primeiro(p.filament_vendor) ?? 'Generic';
		const nomeCompleto = perfil.name.replace(/ @base$/, '');
		// "Bambu Lab" + "Bambu PLA Basic" viraria "Bambu Lab Bambu PLA Basic"
		// na tela. O nome do perfil já começa pela marca, então tira o prefixo.
		const prefixo = marca.split(' ')[0] + ' ';
		modelos.push({
			codigo: perfil.filament_id,
			marca,
			linha: nomeCompleto.startsWith(prefixo) ? nomeCompleto.slice(prefixo.length) : nomeCompleto,
			nomeCompleto,
			polimero: primeiro(p.filament_type) ?? null,
			densidade: numero(p.filament_density),
			tempBico: numero(p.nozzle_temperature),
			tempMesa: numero(p.hot_plate_temp)
		});
		process.stdout.write('.');
	}
	console.log(`\n${modelos.length} modelos`);

	console.log('lendo as cores...');
	const cores = (await json(porNome('filaments_color_codes'))).data;
	const porCodigo = new Map();
	for (const c of cores) {
		if (!porCodigo.has(c.fila_id)) porCodigo.set(c.fila_id, []);
		const en = c.fila_color_name?.en;
		const exibido = c.fila_color_name?.pt || en;
		porCodigo.get(c.fila_id).push({
			id: c.fila_color_code,
			cor: exibido,
			alias: aliasDaCor(en, exibido),
			hex: (c.fila_color?.[0] ?? '').slice(0, 7).toUpperCase() || null
		});
	}

	const itens = [];
	for (const m of modelos.sort((a, b) => a.nomeCompleto.localeCompare(b.nomeCompleto, 'pt-BR'))) {
		// A linha sem cor definida vem primeiro: é ela que serve pra rolo de
		// marca que não é a Bambu, e pros 54 códigos sem tabela de cor.
		const base = {
			marca: m.marca,
			material: m.linha,
			polimero: m.polimero,
			densidade: m.densidade,
			tempBico: m.tempBico,
			tempMesa: m.tempMesa,
			codigoBambu: m.codigo
		};
		itens.push({ id: m.codigo, cor: null, corAlias: null, corHex: null, ...base });
		for (const c of porCodigo.get(m.codigo) ?? []) {
			itens.push({ id: c.id, cor: c.cor, corAlias: c.alias, corHex: c.hex, ...base });
		}
	}

	// Âncoras de valor. O piso de contagem abaixo pega mudança de ESTRUTURA;
	// isto pega mudança de VALOR, que é o erro silencioso: densidade errada não
	// quebra nada na tela, só envenena a estimativa de estoque de todo rolo
	// daquele filamento. Conferido campo a campo contra o BambuStudio no commit
	// fixado — os mesmos três produtos estão na fixture de teste.
	const DOURADAS = {
		GFA00: { material: 'PLA Basic', densidade: 1.26, tempBico: 220, tempMesa: 55 },
		GFA01: { material: 'PLA Matte', densidade: 1.32, tempBico: 220, tempMesa: 55 },
		GFG99: { material: 'PETG', densidade: 1.27, tempBico: 255, tempMesa: 70 }
	};
	for (const [codigo, esperado] of Object.entries(DOURADAS)) {
		const achado = itens.find((i) => i.id === codigo);
		if (!achado) throw new Error(`linha dourada ${codigo} sumiu do catálogo`);
		for (const [campo, valor] of Object.entries(esperado)) {
			if (achado[campo] !== valor) {
				throw new Error(
					`linha dourada ${codigo}: ${campo} veio ${achado[campo]}, esperado ${valor} — ` +
						'a fonte mudou ou a resolução de `inherits` quebrou; confira antes de gravar'
				);
			}
		}
	}

	// Piso de sanidade. Se a convenção `@base` mudar de nome lá no BambuStudio,
	// o filtro casa com zero arquivos, o script sai feliz com código 0 e
	// sobrescreve o catálogo bom por um vazio. Melhor estourar.
	if (itens.length < 300) {
		throw new Error(
			`catálogo com ${itens.length} itens (esperado 300+) — a estrutura da fonte mudou, ` +
				'confira os filtros antes de gravar por cima do arquivo bom'
		);
	}

	const saida = {
		fonte: 'bambulab/BambuStudio · resources/profiles/BBL/filament',
		licencaFonte: 'AGPL-3.0',
		commit: COMMIT,
		geradoEm: new Date().toISOString().slice(0, 10),
		itens
	};

	await mkdir(dirname(DESTINO), { recursive: true });
	await writeFile(DESTINO, JSON.stringify(saida) + '\n');
	console.log(`${itens.length} itens escritos em ${DESTINO}`);
}

main().catch((e) => {
	console.error(e);
	process.exit(1);
});
