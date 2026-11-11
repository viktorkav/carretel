import { describe, expect, it } from 'vitest';
import { buscarNoCatalogo, normalizar, rotuloDoItem, type ItemCatalogo } from './busca';

function item(p: Partial<ItemCatalogo> & { id: string }): ItemCatalogo {
	return {
		cor: null,
		corAlias: null,
		corHex: null,
		marca: 'Bambu Lab',
		material: 'PLA Basic',
		polimero: 'PLA',
		densidade: 1.26,
		tempBico: 220,
		tempMesa: 55,
		codigoBambu: 'GFA00',
		...p
	};
}

const laranja = item({ id: '10300', cor: 'Laranja', corHex: '#FF6A13' });
const azulCeleste = item({
	id: '11603',
	cor: 'Azul-celeste',
	corHex: '#56B7E6',
	material: 'PLA Matte',
	codigoBambu: 'GFA01'
});
const plaBasicoSemCor = item({ id: 'GFA00' });
const petgGenerico = item({
	id: 'GFG99',
	marca: 'Generic',
	material: 'PETG',
	polimero: 'PETG',
	codigoBambu: 'GFG99',
	densidade: 1.27,
	tempBico: 255,
	tempMesa: 70
});
const acervo = [laranja, azulCeleste, plaBasicoSemCor, petgGenerico];

/** Atalho pros testes que só olham a lista, e não o total/truncamento. */
const busca = (itens: ItemCatalogo[], consulta: string, limite?: number) =>
	buscarNoCatalogo(itens, consulta, limite).itens;

describe('normalizar', () => {
	it('derruba caixa alta', () => {
		expect(normalizar('PLA Basic')).toBe('pla basic');
	});

	it('tira acento no meio da palavra sem partir a palavra em duas', () => {
		// Não basta remover: tem que remover ANTES de trocar pontuação por
		// espaço, senão "Abóbora" vira "ab bora" e nunca casa com "abobora".
		expect(normalizar('Abóbora')).toBe('abobora');
		expect(normalizar('Açúcar Cristal')).toBe('acucar cristal');
	});

	it('tira acento no fim da palavra', () => {
		expect(normalizar('Azul-celeste Café')).toBe('azul celeste cafe');
	});

	it('troca pontuação por espaço e junta espaços repetidos', () => {
		expect(normalizar('PLA-CF   /  Matte')).toBe('pla cf matte');
	});

	it('apara as pontas', () => {
		expect(normalizar('  PETG  ')).toBe('petg');
	});

	it('PRESERVA o "+" — é a única coisa que separa PLA Silk de PLA Silk+', () => {
		// Dobrar o "+" fazia os dois virarem a mesma chave de dedupe, e um rolo
		// de Silk+ era pendurado no filamento do Silk, com o código (GFA05 em
		// vez de GFA06) e a densidade errados.
		expect(normalizar('PLA Silk+')).toBe('pla silk+');
		expect(normalizar('PLA Silk+')).not.toBe(normalizar('PLA Silk'));
		expect(normalizar('PLA Tough+')).not.toBe(normalizar('PLA Tough'));
	});
});

