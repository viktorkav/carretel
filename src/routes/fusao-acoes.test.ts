/**
 * Testes das ACTIONS da tela única de filamento — não dos helpers.
 *
 * A regra que a fusão inteira existe para valer é uma frase do dono: *"quando
 * eu comprar outro rolo igual, não é somar ao rolo anterior, é um produto novo,
 * com código único novo"*. Ela mora na FIAÇÃO entre o formulário e o
 * repositório: `criarRolo` sozinho já não reaproveita nada, mas foi a action
 * antiga (`filamentoDoCatalogo`) que decidia reusar, e um teste de helper
 * passaria feliz com ela de volta.
 *
 * O catálogo é lido de um arquivo, então o teste escreve um catálogo mínimo e
 * aponta `CATALOGO_PATH` para ele ANTES do import — igual ao banco.
 */
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';

const pasta = mkdtempSync(join(tmpdir(), 'carretel-fusao-acoes-'));
process.env.DATABASE_PATH = join(pasta, 'teste.sqlite');

const PRETO = {
	id: '10101',
	cor: 'Preto',
	corAlias: 'Black preto',
	corHex: '#000000',
	marca: 'Bambu Lab',
	material: 'PLA Basic',
	polimero: 'PLA',
	densidade: 1.26,
	tempBico: 220,
	tempMesa: 55,
	codigoBambu: 'GFA00'
};
const PETG_GENERICO = {
	id: 'GFG99',
	cor: null,
	corAlias: null,
	corHex: null,
	marca: 'Generic',
	material: 'PETG',
	polimero: 'PETG',
	densidade: 1.27,
	tempBico: 255,
	tempMesa: 70,
	codigoBambu: 'GFG99'
};

const CATALOGO = join(pasta, 'catalogo.json');
const ESTIMADO = { ...PRETO, id: 'curado:pla-azul', marca: 'Curadoria', cor: 'Azul', corAlias: 'azul', corHex: '#0000FF', codigoBambu: '', fonteCatalogo: 'manual', densidadeEstimada: true };
writeFileSync(
	CATALOGO,
	JSON.stringify({
		fonte: 'teste',
		licencaFonte: 'AGPL-3.0',
		commit: 'a'.repeat(40),
		geradoEm: '2026-08-10',
		itens: [PRETO, PETG_GENERICO, ESTIMADO]
	})
);
process.env.CATALOGO_PATH = CATALOGO;

const { db, schema } = await import('$lib/server/db');
migrate(db, { migrationsFolder: './drizzle' });

const { registrarImpressao } = await import('$lib/server/repo');
const rolos = (await import('./rolos/+page.server')).actions;
const filamentos = await import('./filamentos/+page.server');
const impressoes = await import('./impressoes/+page.server');

let impressoraId: number;

beforeEach(() => {
	db.delete(schema.impressao).run();
	db.delete(schema.afericao).run();
	db.delete(schema.manutencao).run();
	db.delete(schema.rolo).run();
	db.delete(schema.impressora).run();
	db.delete(schema.config).run();
	db.insert(schema.config).values({ id: 1, tarifaKwhCents: 95 }).run();

	const [imp] = db
		.insert(schema.impressora)
		.values({
			nome: 'A1',
			modelo: 'Bambu Lab A1',
			precoCompraCents: 400000,
			vidaUtilHoras: 8000,
			potenciaMediaW: 150
		})
		.returning()
		.all();
	impressoraId = imp.id;
});

/** RequestEvent mínimo: estas actions só usam `request`. */
function evento(campos: Record<string, string>) {
	const corpo = new FormData();
	for (const [chave, valor] of Object.entries(campos)) corpo.set(chave, valor);
	return { request: new Request('http://localhost/', { method: 'POST', body: corpo }) } as never;
}

type Retorno = { status?: number; data?: { erro?: string }; aviso?: string; [k: string]: unknown };

