import { describe, expect, it } from 'vitest';
import { buscarNoCatalogo, chaveFilamento, type Catalogo, type ItemCatalogo } from './busca';
import { validarCatalogo } from './validacao';

/**
 * O catálogo real não é mais dado versionado: ele é gerado no volume, e testar
 * contra ele significaria testes que dependem de rede e de uma máquina ter
 * rodado o gerador. Então o que entra aqui é **fixture fixa e conferida**.
 *
 * As três primeiras linhas foram conferidas campo a campo contra
 * bambulab/BambuStudio no commit a803118…, e valem como âncora de valor: se a
 * densidade do PLA Basic deixar de ser 1.26 no gerador, é aqui que aparece.
 * O resto da suíte é estrutura, e estrutura é cega a valor.
 */
const GFA00: ItemCatalogo = {
	id: 'GFA00',
	cor: null,
	corAlias: null,
	corHex: null,
	marca: 'Bambu Lab',
	material: 'PLA Basic',
	polimero: 'PLA',
	densidade: 1.26,
	tempBico: 220,
	tempMesa: 55,
	codigoBambu: 'GFA00'
};

const GFA01: ItemCatalogo = {
	id: 'GFA01',
	cor: null,
	corAlias: null,
	corHex: null,
	marca: 'Bambu Lab',
	material: 'PLA Matte',
	polimero: 'PLA',
	densidade: 1.32,
	tempBico: 220,
	tempMesa: 55,
	codigoBambu: 'GFA01'
};

/** A mesa é 70 porque `Generic PETG @base` sobrescreve o 80 herdado de
 *  `fdm_filament_pet`. Se a cadeia de `inherits` for resolvida na ordem
 *  errada, este número vira 80. */