describe('buscarNoCatalogo', () => {
	it('não devolve nada com consulta vazia — 414 itens na tela não é busca', () => {
		expect(busca(acervo, '')).toEqual([]);
		expect(busca(acervo, '   ')).toEqual([]);
	});

	it('acha por nome de cor', () => {
		expect(busca(acervo, 'laranja').map((i) => i.id)).toEqual(['10300']);
	});

	it('acha cor acentuada digitada sem acento e sem hífen', () => {
		expect(busca(acervo, 'azul celeste').map((i) => i.id)).toEqual(['11603']);
	});

	it('acha pelo código exato da Bambu, em caixa baixa', () => {
		expect(busca(acervo, 'gfg99').map((i) => i.id)).toEqual(['GFG99']);
	});

	it('acha por pedaço do código', () => {
		// "gfa0" casa com GFA00 (duas entradas) e com GFA01.
		expect(
			busca(acervo, 'gfa0')
				.map((i) => i.id)
				.sort()
		).toEqual(['10300', '11603', 'GFA00']);
	});

	it('acha cor acentuada quando o acento está no meio da palavra', () => {
		const abobora = item({ id: '10301', cor: 'Abóbora Laranja' });
		expect(busca([abobora, plaBasicoSemCor], 'abobora').map((i) => i.id)).toEqual([
			'10301'
		]);
	});

	it('acha pelo polímero quando o nome comercial não o contém', () => {
		// "Support W" é PLA e não diz PLA em lugar nenhum do nome. Sem o
		// polímero no texto buscável, procurar "pla" nunca acha o suporte.
		const suporte = item({
			id: 'GFS00',
			material: 'Support W',
			polimero: 'PLA',
			codigoBambu: 'GFS00'
		});
		expect(busca([suporte, petgGenerico], 'pla').map((i) => i.id)).toEqual(['GFS00']);
	});

	it('não quebra quando o item não tem polímero', () => {
		const semPolimero = item({ id: 'x', polimero: null, cor: 'Verde' });
		expect(busca([semPolimero], 'verde').map((i) => i.id)).toEqual(['x']);
	});

	it('exige TODOS os termos, não qualquer um', () => {
		// "pla" casa com três itens; "laranja" só com um. O E é o que faz a
		// busca servir pra quem tem o rolo na mão e lê o rótulo inteiro.
		expect(busca(acervo, 'pla laranja').map((i) => i.id)).toEqual(['10300']);
	});

	it('junta termos de campos diferentes no mesmo E', () => {
		expect(busca(acervo, 'bambu matte celeste').map((i) => i.id)).toEqual(['11603']);
	});

	it('devolve vazio quando um dos termos não casa com nada', () => {
		expect(busca(acervo, 'pla roxo')).toEqual([]);
	});

	it('põe o código exato na frente de tudo', () => {
		const outra = item({ id: '10301', cor: 'GFA00 falso', codigoBambu: 'GFA77' });
		const r = busca([outra, plaBasicoSemCor, laranja], 'gfa00');
		expect(r[0].id).toBe('GFA00');
	});

	it('põe item com cor na frente do item sem cor da mesma linha', () => {
		const r = busca([plaBasicoSemCor, laranja], 'pla basic');
		expect(r.map((i) => i.id)).toEqual(['10300', 'GFA00']);
	});

	it('ordena o empate por marca, material e cor', () => {
		const a = item({ id: 'a', cor: 'Verde', material: 'PLA Silk' });
		const b = item({ id: 'b', cor: 'Amarelo', material: 'PLA Silk' });
		const c = item({ id: 'c', cor: 'Azul', material: 'PLA Basic' });
		expect(busca([a, b, c], 'bambu').map((i) => i.id)).toEqual(['c', 'b', 'a']);
	});

	it('respeita o limite', () => {
		const muitos = Array.from({ length: 50 }, (_, n) =>
			item({ id: `x${n}`, cor: `Cor ${n}` })
		);
		expect(busca(muitos, 'pla', 8)).toHaveLength(8);
	});

	it('corta pelo limite DEPOIS de ordenar, não antes', () => {
		const ruim = item({ id: 'ruim', cor: 'Zebra' });
		const bom = item({ id: 'GFA00' });
		expect(busca([ruim, bom], 'gfa00', 1).map((i) => i.id)).toEqual(['GFA00']);
	});

	it('separa PLA Silk de PLA Silk+ na busca', () => {
		const silk = item({ id: 's1', cor: 'Azul', material: 'PLA Silk', codigoBambu: 'GFA05' });
		const silkMais = item({
			id: 's2',
			cor: 'Azul',
			material: 'PLA Silk+',
			codigoBambu: 'GFA06'
		});
		// "silk+" é específico; "silk" continua trazendo os dois.
		expect(busca([silk, silkMais], 'silk+').map((i) => i.id)).toEqual(['s2']);
		expect(busca([silk, silkMais], 'silk').map((i) => i.id).sort()).toEqual(['s1', 's2']);
	});

	it('acha pelo alias em inglês a cor que só existe em português', () => {
		// 74 das 314 cores da fonte não têm nome em pt. O inglês é a única
		// língua que cobre todas, então ele vira alias buscável.
		const preto = item({ id: '10101', cor: 'Preto', corAlias: 'Black preto' });
		expect(busca([preto, petgGenerico], 'black').map((i) => i.id)).toEqual(['10101']);
	});

	it('o alias não aparece no rótulo exibido', () => {
		const preto = item({ id: '10101', cor: 'Preto', corAlias: 'Black preto' });
		expect(rotuloDoItem(preto)).toBe('Bambu Lab · PLA Basic · Preto');
	});
});

describe('buscarNoCatalogo — total e truncamento', () => {
	const muitos = Array.from({ length: 50 }, (_, n) => item({ id: `x${n}`, cor: `Cor ${n}` }));

	it('conta TODOS os casados, não só os que couberam', () => {
		const r = buscarNoCatalogo(muitos, 'pla', 8);
		expect(r.itens).toHaveLength(8);
		expect(r.total).toBe(50);
	});

	it('avisa que truncou quando sobrou item de fora', () => {
		expect(buscarNoCatalogo(muitos, 'pla', 8).truncado).toBe(true);
	});

	it('não avisa truncamento quando tudo coube', () => {
		const r = buscarNoCatalogo(muitos, 'pla', 50);
		expect(r.truncado).toBe(false);
		expect(r.total).toBe(50);
	});

	it('consulta vazia devolve total zero e sem truncamento', () => {
		expect(buscarNoCatalogo(muitos, '')).toEqual({ itens: [], total: 0, truncado: false });
	});
});