async function chamar(
	action: (ev: never) => unknown,
	campos: Record<string, string>
): Promise<Retorno> {
	try {
		return (await action(evento(campos))) as Retorno;
	} catch (e) {
		if (e && typeof e === 'object' && 'status' in e && 'location' in e) {
			return { redirecionou: true, ...(e as object) };
		}
		throw e;
	}
}

function recusou(r: Retorno) {
	return r.status === 400 && typeof r.data?.erro === 'string' && r.data.erro.length > 0;
}

const listar = () => db.select().from(schema.rolo).orderBy(schema.rolo.id).all();
const doCatalogo = (over: Record<string, string> = {}) => ({
	itemId: PRETO.id,
	marca: PRETO.marca,
	cor: PRETO.cor,
	preco: '120,00',
	pesoInicial: '1000',
	pesoCarretel: '250',
	...over
});

// ── a regra da fusão ────────────────────────────────────────────────────────

/**
 * O `load` de /impressoes lê `url` (para `?ver=`) e `cookies` (para lembrar a
 * escolha entre grade e lista). Quem só quer conferir a lista de rolos ainda
 * precisa entregar os dois.
 */
function ctxImpressoes() {
	return {
		url: new URL('http://192.0.2.10:3316/impressoes'),
		cookies: { get: () => undefined, set: () => {} }
	};
}

