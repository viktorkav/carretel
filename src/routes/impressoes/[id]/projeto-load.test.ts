/**
 * A FIAÇÃO do card "Mesmo arquivo de projeto".
 *
 * As regras estão em `src/lib/projeto.test.ts`, sem banco. O que só aparece
 * aqui: o `load` converter o `Date` do Drizzle para epoch antes de ordenar
 * (comparar objetos deixaria a ordem por data ao acaso), ler a capa pela
 * coluna, levar as duas colunas de plate até a tela — e, o mais importante,
 * **não devolver total de projeto nenhum**.
 */
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { beforeEach, describe, expect, it } from 'vitest';

process.env.DATABASE_PATH = join(mkdtempSync(join(tmpdir(), 'carretel-projeto-')), 'teste.sqlite');

const { db, schema } = await import('$lib/server/db');
migrate(db, { migrationsFolder: './drizzle' });

const { load } = await import('./+page.server');

let idImpressora = 0;
let idRolo = 0;

interface Semente {
	capa?: string | null;
	indicePlate?: number | null;
	projetoIdNuvem?: string | null;
	status?: 'sucesso' | 'falha' | 'cancelada';
}

function semear(
	nome: string,
	quando: number,
	cents: number,
	gramas: number,
	extra: Semente = {}
) {
	const [linha] = db
		.insert(schema.impressao)
		.values({
			nomeLivre: nome,
			impressoraId: idImpressora,
			roloId: idRolo,
			inicioEm: new Date(quando),
			duracaoS: 3600,
			gramas,
			status: extra.status ?? 'sucesso',
			finalidade: 'outro',
			origem: 'nuvem',
			custoTotalCents: cents,
			imagemPath: extra.capa ?? null,
			indicePlate: extra.indicePlate ?? null,
			projetoIdNuvem: extra.projetoIdNuvem ?? null
		})
		.returning()
		.all();
	return linha.id;
}

interface Irma {
	corHex: string | null;
	id: number;
	nomeLivre: string;
	inicioEm: number;
	gramas: number;
	custoTotalCents: number;
	temImagem: boolean;
	indicePlate: number | null;
	projetoIdNuvem: string | null;
}

interface Retorno {
	impressao: { id: number };
	projeto: {
		plateAtual: number | null;
		mesmaPlate: Irma[];
		outrasPlates: Irma[];
		semIndice: Irma[];
		variacao: { comparaveis: number; menorCents: number; maiorCents: number; pct: number | null } | null;
	};
}

const abrir = async (id: number) =>
	(await load({
		params: { id: String(id) },
		url: new URL(`http://192.0.2.10:3316/impressoes/${id}`)
	} as never)) as unknown as Retorno;

/** Todas as irmãs, nas três leituras. */
const irmas = (r: Retorno) => [
	...r.projeto.mesmaPlate,
	...r.projeto.outrasPlates,
	...r.projeto.semIndice
];

beforeEach(() => {
	db.delete(schema.impressao).run();
	db.delete(schema.rolo).run();
	db.delete(schema.impressora).run();

	const [imp] = db
		.insert(schema.impressora)
		.values({ nome: 'A1', modelo: 'Bambu Lab A1' })
		.returning()
		.all();
	idImpressora = imp.id;

	const [rol] = db
		.insert(schema.rolo)
		.values({ codigo: 'PLA-PRETO-01', marca: 'Bambu', material: 'PLA', cor: 'Preto', corHex: '#123456' })
		.returning()
		.all();
	idRolo = rol.id;
});

