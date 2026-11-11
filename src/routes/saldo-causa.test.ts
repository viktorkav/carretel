/**
 * REGRESSÃO — por que o saldo não mudou, na tela de resultado do registro.
 *
 * A tela concluía "a data é anterior à última pesagem" sempre que o saldo de
 * antes e o de depois eram iguais. Igualdade de valores não prova a causa: um
 * rolo já em 0 g continua em 0 g (o saldo não fica negativo), e um consumo de
 * centésimos não muda um saldo guardado com uma casa decimal. Em nenhum dos
 * dois a data tem culpa — e o registro é permitido e continua sendo.
 *
 * Cada caso registra pela action de verdade e renderiza a tela de resultado
 * com a resposta dela. Banco próprio deste arquivo.
 */
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { eq } from 'drizzle-orm';
import { render } from 'svelte/server';
import { beforeEach, describe, expect, it } from 'vitest';

process.env.DATABASE_PATH = join(mkdtempSync(join(tmpdir(), 'carretel-causa-')), 'teste.sqlite');

const { db, schema } = await import('$lib/server/db');
migrate(db, { migrationsFolder: './drizzle' });

const { registrarImpressao, estoqueDoRolo } = await import('$lib/server/repo');
const { novoEnvio, CAMPO_ENVIO } = await import('$lib/server/envio');
const { paraCampoDataHora } = await import('$lib/formato');
const nova = await import('./impressoes/nova/+page.server');
const NovaImpressao = (await import('$lib/componentes/NovaImpressao.svelte')).default;

const MIN = 60_000;
const DIA = 86_400_000;
const PESAGEM = Math.floor((Date.now() - 7 * DIA) / MIN) * MIN;
let impressoraId: number;
let roloId: number;

function semear(pesagemG: number, depois: number[]) {
	db.delete(schema.impressao).run();
	db.delete(schema.afericao).run();
	db.delete(schema.manutencao).run();
	db.delete(schema.rolo).run();
	db.delete(schema.impressora).run();
	db.delete(schema.config).run();
	db.insert(schema.config).values({ id: 1, tarifaKwhCents: 100 }).run();
	impressoraId = db
		.insert(schema.impressora)
		.values({ nome: 'Impressora de teste', modelo: 'Modelo fictício', precoCompraCents: 300_000, vidaUtilHoras: 6000, potenciaMediaW: 120 })
		.returning()
		.get().id;
	roloId = db
		.insert(schema.rolo)
		.values({ codigo: 'TESTE-PLA-CINZA', marca: 'Marca de teste', material: 'PLA', cor: 'Cinza', corHex: '#7C8798', densidade: 1.24, precoPagoCents: 10_000, pesoLiquidoInicialG: 1000, pesoCarretelG: 250, status: 'aberto' })
		.returning()
		.get().id;
	db.insert(schema.afericao).values({ roloId, pesoLiquidoG: pesagemG, dataEm: new Date(PESAGEM) }).run();
	depois.forEach((gramas, n) =>
		registrarImpressao(db, { nomeLivre: `Peça anterior ${n + 1}`, impressoraId, roloId, inicioEm: PESAGEM + (n + 1) * DIA, duracaoS: 1800, gramas, status: 'sucesso', finalidade: 'estudio', origem: 'manual' })
	);
}

type Resposta = { sucesso?: boolean; registro?: { id: number; custoTotalCents: number; custoFilamentoCents: number }; saldo?: { antesG: number; depoisG: number } | null };