describe('/rolos ?/criarDoCatalogo · comprar de novo é registro novo', () => {
	it('permite corrigir densidade estimada sem sobrescrever ficha oficial', async () => {
		await chamar(rolos.criarDoCatalogo, doCatalogo({ itemId: ESTIMADO.id, marca: '', cor: '', densidade: '1,31' }));
		await chamar(rolos.criarDoCatalogo, doCatalogo({ densidade: '9,99' }));
		expect(listar().map(r => r.densidade)).toEqual([1.31, 1.26]);
	});
	it('devolve o ID exato da compra para selecionar na impressão em andamento', async () => {
		await chamar(rolos.criarDoCatalogo, doCatalogo());
		const resultado = await chamar(rolos.criarDoCatalogo, doCatalogo({ preco: '159,00' }));
		expect(resultado.roloId).toBe(listar()[1].id);
	});

	it('reenvio após perder resposta recupera o ID da compra, sem duplicar', async () => {
		const envio = crypto.randomUUID();
		const primeiro = await chamar(rolos.criarDoCatalogo, doCatalogo({ envio }));
		const repetido = await chamar(rolos.criarDoCatalogo, doCatalogo({ envio }));
		expect(repetido.roloId).toBe(primeiro.roloId);
		expect(listar()).toHaveLength(1);
	});

	it('o cadastro guiado recusa preço vazio e preserva a variante para corrigir', async () => {
		const resultado = await chamar(rolos.criarDoCatalogo, doCatalogo({ guiado: '1', preco: '' }));
		expect(resultado.status).toBe(400);
		expect(resultado.data).toMatchObject({ campo: 'preco', valores: { itemId: PRETO.id } });
		expect(listar()).toHaveLength(0);
	});
	it('duas vezes o MESMO item viram dois registros independentes', async () => {
		const a = await chamar(rolos.criarDoCatalogo, doCatalogo({ preco: '120,00' }));
		const b = await chamar(rolos.criarDoCatalogo, doCatalogo({ preco: '159,00' }));
		expect(a.status).toBeUndefined();
		expect(b.status).toBeUndefined();

		const todos = listar();
		expect(todos).toHaveLength(2);
		expect(todos.map((r) => r.precoPagoCents)).toEqual([12000, 15900]);
		expect(todos.map((r) => r.codigo)).toEqual(['PLA-PRETO-01', 'PLA-PRETO-02']);
	});

	it('a segunda compra NÃO reescreve o preço da primeira', async () => {
		await chamar(rolos.criarDoCatalogo, doCatalogo({ preco: '120,00' }));
		await chamar(rolos.criarDoCatalogo, doCatalogo({ preco: '159,00' }));
		expect(listar()[0].precoPagoCents).toBe(12000);
	});

	it('a segunda compra não mexe no custo congelado das impressões da primeira', async () => {
		await chamar(rolos.criarDoCatalogo, doCatalogo({ preco: '120,00' }));
		const primeiro = listar()[0];
		const impressao = registrarImpressao(db, {
			nomeLivre: 'caixa',
			impressoraId,
			roloId: primeiro.id,
			inicioEm: 1_754_700_000_000,
			duracaoS: 3600,
			gramas: 100,
			status: 'sucesso',
			finalidade: 'estudio',
			origem: 'manual'
		});
		expect(impressao.custoFilamentoCents).toBe(1200);

		await chamar(rolos.criarDoCatalogo, doCatalogo({ preco: '159,00' }));

		const depois = db
			.select()
			.from(schema.impressao)
			.where(eq(schema.impressao.id, impressao.id))
			.get()!;
		expect(depois.roloId).toBe(primeiro.id);
		expect(depois.custoFilamentoCents).toBe(1200);
		expect(depois.custoTotalCents).toBe(impressao.custoTotalCents);
	});

	it('anuncia o código para ele escrever no carretel', async () => {
		const r = await chamar(rolos.criarDoCatalogo, doCatalogo());
		expect(String(r.aviso)).toContain('PLA-PRETO-01');
		expect(String(r.aviso)).toContain('carretel');
	});

	it('copia a ficha do catálogo para o próprio rolo', async () => {
		await chamar(rolos.criarDoCatalogo, doCatalogo());
		const [r] = listar();
		expect(r.marca).toBe('Bambu Lab');
		expect(r.material).toBe('PLA Basic');
		expect(r.cor).toBe('Preto');
		expect(r.corHex).toBe('#000000');
		expect(r.densidade).toBeCloseTo(1.26);
		expect(r.tempBico).toBe(220);
		expect(r.tempMesa).toBe(55);
		expect(r.codigoBambu).toBe('GFA00');
		expect(r.fonteCatalogo).toBe('bambu');
	});

	it('cores diferentes do mesmo material têm contagens próprias', async () => {
		await chamar(rolos.criarDoCatalogo, doCatalogo());
		await chamar(
			rolos.criarDoCatalogo,
			doCatalogo({ itemId: PETG_GENERICO.id, marca: '3D Fila', cor: 'Azul' })
		);
		expect(listar().map((r) => r.codigo)).toEqual(['PLA-PRETO-01', 'PETG-AZUL-01']);
	});

	// ── entrada de usuário nunca vira 500 ────────────────────────────────────

	it('item de catálogo inexistente é recusado, não estoura', async () => {
		const r = await chamar(rolos.criarDoCatalogo, doCatalogo({ itemId: 'nao-existe' }));
		expect(recusou(r)).toBe(true);
		expect(listar()).toHaveLength(0);
	});

	it('preço malformado é recusado e devolve o formulário INTEIRO como estava', async () => {
		// Este caminho já devolvia marca e cor, e era o único do sistema que
		// devolvia alguma coisa — virou o modelo dos outros. O que mudou aqui é o
		// alcance: volta o formulário todo, com a chave do campo que falhou.
		const r = await chamar(
			rolos.criarDoCatalogo,
			doCatalogo({ marca: '3D Fila', cor: 'Roxo', preco: 'abc', apelido: 'o roxo bom' })
		);
		expect(recusou(r)).toBe(true);

		const d = r.data as { valores?: Record<string, string>; campo?: string };
		expect(d.valores?.marca).toBe('3D Fila');
		expect(d.valores?.cor).toBe('Roxo');
		expect(d.valores?.apelido).toBe('o roxo bom');
		expect(d.valores?.preco).toBe('abc');
		expect(d.campo).toBe('preco');
		expect(listar()).toHaveLength(0);
	});

	it('item sem cor e sem cor digitada é recusado', async () => {
		const r = await chamar(
			rolos.criarDoCatalogo,
			doCatalogo({ itemId: PETG_GENERICO.id, marca: 'Generic', cor: '' })
		);
		expect(recusou(r)).toBe(true);
		expect(listar()).toHaveLength(0);
	});

	it('peso inicial zero é recusado — ele viraria divisão por zero no custo', async () => {
		const r = await chamar(rolos.criarDoCatalogo, doCatalogo({ pesoInicial: '0' }));
		expect(recusou(r)).toBe(true);
		expect(listar()).toHaveLength(0);
	});
});

