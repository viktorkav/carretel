/**
 * O que a action `criar` devolve para a TELA DE RESULTADO do registro.
 *
 * A tela mostra o custo com as quatro parcelas e o saldo do rolo antes e
 * depois. Os números vêm do servidor — do registro gravado e de
 * `estoqueDoRolo` —, e é isso que estes testes seguram: a resposta bate com o
 * que foi para o banco, e não com uma conta refeita na tela.
 *
 * O cenário é o da prova sintética do piloto: rolo de R$ 100,00 / 1.000 g com
 * pesagem de 700 g e duas impressões depois dela (40 g e 20 g) → 640 g;
 * registrar 50 g em 1h30 → R$ 5,93 e 590 g.
 */
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';

process.env.DATABASE_PATH = join(mkdtempSync(join(tmpdir(), 'carretel-resultado-')), 'teste.sqlite');

const { db, schema } = await import('$lib/server/db');
migrate(db, { migrationsFolder: './drizzle' });

const { registrarImpressao } = await import('$lib/server/repo');
const { novoEnvio, CAMPO_ENVIO } = await import('$lib/server/envio');
const impressoes = (await import('./impressoes/+page.server')).actions;

const DIA = 86_400_000;
let impressoraId: number;
let roloId: number;

beforeEach(() => {
	db.delete(schema.impressao).run();
	db.delete(schema.afericao).run();
	db.delete(schema.manutencao).run();
	db.delete(schema.rolo).run();
	db.delete(schema.impressora).run();
	db.delete(schema.config).run();
	db.insert(schema.config).values({ id: 1, tarifaKwhCents: 100 }).run();

	impressoraId = db
		.insert(schema.impressora)
		.values({
			nome: 'Impressora de teste',
			modelo: 'Modelo fictício',
			precoCompraCents: 300_000,
			vidaUtilHoras: 6000,
			potenciaMediaW: 120
		})
		.returning()
		.get().id;

	roloId = db
		.insert(schema.rolo)
		.values({
			codigo: 'TESTE-PLA-CINZA',
			marca: 'Marca de teste',
			material: 'PLA',
			cor: 'Cinza',
			corHex: '#7C8798',
			densidade: 1.24,
			precoPagoCents: 10_000,
			pesoLiquidoInicialG: 1000,
			pesoCarretelG: 250,
			status: 'aberto'
		})
		.returning()
		.get().id;

	const agora = Date.now();
	db.insert(schema.afericao)
		.values({ roloId, pesoLiquidoG: 700, dataEm: new Date(agora - 7 * DIA) })
		.run();
	for (const [dias, gramas, duracaoS] of [
		[3, 40, 3600],
		[1, 20, 1800]
	] as const) {
		registrarImpressao(db, {
			nomeLivre: 'peça anterior',
			impressoraId,
			roloId,
			inicioEm: agora - dias * DIA,
			duracaoS,
			gramas,
			status: 'sucesso',
			motivoFalha: null,
			camadaMm: null,
			paredes: null,
			infillPct: null,
			finalidade: 'estudio',
			origem: 'manual'
		});
	}
});

type Retorno = {
	status?: number;
	sucesso?: boolean;
	repetido?: boolean;
	registro?: Record<string, number | string>;
	saldo?: Record<string, number | string | null> | null;
};

async function criar(campos: Record<string, string>): Promise<Retorno> {
	const corpo = new FormData();
	const completos: Record<string, string> = {
		nomeLivre: 'Suporte de teste',
		impressoraId: String(impressoraId),
		roloId: String(roloId),
		gramas: '50',
		duracao: '1:30',
		status: 'sucesso',
		finalidade: 'estudio',
		[CAMPO_ENVIO]: novoEnvio(),
		...campos
	};
	for (const [k, v] of Object.entries(completos)) corpo.set(k, v);
	const request = new Request('http://localhost/impressoes?/criar', { method: 'POST', body: corpo });
	return (await impressoes.criar!({ request } as never)) as Retorno;
}

describe('resultado do registro de impressão', () => {
	it('devolve o custo gravado, parcela por parcela, e o total de R$ 5,93', async () => {
		const r = await criar({});
		expect(r.sucesso).toBe(true);
		expect(r.registro).toMatchObject({
			nomeLivre: 'Suporte de teste',
			gramas: 50,
			duracaoS: 5400,
			finalidade: 'estudio',
			custoFilamentoCents: 500,
			custoEnergiaCents: 18,
			custoDepreciacaoCents: 75,
			custoManutencaoCents: 0,
			custoTotalCents: 593
		});
		// é o MESMO número que ficou no banco, não uma segunda conta
		const gravada = db
			.select()
			.from(schema.impressao)
			.where(eq(schema.impressao.id, Number(r.registro!.id)))
			.get()!;
		expect(gravada.custoTotalCents).toBe(593);
	});

	it('devolve o saldo do rolo antes e depois: 640 g → 590 g', async () => {
		const r = await criar({});
		expect(r.saldo).toMatchObject({
			roloId,
			codigo: 'TESTE-PLA-CINZA',
			corHex: '#7C8798',
			pesoLiquidoInicialG: 1000,
			antesG: 640,
			depoisG: 590
		});
	});

	it('não inventa baixa: impressão datada antes da última pesagem deixa o saldo igual', async () => {
		const antigo = new Date(Date.now() - 20 * DIA);
		const p = (n: number) => String(n).padStart(2, '0');
		const campo = `${antigo.getFullYear()}-${p(antigo.getMonth() + 1)}-${p(antigo.getDate())}T10:00`;
		const r = await criar({ inicioEm: campo });
		expect(r.sucesso).toBe(true);
		expect(r.saldo).toMatchObject({ antesG: 640, depoisG: 640 });
	});

	it('envio repetido continua sem gravar nem devolver um segundo registro', async () => {
		const envio = novoEnvio();
		const primeira = await criar({ [CAMPO_ENVIO]: envio });
		const segunda = await criar({ [CAMPO_ENVIO]: envio });
		expect(primeira.registro).toBeDefined();
		expect(segunda.repetido).toBe(true);
		expect(segunda.registro).toBeUndefined();
		expect(db.select().from(schema.impressao).all()).toHaveLength(3);
	});

	it('recusa continua sendo recusa: sem registro e sem baixa', async () => {
		const r = await criar({ gramas: 'abc' });
		expect(r.status).toBe(400);
		expect(db.select().from(schema.impressao).all()).toHaveLength(2);
	});
});