describe('load de /impressoes/[id] — mesmo arquivo de projeto', () => {
	it('acha as outras tarefas do mesmo nome, da mais recente para a mais antiga', () => {
		const nome = 'MagicTray - Apple Magic Keyboard & Trackpad Tray';
		const a = semear(nome, 1_786_296_388_000, 605, 47.72);
		const b = semear(nome, 1_786_291_486_000, 689, 54.29);
		const c = semear(nome, 1_786_286_156_000, 752, 59.4);

		return abrir(a).then((r) => expect(irmas(r).map((i) => i.id)).toEqual([b, c]));
	});

	it('não traz a impressão aberta nem projeto de outro nome', async () => {
		const a = semear('MagicTray', 3_000, 605, 47);
		semear('MagicTray', 2_000, 689, 54);
		semear('Gridfinity', 1_000, 391, 29);

		const r = await abrir(a);
		expect(irmas(r).map((i) => i.id)).not.toContain(a);
		expect(irmas(r).map((i) => i.nomeLivre)).toEqual(['MagicTray']);
	});

	it('espaço no fim do nome não separa duas tarefas do mesmo arquivo', async () => {
		const a = semear('MagicTray', 2_000, 605, 47);
		semear('MagicTray ', 1_000, 689, 54);
		expect(irmas(await abrir(a))).toHaveLength(1);
	});

	it('cada irmã carrega a MASSA e o CUSTO dela, que é o que se compara', async () => {
		const a = semear('MagicTray', 2_000, 605, 47.72);
		semear('MagicTray', 1_000, 689, 54.29);

		const [irma] = irmas(await abrir(a));
		expect(irma.gramas).toBe(54.29);
		expect(irma.custoTotalCents).toBe(689);
	});

	it('⚠️ NÃO devolve total, soma nem média DO PROJETO — plate igual não é peça igual', async () => {
		// A trava do item, e ela continua valendo: plates diferentes do mesmo
		// arquivo são peças complementares, e somá-las produziria precisão que o
		// dado não tem. Se alguém reintroduzir um agregado de projeto, cai aqui.
		const a = semear('MagicTray', 3_000, 605, 47.72, { indicePlate: 1, projetoIdNuvem: '500' });
		semear('MagicTray', 2_000, 689, 54.29, { indicePlate: 2, projetoIdNuvem: '500' });
		semear('MagicTray', 1_000, 752, 59.4, { indicePlate: 3, projetoIdNuvem: '500' });

		const dados = (await abrir(a)) as unknown as Record<string, unknown>;
		for (const chave of Object.keys(dados)) {
			expect(chave).not.toMatch(/total(Peca|Projeto)|somad|media|maisBarat/i);
		}

		// E nenhum número devolvido pode ser a soma das três.
		const r = await abrir(a);
		const soma = 605 + 689 + 752;
		const numeros = JSON.stringify(r.projeto).match(/-?\d+(\.\d+)?/g) ?? [];
		expect(numeros.map(Number)).not.toContain(soma);
	});

	it('a irmã chega com a plate e o projeto dela, e sem agregado nenhum', async () => {
		const a = semear('MagicTray', 2_000, 605, 47.72, { indicePlate: 2, projetoIdNuvem: '500' });
		semear('MagicTray', 1_000, 689, 54.29, { indicePlate: 2, projetoIdNuvem: '500' });

		const [irma] = (await abrir(a)).projeto.mesmaPlate;
		expect(irma.corHex).toBe('#123456');
		expect(irma.indicePlate).toBe(2);
		expect(irma.projetoIdNuvem).toBe('500');
		expect(Object.keys(irma).sort()).toEqual(
			[
				'corHex',
				'custoTotalCents',
				'gramas',
				'id',
				'indicePlate',
				'inicioEm',
				'nomeLivre',
				'projetoIdNuvem',
				'status',
				'temImagem'
			].sort()
		);
	});

	it('sabe quais irmãs têm capa — é por ela que se confirma a plate com o olho', async () => {
		const a = semear('MagicTray', 3_000, 605, 47);
		semear('MagicTray', 2_000, 689, 54, { capa: 'nuvem/1153976538.png' });
		semear('MagicTray', 1_000, 752, 59);

		expect(irmas(await abrir(a)).map((i) => i.temImagem)).toEqual([true, false]);
	});

	it('a data das irmãs é epoch, e não o objeto que o Drizzle devolve', async () => {
		const a = semear('MagicTray', 2_000, 605, 47);
		semear('MagicTray', 1_000, 689, 54);
		expect(typeof irmas(await abrir(a))[0].inicioEm).toBe('number');
	});

	it('projeto impresso uma vez só não abre o card', async () => {
		const a = semear('Peça única', 1_000, 605, 47);
		expect(irmas(await abrir(a))).toEqual([]);
	});
});