describe('/rolos ?/criar · cadastro à mão', () => {
	const manual = (over: Record<string, string> = {}) => ({
		marca: 'Voolt',
		material: 'PETG HF',
		cor: 'Verde-limão',
		densidade: '1.27',
		preco: '99,00',
		...over
	});

	it('gera código e marca a origem como manual, sem código Bambu', async () => {
		const r = await chamar(rolos.criar, manual());
		expect(r.status).toBeUndefined();

		const [rolo] = listar();
		expect(rolo.codigo).toBe('PETG-VERDE-01');
		expect(rolo.fonteCatalogo).toBe('manual');
		expect(rolo.codigoBambu).toBe(null);
		expect(rolo.precoPagoCents).toBe(9900);
	});

	it('usa os padrões documentados quando os campos físicos vêm em branco', async () => {
		await chamar(rolos.criar, manual({ preco: '' }));
		const [rolo] = listar();
		expect(rolo.precoPagoCents).toBe(0);
		expect(rolo.pesoLiquidoInicialG).toBe(1000);
		expect(rolo.pesoCarretelG).toBe(250);
	});

	it('recusa marca, material ou cor em branco', async () => {
		expect(recusou(await chamar(rolos.criar, manual({ marca: '' })))).toBe(true);
		expect(recusou(await chamar(rolos.criar, manual({ material: '' })))).toBe(true);
		expect(recusou(await chamar(rolos.criar, manual({ cor: '' })))).toBe(true);
		expect(listar()).toHaveLength(0);
	});

	it('recusa hex inválido em vez de pintar a tela com CSS digitado', async () => {
		const r = await chamar(rolos.criar, manual({ corHex: 'nao-e-hex' }));
		expect(recusou(r)).toBe(true);
		expect(listar()).toHaveLength(0);
	});

	it('dois cadastros manuais iguais também não se fundem', async () => {
		await chamar(rolos.criar, manual({ preco: '99,00' }));
		await chamar(rolos.criar, manual({ preco: '110,00' }));
		expect(listar().map((r) => [r.codigo, r.precoPagoCents])).toEqual([
			['PETG-VERDE-01', 9900],
			['PETG-VERDE-02', 11000]
		]);
	});
});