/** Registra pela action e devolve a resposta e o texto da tela de resultado feita com ela. */
async function registrar(campos: Record<string, string>) {
	const form = new FormData();
	form.set(CAMPO_ENVIO, novoEnvio());
	const valores = { nomeLivre: 'Suporte de teste', impressoraId: String(impressoraId), roloId: String(roloId), gramas: '50', duracao: '1:30', status: 'sucesso', finalidade: 'estudio', inicioEm: '', ...campos };
	for (const [k, v] of Object.entries(valores)) form.set(k, v);
	const request = new Request('http://localhost/impressoes/nova?/criar', { method: 'POST', body: form });
	const resposta = (await nova.actions.criar!({ request } as never)) as Resposta;
	const data = await nova.load({} as never);
	const { body } = render(NovaImpressao, { props: { data: data as never, form: resposta as never } });
	const tela = body
		.replace(/<!--.*?-->/gs, '')
		.replace(/<[^>]+>/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();
	return { resposta, tela };
}

/** A explicação temporal, em qualquer redação: fala de pesagem como motivo de o saldo não baixar. */
const culpaAData = (tela: string) => /(anterior|não é posterior|antes d)[^.]*pesagem/i.test(tela);

describe('resultado do registro: a causa do saldo que não mudou', () => {
	it('caso normal: 640 g → 590 g, R$ 5,93, sem explicação nenhuma de saldo parado', async () => {
		semear(700, [40, 20]);
		const { resposta, tela } = await registrar({});
		expect(resposta.saldo).toMatchObject({ antesG: 640, depoisG: 590 });
		expect(resposta.registro?.custoTotalCents).toBe(593);
		expect(tela).toContain('640 g');
		expect(tela).toContain('590 g');
		expect(culpaAData(tela)).toBe(false);
	});

	it('início anterior à pesagem: 640 g → 640 g, e AQUI a causa temporal é verdadeira e é dita', async () => {
		semear(700, [40, 20]);
		const { resposta, tela } = await registrar({ inicioEm: paraCampoDataHora(PESAGEM - DIA) });
		expect(resposta.saldo).toMatchObject({ antesG: 640, depoisG: 640 });
		expect(culpaAData(tela)).toBe(true);
	});

	it('início igual ao instante da pesagem: 640 g → 640 g, causa temporal dita', async () => {
		semear(700, [40, 20]);
		const { resposta, tela } = await registrar({ inicioEm: paraCampoDataHora(PESAGEM) });
		expect(resposta.saldo).toMatchObject({ antesG: 640, depoisG: 640 });
		expect(culpaAData(tela)).toBe(true);
	});

	it('rolo já em 0 g, impressão de agora com 50 g: é registrada, fica 0 g → 0 g, e a tela não culpa a data', async () => {
		semear(700, [700]);
		expect(estoqueDoRolo(db, roloId).restanteG).toBe(0);
		const { resposta, tela } = await registrar({});
		// O registro é permitido e gravado, com custo.
		expect(resposta.sucesso).toBe(true);
		const gravada = db.select().from(schema.impressao).where(eq(schema.impressao.id, resposta.registro!.id)).get();
		expect(gravada?.gramas).toBe(50);
		expect(resposta.registro?.custoFilamentoCents).toBe(500);
		expect(resposta.saldo).toMatchObject({ antesG: 0, depoisG: 0 });
		expect(culpaAData(tela)).toBe(false);
	});

	it('menor consumo que muda o saldo (0,1 g): 640 g → 639,9 g aparece como mudança', async () => {
		semear(700, [40, 20]);
		const { resposta, tela } = await registrar({ gramas: '0,1' });
		expect(resposta.saldo).toMatchObject({ antesG: 640, depoisG: 639.9 });
		expect(tela).toContain('639,9 g');
		expect(culpaAData(tela)).toBe(false);
	});

	it('consumo de centésimos (0,01 g), impressão de agora: saldo igual por arredondamento, e a tela não culpa a data', async () => {
		semear(700, [40, 20]);
		const { resposta, tela } = await registrar({ gramas: '0,01' });
		expect(resposta.sucesso).toBe(true);
		expect(resposta.saldo).toMatchObject({ antesG: 640, depoisG: 640 });
		expect(culpaAData(tela)).toBe(false);
	});

	it('consumo maior que o saldo, impressão de agora: 640 g → 0 g, sem culpar a data', async () => {
		semear(700, [40, 20]);
		const { resposta, tela } = await registrar({ gramas: '900' });
		expect(resposta.saldo).toMatchObject({ antesG: 640, depoisG: 0 });
		expect(culpaAData(tela)).toBe(false);
	});
});