describe('load de /impressoes/[id] — as duas leituras da plate', () => {
	it('separa a mesma plate das outras plates do mesmo projeto', async () => {
		const a = semear('MagicTray', 4_000, 605, 47, { indicePlate: 2, projetoIdNuvem: '500' });
		const mesma = semear('MagicTray', 3_000, 752, 59, { indicePlate: 2, projetoIdNuvem: '500' });
		const outra = semear('MagicTray', 2_000, 1_200, 90, { indicePlate: 5, projetoIdNuvem: '500' });

		const { projeto } = await abrir(a);
		expect(projeto.plateAtual).toBe(2);
		expect(projeto.mesmaPlate.map((i) => i.id)).toEqual([mesma]);
		expect(projeto.outrasPlates.map((i) => i.id)).toEqual([outra]);
	});

	it('a tarefa antiga cai em "plate não identificada", e não em nenhuma das duas', async () => {
		const a = semear('MagicTray', 3_000, 605, 47, { indicePlate: 2, projetoIdNuvem: '500' });
		const antiga = semear('MagicTray', 2_000, 689, 54);

		const { projeto } = await abrir(a);
		expect(projeto.semIndice.map((i) => i.id)).toEqual([antiga]);
		expect(projeto.mesmaPlate).toEqual([]);
		expect(projeto.outrasPlates).toEqual([]);
	});

	it('agrupa pelo IDENTIFICADOR do projeto, não pelo nome, quando ele existe dos dois lados', async () => {
		const a = semear('MagicTray', 3_000, 605, 47, { indicePlate: 1, projetoIdNuvem: '500' });
		const renomeada = semear('Magic Tray v2', 2_000, 689, 54, {
			indicePlate: 1,
			projetoIdNuvem: '500'
		});
		// Mesmo nome, outro projeto: não é irmã.
		semear('MagicTray', 1_000, 999, 70, { indicePlate: 1, projetoIdNuvem: '900' });

		const { projeto } = await abrir(a);
		expect(projeto.mesmaPlate.map((i) => i.id)).toEqual([renomeada]);
		expect(projeto.outrasPlates).toEqual([]);
		expect(projeto.semIndice).toEqual([]);
	});

	it('linha antiga sem identificador continua reconhecida pelo nome', async () => {
		// O caso do banco em produção: 11 linhas sem os campos, e as próximas com.
		const a = semear('MagicTray', 2_000, 605, 47, { indicePlate: 2, projetoIdNuvem: '500' });
		const antiga = semear('MagicTray ', 1_000, 689, 54);

		expect(irmas(await abrir(a)).map((i) => i.id)).toEqual([antiga]);
	});

	it('a variação sai da mesma plate, e as falhas ficam fora dela', async () => {
		const a = semear('MagicTray', 4_000, 605, 47, { indicePlate: 2, projetoIdNuvem: '500' });
		semear('MagicTray', 3_000, 752, 59, { indicePlate: 2, projetoIdNuvem: '500' });
		semear('MagicTray', 2_000, 13, 1, {
			indicePlate: 2,
			projetoIdNuvem: '500',
			status: 'falha'
		});
		semear('MagicTray', 1_000, 5_000, 300, { indicePlate: 9, projetoIdNuvem: '500' });

		const { projeto } = await abrir(a);
		expect(projeto.variacao).toEqual({
			comparaveis: 2,
			menorCents: 605,
			maiorCents: 752,
			pct: 24.3
		});
	});

	it('sem plate identificada não há variação', async () => {
		const a = semear('MagicTray', 2_000, 605, 47);
		semear('MagicTray', 1_000, 752, 59);
		expect((await abrir(a)).projeto.variacao).toBeNull();
	});
});