describe('/rolos ?/editar · o código', () => {
	async function doisRolos() {
		await chamar(rolos.criarDoCatalogo, doCatalogo({ preco: '120,00' }));
		await chamar(rolos.criarDoCatalogo, doCatalogo({ preco: '159,00' }));
		return listar();
	}

	const edicao = (id: number, over: Record<string, string> = {}) => ({
		id: String(id),
		codigo: 'PLA-PRETO-01',
		marca: 'Bambu Lab',
		material: 'PLA Basic',
		cor: 'Preto',
		densidade: '1.26',
		preco: '120,00',
		pesoInicial: '1000',
		pesoCarretel: '250',
		status: 'aberto',
		...over
	});

	it('aceita um código novo e livre, e normaliza o que foi digitado', async () => {
		const [a] = await doisRolos();
		const r = await chamar(rolos.editar, edicao(a.id, { codigo: 'gaveta 2' }));
		expect(r.status).toBeUndefined();
		expect(listar()[0].codigo).toBe('GAVETA-2');
	});

	it('recusa o código que já é do outro rolo, sem gravar nada', async () => {
		const [a] = await doisRolos();
		const r = await chamar(rolos.editar, edicao(a.id, { codigo: 'PLA-PRETO-02', preco: '1,00' }));
		expect(recusou(r)).toBe(true);

		const [depois] = listar();
		expect(depois.codigo).toBe('PLA-PRETO-01');
		expect(depois.precoPagoCents).toBe(12000);
	});

	it('recusa código em branco — é a identidade do rolo na prateleira', async () => {
		const [a] = await doisRolos();
		const r = await chamar(rolos.editar, edicao(a.id, { codigo: '' }));
		expect(recusou(r)).toBe(true);
		expect(listar()[0].codigo).toBe('PLA-PRETO-01');
	});

	it('recusa código com acento, que não sobrevive à caneta', async () => {
		const [a] = await doisRolos();
		const r = await chamar(rolos.editar, edicao(a.id, { codigo: 'PLA-VERMELHÃO' }));
		expect(recusou(r)).toBe(true);
		expect(listar()[0].codigo).toBe('PLA-PRETO-01');
	});

	it('salvar sem trocar o código funciona — a trava não briga com o próprio rolo', async () => {
		const [a] = await doisRolos();
		const r = await chamar(rolos.editar, edicao(a.id, { preco: '130,00' }));
		expect(r.status).toBeUndefined();
		expect(listar()[0].precoPagoCents).toBe(13000);
	});

	it('rolo inexistente é recusado, não estoura', async () => {
		expect(recusou(await chamar(rolos.editar, edicao(99999)))).toBe(true);
	});
});

describe('/rolos ?/editar · a âncora da nuvem não é editável', () => {
	it('ignora codigoBambu e fonteCatalogo mandados pelo formulário', async () => {
		await chamar(rolos.criarDoCatalogo, doCatalogo());
		const [antes] = listar();

		const r = await chamar(rolos.editar, {
			id: String(antes.id),
			codigo: antes.codigo,
			marca: 'Bambu Lab',
			material: 'PLA Basic',
			cor: 'Preto',
			densidade: '1.26',
			preco: '120,00',
			pesoInicial: '1000',
			pesoCarretel: '250',
			status: 'aberto',
			// Um POST forjado. Deixar isto passar soltaria a âncora que a
			// importação da nuvem usa para achar este rolo pelo `filamentId`.
			codigoBambu: 'GFZZ99',
			fonteCatalogo: 'manual'
		});
		expect(r.status).toBeUndefined();

		const [depois] = listar();
		expect(depois.codigoBambu).toBe('GFA00');
		expect(depois.fonteCatalogo).toBe('bambu');
	});
});

describe('/rolos ?/editar · o recálculo continua sendo escolha', () => {
	async function comImpressao() {
		await chamar(rolos.criarDoCatalogo, doCatalogo({ preco: '120,00' }));
		const [rolo] = listar();
		const impressao = registrarImpressao(db, {
			nomeLivre: 'caixa',
			impressoraId,
			roloId: rolo.id,
			inicioEm: 1_754_700_000_000,
			duracaoS: 3600,
			gramas: 100,
			status: 'sucesso',
			finalidade: 'estudio',
			origem: 'manual'
		});
		return { rolo, impressao };
	}

	const edicao = (id: number, over: Record<string, string> = {}) => ({
		id: String(id),
		codigo: 'PLA-PRETO-01',
		marca: 'Bambu Lab',
		material: 'PLA Basic',
		cor: 'Preto',
		densidade: '1.26',
		preco: '60,00',
		pesoInicial: '1000',
		pesoCarretel: '250',
		status: 'aberto',
		...over
	});

	const ler = (id: number) =>
		db.select().from(schema.impressao).where(eq(schema.impressao.id, id)).get()!;

	it('sem marcar, o custo congelado fica onde estava', async () => {
		const { rolo, impressao } = await comImpressao();
		await chamar(rolos.editar, edicao(rolo.id));
		expect(ler(impressao.id).custoFilamentoCents).toBe(1200);
	});

	it('marcando, reescreve com o preço novo e diz quantas foram', async () => {
		const { rolo, impressao } = await comImpressao();
		const r = await chamar(rolos.editar, edicao(rolo.id, { recalcular: 'on' }));
		expect(r.recalculadas).toBe(1);
		expect(ler(impressao.id).custoFilamentoCents).toBe(600);
	});

	it('mudar só a ficha, mesmo marcando, não move o custo', async () => {
		const { rolo, impressao } = await comImpressao();
		await chamar(
			rolos.editar,
			edicao(rolo.id, { preco: '120,00', cor: 'Preto Fosco', densidade: '1.31', recalcular: 'on' })
		);
		expect(ler(impressao.id).custoFilamentoCents).toBe(1200);
		expect(listar()[0].cor).toBe('Preto Fosco');
	});
});

