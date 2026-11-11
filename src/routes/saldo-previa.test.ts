/**
 * REGRESSÃO — a prévia do saldo na conferência do registro.
 *
 * O domínio (`calcularRestante`) só desconta do saldo a impressão cujo início
 * é POSTERIOR à última pesagem do rolo. A conferência prometia sempre
 * `saldo − gramas`. Estes testes renderizam a tela de verdade (o componente,
 * com os dados que o `load` da rota entrega) e depois registram a mesma
 * impressão pela action: o que a conferência promete tem de ser o que o
 * servidor faz.
 *
 * Banco próprio deste arquivo; nada aqui compara texto de código-fonte.
 */
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { render } from 'svelte/server';
import { beforeEach, describe, expect, it } from 'vitest';

process.env.DATABASE_PATH = join(mkdtempSync(join(tmpdir(), 'carretel-previa-')), 'teste.sqlite');

const { db, schema } = await import('$lib/server/db');
migrate(db, { migrationsFolder: './drizzle' });

const { registrarImpressao, estoqueDoRolo } = await import('$lib/server/repo');
const { novoEnvio, CAMPO_ENVIO } = await import('$lib/server/envio');
const { paraCampoDataHora } = await import('$lib/formato');
const nova = await import('./impressoes/nova/+page.server');
const NovaImpressao = (await import('$lib/componentes/NovaImpressao.svelte')).default;

const MIN = 60_000;
const DIA = 86_400_000;
/** Pesagem num minuto cheio, para que o campo de data consiga dizer EXATAMENTE o mesmo instante. */
const PESAGEM = Math.floor((Date.now() - 7 * DIA) / MIN) * MIN;
let impressoraId: number;
let roloId: number;

function semear(opcoes: { pesagemG?: number | null; depois?: number[] } = {}) {
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
	const pesagemG = opcoes.pesagemG === undefined ? 700 : opcoes.pesagemG;
	if (pesagemG !== null) db.insert(schema.afericao).values({ roloId, pesoLiquidoG: pesagemG, dataEm: new Date(PESAGEM) }).run();
	(opcoes.depois ?? [40, 20]).forEach((gramas, n) =>
		registrarImpressao(db, { nomeLivre: `Peça anterior ${n + 1}`, impressoraId, roloId, inicioEm: PESAGEM + (n + 1) * DIA, duracaoS: 1800, gramas, status: 'sucesso', finalidade: 'estudio', origem: 'manual' })
	);
}

/** O texto que a pessoa lê na conferência, sem marcação. */
async function conferencia(valores: Record<string, string>) {
	const data = await nova.load({} as never);
	const { body } = render(NovaImpressao, { props: { data: data as never, form: { valores } } });
	const bloco = body.slice(body.indexOf('class="conferencia'));
	return bloco
		.slice(0, bloco.indexOf('</aside>'))
		.replace(/<!--.*?-->/gs, '')
		.replace(/<[^>]+>/g, ' ')
		.replace(/&nbsp;| /g, ' ')
		.replace(/\s+/g, ' ')
		.trim();
}

/** Registra de verdade, pela action, e devolve o saldo que o servidor passou a ter. */
async function registrar(valores: Record<string, string>) {
	const form = new FormData();
	form.set(CAMPO_ENVIO, novoEnvio());
	for (const [k, v] of Object.entries(valores)) form.set(k, v);
	const request = new Request('http://localhost/impressoes/nova?/criar', { method: 'POST', body: form });
	const r = (await nova.actions.criar!({ request } as never)) as { sucesso?: boolean };
	expect(r.sucesso).toBe(true);
	return estoqueDoRolo(db, roloId).restanteG;
}

const base = () => ({ nomeLivre: 'Suporte de teste', impressoraId: String(impressoraId), roloId: String(roloId), gramas: '50', duracao: '1:30', status: 'sucesso', finalidade: 'estudio' });

describe('conferência do registro: a prévia do saldo segue a regra do servidor', () => {
	beforeEach(() => semear());

	it('início em branco (agora), depois da pesagem: promete 590 g e o servidor entrega 590 g', async () => {
		const valores = { ...base(), inicioEm: '' };
		const texto = await conferencia(valores);
		expect(texto).toContain('640 g');
		expect(texto).toContain('590 g');
		expect(await registrar(valores)).toBe(590);
	});

	it('início informado depois da pesagem: promete 590 g e o servidor entrega 590 g', async () => {
		const valores = { ...base(), inicioEm: paraCampoDataHora(PESAGEM + MIN) };
		const texto = await conferencia(valores);
		expect(texto).toContain('590 g');
		expect(await registrar(valores)).toBe(590);
	});

	it('início ANTES da pesagem: o servidor conserva 640 g, e a conferência não promete 590 g', async () => {
		const valores = { ...base(), inicioEm: paraCampoDataHora(PESAGEM - DIA) };
		const texto = await conferencia(valores);
		expect(await registrar(valores)).toBe(640);
		expect(texto).not.toContain('590');
		expect(texto).toContain('640 g');
	});

	it('início IGUAL ao instante da pesagem: o servidor conserva 640 g, e a conferência não promete 590 g', async () => {
		const valores = { ...base(), inicioEm: paraCampoDataHora(PESAGEM) };
		const texto = await conferencia(valores);
		expect(await registrar(valores)).toBe(640);
		expect(texto).not.toContain('590');
		expect(texto).toContain('640 g');
	});

	it('um minuto antes da pesagem ainda não baixa; um minuto depois já baixa', async () => {
		const antes = await conferencia({ ...base(), inicioEm: paraCampoDataHora(PESAGEM - MIN) });
		const depois = await conferencia({ ...base(), inicioEm: paraCampoDataHora(PESAGEM + MIN) });
		expect(antes).not.toContain('590');
		expect(depois).toContain('590 g');
	});

	it('rolo sem pesagem nenhuma: qualquer data baixa, inclusive antiga', async () => {
		semear({ pesagemG: null, depois: [300, 60] });
		const valores = { ...base(), inicioEm: paraCampoDataHora(PESAGEM - 30 * DIA) };
		const texto = await conferencia(valores);
		expect(texto).toContain('590 g');
		expect(await registrar(valores)).toBe(590);
	});

	it('consumo com centésimos: a prévia mostra o mesmo décimo que o servidor grava', async () => {
		// 700 − 0,04 fica 700,0 na tela, mas o resíduo existe: +0,04 dá 699,92 → 699,9.
		semear({ depois: [0.04] });
		const valores = { ...base(), gramas: '0,04', inicioEm: '' };
		const texto = await conferencia(valores);
		const real = await registrar(valores);
		expect(real).toBe(699.9);
		expect(texto).toContain('699,9 g');
	});

	it('consumo maior que o saldo: a prévia para em 0 g, como o servidor', async () => {
		const valores = { ...base(), gramas: '900', inicioEm: '' };
		const texto = await conferencia(valores);
		expect(texto).toMatch(/→ 0 g/);
		expect(await registrar(valores)).toBe(0);
	});
});
