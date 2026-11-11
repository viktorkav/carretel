import { describe, expect, it } from 'vitest';
import { chaveDoProjeto, irmasDoProjeto, lerDoProjeto, mesmoProjeto } from './projeto';

function linha(id: number, nome: string, inicioEm: number, extra: Record<string, unknown> = {}) {
	return {
		id,
		nomeLivre: nome,
		inicioEm,
		gramas: 50,
		custoTotalCents: 600,
		status: 'sucesso' as const,
		temImagem: true,
		// O estado do histórico já gravado: os dois campos vazios. Cada teste que
		// fala de plate os declara.
		indicePlate: null as number | null,
		projetoIdNuvem: null as string | null,
		...extra
	};
}

describe('chaveDoProjeto', () => {
	it('mesmo nome, mesma chave', () => {
		expect(chaveDoProjeto('MagicTray')).toBe(chaveDoProjeto('MagicTray'));
	});

	it('espaço no fim não separa — a nuvem já mandou o nome assim', () => {
		expect(chaveDoProjeto('MagicTray ')).toBe(chaveDoProjeto('MagicTray'));
		expect(chaveDoProjeto('  MagicTray\t')).toBe(chaveDoProjeto('MagicTray'));
	});

	it('espaço dobrado no meio também não', () => {
		expect(chaveDoProjeto('Magic  Tray')).toBe(chaveDoProjeto('Magic Tray'));
	});

	it('caixa não separa', () => {
		expect(chaveDoProjeto('MAGICTRAY')).toBe(chaveDoProjeto('magictray'));
	});

	it('acento SEPARA: "peça" e "peca" são nomes diferentes', () => {
		expect(chaveDoProjeto('peça')).not.toBe(chaveDoProjeto('peca'));
	});

	it('nome em branco vira chave vazia', () => {
		expect(chaveDoProjeto('   ')).toBe('');
	});
});