const GFG99: ItemCatalogo = {
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

const PRETO: ItemCatalogo = {
	...GFA00,
	id: '10101',
	cor: 'Preto',
	corAlias: 'Black preto',
	corHex: '#000000'
};

/** Cor sem nome em português na fonte: o exibido é o inglês e o alias traz o
 *  português, senão o rolo some de quem busca "branco". */
const SO_INGLES: ItemCatalogo = {
	...GFA00,
	id: '30103',
	cor: 'White',
	corAlias: 'branco',
	corHex: '#FFFFFF'
};

const SILK: ItemCatalogo = {
	...GFA00,
	id: '13601',
	material: 'PLA Silk',
	codigoBambu: 'GFA05',
	densidade: 1.32,
	cor: 'Azul',
	corAlias: 'Blue azul',
	corHex: '#0A2989'
};

const SILK_MAIS: ItemCatalogo = { ...SILK, id: '13604', material: 'PLA Silk+', codigoBambu: 'GFA06' };

const catalogoValido: Catalogo = {
	fonte: 'bambulab/BambuStudio · resources/profiles/BBL/filament',
	licencaFonte: 'AGPL-3.0',
	commit: 'a803118282d8208361b4584b720af175dd1a9b4e',
	geradoEm: '2026-08-10',
	itens: [GFA00, GFA01, GFG99, PRETO, SO_INGLES, SILK, SILK_MAIS]
};

const comItens = (itens: ItemCatalogo[]): Catalogo => ({ ...catalogoValido, itens });

describe('linhas douradas — valores conferidos contra o BambuStudio', () => {
	it('PLA Basic (GFA00) é 1.26 g/cm³, bico 220, mesa 55', () => {
		expect([GFA00.densidade, GFA00.tempBico, GFA00.tempMesa]).toEqual([1.26, 220, 55]);
	});

	it('PLA Matte (GFA01) é 1.32 g/cm³, bico 220, mesa 55', () => {
		expect([GFA01.densidade, GFA01.tempBico, GFA01.tempMesa]).toEqual([1.32, 220, 55]);
	});

	it('Generic PETG (GFG99) é 1.27 g/cm³, bico 255, mesa 70', () => {
		expect([GFG99.densidade, GFG99.tempBico, GFG99.tempMesa]).toEqual([1.27, 255, 70]);
	});

	it('PLA Silk e PLA Silk+ são produtos distintos, com códigos distintos', () => {
		expect(SILK.codigoBambu).toBe('GFA05');
		expect(SILK_MAIS.codigoBambu).toBe('GFA06');
		expect(chaveFilamento({ ...SILK, cor: SILK.cor! })).not.toBe(
			chaveFilamento({ ...SILK_MAIS, cor: SILK_MAIS.cor! })
		);
	});

	it('o catálogo de referência passa na validação', () => {
		expect(validarCatalogo(catalogoValido)).toEqual({ ok: true, catalogo: catalogoValido });
	});
});

describe('validarCatalogo — cabeçalho', () => {
	it('recusa o que não é objeto', () => {
		expect(validarCatalogo(null).ok).toBe(false);
		expect(validarCatalogo('{}').ok).toBe(false);
	});

	it('recusa sem fonte declarada', () => {
		const r = validarCatalogo({ ...catalogoValido, fonte: '' });
		expect(r).toEqual({ ok: false, erro: 'sem campo `fonte`' });
	});

	it('recusa sem licença declarada', () => {
		expect(validarCatalogo({ ...catalogoValido, licencaFonte: '' }).ok).toBe(false);
	});

	it('exige commit de origem no formato de SHA — é o que diz qual catálogo está em uso', () => {
		expect(validarCatalogo({ ...catalogoValido, commit: 'master' }).ok).toBe(false);
		expect(validarCatalogo({ ...catalogoValido, commit: '' }).ok).toBe(false);
	});

	it('recusa catálogo sem item nenhum', () => {
		expect(validarCatalogo(comItens([]))).toEqual({ ok: false, erro: 'sem itens' });
	});
});

describe('validarCatalogo — itens', () => {
	it('recusa item sem código Bambu', () => {
		const r = validarCatalogo(comItens([{ ...GFA00, codigoBambu: '' }]));
		expect(r.ok).toBe(false);
	});

	it('recusa código fora do padrão GF+letras+dígitos', () => {
		expect(validarCatalogo(comItens([{ ...GFA00, codigoBambu: 'XYZ1' }])).ok).toBe(false);
	});

	it('aceita o código de parceiro, que foge do formato de 5 caracteres', () => {
		const sunlu = { ...GFA00, id: 'GFSNL02', codigoBambu: 'GFSNL02' };
		expect(validarCatalogo(comItens([sunlu])).ok).toBe(true);
	});

	it('recusa densidade zerada ou negativa — ela vira estimativa de estoque', () => {
		expect(validarCatalogo(comItens([{ ...GFA00, densidade: 0 }])).ok).toBe(false);
		expect(validarCatalogo(comItens([{ ...GFA00, densidade: -1 }])).ok).toBe(false);
	});

	it('recusa densidade não numérica vinda de JSON torto', () => {
		const torto = { ...GFA00, densidade: '1.26' } as unknown as ItemCatalogo;
		expect(validarCatalogo(comItens([torto])).ok).toBe(false);
	});

	it('recusa bico e mesa trocados — o bico é sempre mais quente', () => {
		const trocado = { ...GFA00, tempBico: 55, tempMesa: 220 };
		expect(validarCatalogo(comItens([trocado])).ok).toBe(false);
	});

	it('recusa hex que não é hex — o valor vai pra style="background-color"', () => {
		const r = validarCatalogo(comItens([{ ...PRETO, corHex: 'red; content: url(x)' }]));
		expect(r.ok).toBe(false);
	});

	it('recusa id repetido — id é a chave que o formulário manda de volta', () => {
		const r = validarCatalogo(comItens([GFA00, { ...GFA01, id: 'GFA00' }]));
		expect(r).toEqual({ ok: false, erro: 'id repetido: GFA00' });
	});

	it('CRITICAL: recusa duas linhas de produto que casam na mesma chave', () => {
		// Foi exatamente assim que PLA Silk e PLA Silk+ viraram o mesmo
		// filamento. Se um dia a normalização voltar a dobrar o "+", ou a Bambu
		// batizar dois produtos igual, o catálogo é recusado em vez de
		// pendurar rolo no código errado.
		const colidindo = [SILK, { ...SILK_MAIS, material: 'PLA Silk' }];
		const r = validarCatalogo(comItens(colidindo));
		expect(r.ok).toBe(false);
		expect(r.ok === false && r.erro).toContain('GFA05');
		expect(r.ok === false && r.erro).toContain('GFA06');
	});

	it('não confunde a entrada sem cor com as entradas coloridas do mesmo código', () => {
		expect(validarCatalogo(comItens([GFA00, PRETO, SO_INGLES])).ok).toBe(true);
	});
});

describe('busca sobre a fixture', () => {
	const itens = catalogoValido.itens;

	it('"preto" acha a cor nomeada em português', () => {
		expect(buscarNoCatalogo(itens, 'preto').itens.map((i) => i.id)).toEqual(['10101']);
	});

	it('"branco" acha a cor que a fonte só tem em inglês', () => {
		// Sem o alias, este rolo some da busca em português.
		expect(buscarNoCatalogo(itens, 'branco').itens.map((i) => i.id)).toEqual(['30103']);
	});

	it('"black" acha a cor nomeada em português', () => {
		expect(buscarNoCatalogo(itens, 'black').itens.map((i) => i.id)).toEqual(['10101']);
	});

	it('"silk+" isola o Silk+, e "silk" traz os dois', () => {
		expect(buscarNoCatalogo(itens, 'silk+').itens.map((i) => i.id)).toEqual(['13604']);
		expect(buscarNoCatalogo(itens, 'silk').itens).toHaveLength(2);
	});

	it('o código digitado no rótulo vem em primeiro', () => {
		expect(buscarNoCatalogo(itens, 'GFG99').itens[0].id).toBe('GFG99');
	});
});

it('aceita biblioteca OFD sem código Bambu e temperaturas desconhecidas', () => {
 const item = { ...GFA00, fonteCatalogo: 'ofd', codigoBambu: '', tempBico: null, tempMesa: null };
 expect(validarCatalogo({ fonte: 'OFD', licencaFonte: 'CC0', commit: 'a'.repeat(40), geradoEm: '2026-09-05', itens: [item] }).ok).toBe(true);
});

it('aceita curadoria oficial com densidade estimada explicitamente sinalizada', () => {
 const item = { ...GFA00, fonteCatalogo: 'manual', fonteUrl: 'https://shop.multfila.com.br/produtos/pla/', densidadeEstimada: true, codigoBambu: '', tempBico: null, tempMesa: null };
 expect(validarCatalogo({ fonte: 'Curadoria', licencaFonte: 'Fontes oficiais', commit: 'a'.repeat(40), geradoEm: '2026-09-05', itens: [item] }).ok).toBe(true);
});

it.each([{ codigosCorBambu: {} }, { codigosCorBambu: [123] }, { corAlias: 3 }, { densidadeEstimada: 'false' }, { fonteCatalogo: 'desconhecida' }])('recusa metadados malformados que quebrariam a biblioteca: %j', (campos) => {
 expect(validarCatalogo({ fonte: 'teste', licencaFonte: 'teste', commit: 'a'.repeat(40), geradoEm: '2026-09-05', itens: [{ ...PRETO, ...campos }] }).ok).toBe(false);
});

describe('imagens do catálogo: https de terceiro ou arquivo da própria instalação', () => {
 const catalogoCom = (campos: Record<string, unknown>) => validarCatalogo({ fonte: 'teste', licencaFonte: 'teste', commit: 'a'.repeat(40), geradoEm: '2026-09-05', itens: [{ ...PRETO, ...campos }] });

 it('aceita a imagem e o logotipo no caminho local do contrato', () => {
  expect(catalogoCom({ imagemUrl: '/midia/catalogo/demo-pla-cinza.webp' }).ok).toBe(true);
  expect(catalogoCom({ logoUrl: '/midia/catalogo/marca-demo.png' }).ok).toBe(true);
 });

 it('continua aceitando https, como antes', () => {
  expect(catalogoCom({ imagemUrl: 'https://loja.exemplo.invalid/rolo.jpg', logoUrl: 'https://loja.exemplo.invalid/logo.png' }).ok).toBe(true);
 });

 it.each([
  'demo-pla-cinza.webp',
  './demo-pla-cinza.webp',
  '/demo-pla-cinza.webp',
  '/midia/catalogo/../../etc/passwd',
  '/midia/catalogo/pasta/demo.webp',
  '/midia/catalogo/demo.svg',
  '/midia/rolo/n1-corpo.webp',
  '//exemplo.invalid/midia/catalogo/a.png',
  'http://loja.exemplo.invalid/rolo.jpg',
  'javascript:alert(1)',
  ''
 ])('recusa imagem em %j', (valor) => {
  expect(catalogoCom({ imagemUrl: valor }).ok).toBe(false);
  expect(catalogoCom({ logoUrl: valor }).ok).toBe(false);
 });

 it('link de produto e de fonte continuam exigindo https: caminho local não é link para fora', () => {
  expect(catalogoCom({ produtoUrl: '/midia/catalogo/demo-pla-cinza.webp' }).ok).toBe(false);
  expect(catalogoCom({ fonteUrl: '/midia/catalogo/demo-pla-cinza.webp' }).ok).toBe(false);
  expect(catalogoCom({ produtoUrl: 'https://loja.exemplo.invalid/produto' }).ok).toBe(true);
 });
});