describe('/impressoes · o que o formulário de nova impressão oferece', () => {
	/**
	 * O mesmo decoy que a importação passou a recusar: a fusão fabrica rolos
	 * `vazio` a partir de filamento sem rolo, com material, cor e código
	 * vizinhos aos reais. Este formulário é o "acabei de imprimir" — rolo vazio
	 * não imprime, e oferecê-lo é convidar a gravar custo zero.
	 */
	async function comUmVazio() {
		await chamar(rolos.criarDoCatalogo, doCatalogo({ preco: '120,00' }));
		db.insert(schema.rolo)
			.values({
				codigo: 'PLA-PRETO-99',
				marca: 'Bambu Lab',
				material: 'PLA Basic',
				cor: 'Preto',
				precoPagoCents: 0,
				status: 'vazio'
			})
			.run();
		db.insert(schema.rolo)
			.values({
				codigo: 'PLA-PRETO-98',
				marca: 'Bambu Lab',
				material: 'PLA Basic',
				cor: 'Preto',
				precoPagoCents: 0,
				status: 'descartado'
			})
			.run();
		return (await impressoes.load(ctxImpressoes() as never)) as { rolos: { codigo: string }[] };
	}

	it('esconde rolo vazio e descartado da lista', async () => {
		const dados = await comUmVazio();
		expect(dados.rolos.map((r) => r.codigo)).toEqual(['PLA-PRETO-01']);
	});

	it('continua oferecendo os rolos utilizáveis', async () => {
		await chamar(rolos.criarDoCatalogo, doCatalogo({ preco: '120,00' }));
		await chamar(rolos.criarDoCatalogo, doCatalogo({ preco: '159,00' }));
		const dados = (await impressoes.load(ctxImpressoes() as never)) as { rolos: { codigo: string }[] };
		expect(dados.rolos.map((r) => r.codigo)).toEqual(['PLA-PRETO-01', 'PLA-PRETO-02']);
	});
});

describe('/filamentos', () => {
	/**
	 * A tela do TIPO não existe mais, mas foi exatamente para essa URL que o
	 * dono foi procurar o preço. Um 404 aqui seria a mesma confusão de antes.
	 */
	it('redireciona para a tela única, levando a busca junto', async () => {
		const evento = { url: new URL('http://localhost/filamentos?q=petg') } as never;
		await expect(filamentos.load(evento)).rejects.toMatchObject({
			status: 302,
			location: '/rolos?q=petg'
		});
	});

	/**
	 * O status é parte do plano de reversão, não detalhe de protocolo: um 301
	 * fica cacheado no navegador para sempre, e depois de restaurar o backup e
	 * voltar para a `main` o Victor nunca mais chegaria na tela real.
	 */
	it('redireciona com 302, que o navegador não guarda para sempre', async () => {
		const evento = { url: new URL('http://localhost/filamentos') } as never;
		await expect(filamentos.load(evento)).rejects.toMatchObject({ status: 302 });
	});
});