describe('irmasDoProjeto', () => {
	const todas = [
		linha(12, 'MagicTray', 4_000),
		linha(13, 'MagicTray ', 3_000),
		linha(14, 'magictray', 2_000),
		linha(15, 'Gridfinity', 1_000)
	];

	it('traz as outras impressões do mesmo arquivo de projeto', () => {
		expect(irmasDoProjeto(12, todas).map((i) => i.id)).toEqual([13, 14]);
	});

	it('não traz a própria impressão', () => {
		expect(irmasDoProjeto(12, todas).map((i) => i.id)).not.toContain(12);
	});

	it('não traz projeto de outro nome', () => {
		expect(irmasDoProjeto(12, todas).map((i) => i.id)).not.toContain(15);
	});

	it('a mais recente primeiro', () => {
		expect(irmasDoProjeto(14, todas).map((i) => i.id)).toEqual([12, 13]);
	});

	it('projeto impresso uma vez só não tem irmã', () => {
		expect(irmasDoProjeto(15, todas)).toEqual([]);
	});

	it('id que não está na lista não devolve nada — e não lança', () => {
		expect(irmasDoProjeto(999, todas)).toEqual([]);
	});

	it('nome em branco não agrupa com outro nome em branco', () => {
		const vazias = [linha(1, '  ', 2_000), linha(2, '', 1_000)];
		expect(irmasDoProjeto(1, vazias)).toEqual([]);
	});

	it('devolve as linhas como vieram — sem somar custo nem massa', () => {
		// ⚠️ Este teste é a trava do item: NÃO existe total aqui. Nome repetido
		// significa mesmo ARQUIVO DE PROJETO, não mesma peça — a plate pode ter
		// outro conteúdo —, e somar produziria um número preciso e sem sentido.
		const irmas = irmasDoProjeto(12, todas);
		for (const i of irmas) {
			expect(Object.keys(i).sort()).toEqual(
				[
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
		}
	});
});

describe('mesmoProjeto — o identificador manda, o nome é o último recurso', () => {
	const comId = (id: number, nome: string, projeto: string | null) =>
		linha(id, nome, 1_000, { projetoIdNuvem: projeto });

	it('mesmo identificador é o mesmo projeto, ainda que o modelo tenha sido renomeado', () => {
		// É este o ganho do `designId`: ele sobrevive a renomear.
		expect(mesmoProjeto(comId(1, 'MagicTray', '500'), comId(2, 'Magic Tray v2', '500'))).toBe(true);
	});

	it('identificadores DIFERENTES separam, mesmo com o nome idêntico', () => {
		// E este é o outro ganho: dois projetos de nome parecido param de se
		// confundir. O nome não é consultado quando os dois lados têm id.
		expect(mesmoProjeto(comId(1, 'Gridfinity', '500'), comId(2, 'Gridfinity', '900'))).toBe(false);
	});

	it('quando falta o identificador de UM dos lados, o nome volta a ser tudo o que há', () => {
		// O caso real do dono: 11 linhas antigas sem id, e as novas com id. Se o
		// id presente de um lado bastasse para separar, a entrega de hoje faria o
		// card PERDER irmãs que ele já mostra.
		expect(mesmoProjeto(comId(1, 'MagicTray', '500'), comId(2, 'MagicTray', null))).toBe(true);
		expect(mesmoProjeto(comId(1, 'MagicTray', null), comId(2, 'MagicTray', '500'))).toBe(true);
	});

	it('sem identificador dos dois lados, é o nome — com espaço no fim dobrado', () => {
		expect(mesmoProjeto(comId(1, 'MagicTray ', null), comId(2, 'magictray', null))).toBe(true);
		expect(mesmoProjeto(comId(1, 'MagicTray', null), comId(2, 'Gridfinity', null))).toBe(false);
	});

	it('nome em branco não vira projeto nem quando os dois estão em branco', () => {
		expect(mesmoProjeto(comId(1, '  ', null), comId(2, '', null))).toBe(false);
	});
});

describe('lerDoProjeto — a mesma plate, e as outras', () => {
	const plate = (id: number, indice: number | null, cents: number, over: Record<string, unknown> = {}) =>
		linha(id, 'MagicTray', 10_000 - id, {
			indicePlate: indice,
			projetoIdNuvem: '500',
			custoTotalCents: cents,
			...over
		});

	it('separa a MESMA plate das outras plates do mesmo projeto', () => {
		const todas = [plate(1, 2, 605), plate(2, 2, 689), plate(3, 5, 1_200)];
		const l = lerDoProjeto(1, todas);

		expect(l.plateAtual).toBe(2);
		expect(l.mesmaPlate.map((i) => i.id)).toEqual([2]);
		expect(l.outrasPlates.map((i) => i.id)).toEqual([3]);
		expect(l.semIndice).toEqual([]);
	});

	it('irmã sem índice não é chutada para nenhum dos dois lados', () => {
		// A regra do item: para tarefa antiga, NÃO INVENTE. Ela não é "a mesma
		// plate" (não há prova) nem "outra plate" (também não há).
		const todas = [plate(1, 2, 605), plate(2, null, 689)];
		const l = lerDoProjeto(1, todas);

		expect(l.mesmaPlate).toEqual([]);
		expect(l.outrasPlates).toEqual([]);
		expect(l.semIndice.map((i) => i.id)).toEqual([2]);
	});

	it('quando a impressão ABERTA não tem índice, nenhuma irmã pode ser "a mesma"', () => {
		const todas = [plate(1, null, 605), plate(2, 2, 689), plate(3, 3, 700)];
		const l = lerDoProjeto(1, todas);

		expect(l.plateAtual).toBeNull();
		expect(l.mesmaPlate).toEqual([]);
		// As duas têm índice, mas sem o da atual não dá para dizer se coincide.
		expect(l.semIndice.map((i) => i.id)).toEqual([2, 3]);
		expect(l.outrasPlates).toEqual([]);
	});

	it('cada lista vem da mais recente para a mais antiga', () => {
		const todas = [
			linha(1, 'MagicTray', 1_000, { indicePlate: 2, projetoIdNuvem: '500' }),
			linha(2, 'MagicTray', 3_000, { indicePlate: 2, projetoIdNuvem: '500' }),
			linha(3, 'MagicTray', 2_000, { indicePlate: 2, projetoIdNuvem: '500' })
		];
		expect(lerDoProjeto(1, todas).mesmaPlate.map((i) => i.id)).toEqual([2, 3]);
	});

	it('id que não está na lista devolve leitura vazia, e não lança', () => {
		const l = lerDoProjeto(999, [plate(1, 2, 605)]);
		expect(l.mesmaPlate).toEqual([]);
		expect(l.outrasPlates).toEqual([]);
		expect(l.semIndice).toEqual([]);
		expect(l.variacao).toBeNull();
	});
});

describe('lerDoProjeto — a variação, que só existe dentro da MESMA plate', () => {
	const daPlate = (
		id: number,
		indice: number,
		cents: number,
		status: 'sucesso' | 'falha' | 'cancelada' = 'sucesso'
	) =>
		linha(id, 'MagicTray', 10_000 - id, {
			indicePlate: indice,
			projetoIdNuvem: '500',
			custoTotalCents: cents,
			status
		});

	it('mede entre a mais barata e a mais cara da mesma plate, incluindo a aberta', () => {
		const todas = [daPlate(1, 2, 605), daPlate(2, 2, 752)];
		const v = lerDoProjeto(1, todas).variacao!;

		expect(v.comparaveis).toBe(2);
		expect(v.menorCents).toBe(605);
		expect(v.maiorCents).toBe(752);
		// (752 − 605) / 605 = 24,3%
		expect(v.pct).toBeCloseTo(24.3, 1);
	});

	it('⚠️ NÃO soma: a variação é a distância entre duas rodadas, não o total gasto', () => {
		const todas = [daPlate(1, 2, 605), daPlate(2, 2, 752)];
		const v = lerDoProjeto(1, todas).variacao!;
		for (const valor of Object.values(v)) expect(valor).not.toBe(605 + 752);
	});

	it('plate diferente NUNCA entra na variação', () => {
		// A trava do domínio: plates diferentes são peças complementares. Se a de
		// R$ 12,00 (outra plate) entrasse, a variação viraria 98%.
		const todas = [daPlate(1, 2, 605), daPlate(2, 2, 752), daPlate(3, 5, 1_200)];
		const v = lerDoProjeto(1, todas).variacao!;
		expect(v.comparaveis).toBe(2);
		expect(v.maiorCents).toBe(752);
	});

	it('rodada que FALHOU fica fora da conta, e continua aparecendo na lista', () => {
		// Uma peça que abortou aos 3 min custa quase nada. Comparar R$ 0,13 com
		// R$ 7,52 e chamar de "variação de 5.700%" seria ruído, não leitura.
		const todas = [daPlate(1, 2, 605), daPlate(2, 2, 752), daPlate(3, 2, 13, 'falha')];
		const l = lerDoProjeto(1, todas);

		expect(l.variacao!.comparaveis).toBe(2);
		expect(l.variacao!.menorCents).toBe(605);
		expect(l.mesmaPlate.map((i) => i.id)).toEqual([2, 3]);
	});

	it('uma rodada bem-sucedida só não tem com o que variar', () => {
		const todas = [daPlate(1, 2, 605), daPlate(2, 2, 752, 'falha')];
		expect(lerDoProjeto(1, todas).variacao).toBeNull();
	});

	it('a própria impressão falhada não vira base de comparação', () => {
		const todas = [daPlate(1, 2, 13, 'falha'), daPlate(2, 2, 752)];
		expect(lerDoProjeto(1, todas).variacao).toBeNull();
	});

	it('sem plate identificada não há variação nenhuma', () => {
		const todas = [
			linha(1, 'MagicTray', 2_000, { custoTotalCents: 605 }),
			linha(2, 'MagicTray', 1_000, { custoTotalCents: 752 })
		];
		expect(lerDoProjeto(1, todas).variacao).toBeNull();
	});

	it('custo zerado não produz percentual infinito', () => {
		// Impressão registrada sem preço de rolo: o custo congelado é 0. Dividir
		// por ele daria Infinity na tela.
		const todas = [daPlate(1, 2, 0), daPlate(2, 2, 752)];
		const v = lerDoProjeto(1, todas).variacao!;
		expect(v.menorCents).toBe(0);
		expect(v.pct).toBeNull();
	});
});
