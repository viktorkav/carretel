import { describe, expect, it } from 'vitest';
import type { ItemCatalogo } from '$lib/catalogo/busca';
import { chaveFilamento } from '$lib/catalogo/busca';
import { dadosDoItem } from './catalogo';

const laranja: ItemCatalogo = {
	id: '10300',
	cor: 'Laranja',
	corAlias: 'Orange laranja',
	corHex: '#FF6A13',
	marca: 'Bambu Lab',
	material: 'PLA Basic',
	polimero: 'PLA',
	densidade: 1.26,
	tempBico: 220,
	tempMesa: 55,
	codigoBambu: 'GFA00'
};

const petgGenerico: ItemCatalogo = {
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

describe('dadosDoItem', () => {
	it('copia o item inteiro quando nada é sobrescrito', () => {
		const r = dadosDoItem(laranja, {});
		expect(r).toEqual({
			ok: true,
			dados: {
				marca: 'Bambu Lab',
				material: 'PLA Basic',
				cor: 'Laranja',
				corHex: '#FF6A13',
				densidade: 1.26,
				tempBico: 220,
				tempMesa: 55,
				codigoBambu: 'GFA00',
				fonteCatalogo: 'bambu'
			}
		});
	});

	it('marca a origem como bambu, não como manual', () => {
		const r = dadosDoItem(laranja, {});
		expect(r.ok && r.dados.fonteCatalogo).toBe('bambu');
	});

	it('aceita a cor digitada quando o item do catálogo é a linha sem cor', () => {
		const r = dadosDoItem(petgGenerico, { cor: 'Azul da 3D Fila' });
		expect(r.ok && r.dados.cor).toBe('Azul da 3D Fila');
	});

	it('recusa quando o item não tem cor e nada foi digitado', () => {
		expect(dadosDoItem(petgGenerico, {})).toEqual({
			ok: false,
			erro: 'este item do catálogo não tem cor; digite a cor do rolo'
		});
	});

	it('recusa cor só com espaço em branco', () => {
		expect(dadosDoItem(petgGenerico, { cor: '   ' }).ok).toBe(false);
	});

	it('a cor digitada ganha da cor do catálogo', () => {
		const r = dadosDoItem(laranja, { cor: 'Vermelho' });
		expect(r.ok && r.dados.cor).toBe('Vermelho');
	});

	it('derruba o hex quando a cor digitada é outra — hex laranja em rolo vermelho é mentira', () => {
		const r = dadosDoItem(laranja, { cor: 'Vermelho' });
		expect(r.ok && r.dados.corHex).toBeNull();
	});

	it('mantém o hex quando a cor digitada é a mesma escrita diferente', () => {
		const r = dadosDoItem(laranja, { cor: '  LARANJA ' });
		expect(r.ok && r.dados.corHex).toBe('#FF6A13');
	});

	it('a marca digitada ganha da marca do catálogo (caso do perfil genérico)', () => {
		const r = dadosDoItem(petgGenerico, { marca: '3D Fila', cor: 'Azul' });
		expect(r.ok && r.dados.marca).toBe('3D Fila');
	});

	it('marca em branco não apaga a marca do catálogo', () => {
		const r = dadosDoItem(laranja, { marca: '  ' });
		expect(r.ok && r.dados.marca).toBe('Bambu Lab');
	});

	it('o código Bambu sobrevive à troca de marca — é ele que amarra a importação', () => {
		const r = dadosDoItem(petgGenerico, { marca: '3D Fila', cor: 'Azul' });
		expect(r.ok && r.dados.codigoBambu).toBe('GFG99');
	});
});

/**
 * ── Os 15 testes de `resolverFilamento` saíram daqui ────────────────────────
 *
 * Eles travavam a decisão de "criar novo ou reaproveitar o cadastro igual",
 * inclusive a trava fina de não pendurar um `PLA Silk+` no `PLA Silk`. A regra
 * era certa enquanto `filamento` era o TIPO.
 *
 * A fusão inverteu a regra: **cada seleção do catálogo cria um rolo novo**, e é
 * isso que dá à segunda compra o preço da segunda nota. Manter os testes verdes
 * exigiria manter a função, e a função religada é o defeito de volta. O
 * comportamento que os substitui está em `edicao.test.ts` → `criarRolo` ("duas
 * compras do mesmo filamento viram DOIS registros") e no teste de action de
 * `/rolos`.
 *
 * A trava do `Silk+` não foi movida para lugar nenhum: sem reaproveitamento,
 * nenhum cadastro herda o código de outro produto, e a falha que ela impedia
 * deixou de ser expressável. `chaveFilamento` continua testado abaixo porque
 * ele segue em uso — na validação do catálogo, que é outro trabalho.
 */

describe('chaveFilamento', () => {
	it('separa PLA Silk de PLA Silk+', () => {
		const silk = { marca: 'Bambu Lab', material: 'PLA Silk', cor: 'Azul' };
		const silkMais = { marca: 'Bambu Lab', material: 'PLA Silk+', cor: 'Azul' };
		expect(chaveFilamento(silk)).not.toBe(chaveFilamento(silkMais));
	});

	it('separa PLA Tough de PLA Tough+', () => {
		const base = { marca: 'Bambu Lab', cor: 'Preto' };
		expect(chaveFilamento({ ...base, material: 'PLA Tough' })).not.toBe(
			chaveFilamento({ ...base, material: 'PLA Tough+' })
		);
	});

	it('continua juntando o que só difere em caixa, acento e pontuação', () => {
		expect(chaveFilamento({ marca: 'BAMBU LAB', material: 'PLA-Basic', cor: 'Abóbora' })).toBe(
			chaveFilamento({ marca: 'bambu  lab', material: 'PLA Basic', cor: 'abobora' })
		);
	});
});

it('guarda proveniência OFD e ausência de código sem transformar em perfil Bambu', () => {
 const r = dadosDoItem({ ...laranja, marca: 'Elegoo', fonteCatalogo: 'ofd', codigoBambu: '', tempMesa: null }, {});
 expect(r.ok && r.dados).toMatchObject({ fonteCatalogo: 'ofd', codigoBambu: null, tempMesa: null });
});
