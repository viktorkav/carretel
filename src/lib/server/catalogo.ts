import { normalizar, type ItemCatalogo } from '$lib/catalogo/busca';

/**
 * Os campos de ficha do ROLO que o catálogo sabe preencher.
 *
 * Antes da fusão isto virava uma linha na tabela `filamento`, possivelmente
 * reaproveitada. Agora vira parte de um rolo novo, sempre — cada seleção do
 * catálogo é uma compra, e duas compras iguais são dois registros.
 */
export interface DadosFilamento {
	marca: string;
	material: string;
	cor: string;
	corHex: string | null;
	densidade: number;
	tempBico: number | null;
	tempMesa: number | null;
	codigoBambu: string | null;
	fonteCatalogo: 'bambu' | 'ofd' | 'manual';
}

export type Resolvido = { ok: true; dados: DadosFilamento } | { ok: false; erro: string };

/**
 * Traduz um item do catálogo nos campos do cadastro, deixando o usuário
 * sobrescrever marca e cor.
 *
 * As duas sobrescritas existem por motivos diferentes:
 * - **cor**: os 54 códigos sem tabela de cor (`Generic PETG`, `PLA-CF`) só
 *   ficam completos com a cor do rolo que ele tem na mão.
 * - **marca**: o perfil "Generic" da Bambu não é uma marca, é o modo do
 *   AMS/slicer. Quem comprou um rolo da 3D Fila e imprime como Generic PETG
 *   quer `marca = 3D Fila` e `codigoBambu = GFG99` — a marca é o que ele lê,
 *   o código é o que a nuvem vai devolver.
 */
export function dadosDoItem(
	item: ItemCatalogo,
	sobrescritas: { marca?: string | null; cor?: string | null }
): Resolvido {
	const marcaDigitada = String(sobrescritas.marca ?? '').trim();
	const corDigitada = String(sobrescritas.cor ?? '').trim();

	const cor = corDigitada || item.cor || '';
	if (!cor) {
		return { ok: false, erro: 'este item do catálogo não tem cor; digite a cor do rolo' };
	}

	// O hex é a cor OFICIAL daquela referência. Se ele trocou o nome da cor,
	// o hex do catálogo passa a descrever outro rolo: melhor ficar sem cor
	// do que pintar o cadastro de laranja um filamento vermelho.
	const mesmaCor = item.cor !== null && normalizar(cor) === normalizar(item.cor);
	const corHex = mesmaCor ? item.corHex : null;

	return {
		ok: true,
		dados: {
			marca: marcaDigitada || item.marca,
			material: item.material,
			cor,
			corHex,
			densidade: item.densidade,
			tempBico: item.tempBico,
			tempMesa: item.tempMesa,
			codigoBambu: item.codigoBambu || null,
			fonteCatalogo: item.fonteCatalogo ?? 'bambu'
		}
	};
}

/**
 * ── Por que não existe mais `resolverFilamento` ─────────────────────────────
 *
 * Havia aqui uma decisão de "criar novo ou reaproveitar o cadastro igual", com
 * uma trava fina por código Bambu para não pendurar um `PLA Silk+` (GFA06) no
 * `PLA Silk` (GFA05) — mesmas cores, densidades diferentes. Ela existia porque
 * `filamento` era o TIPO: dois rolos do mesmo PLA tinham que apontar para a
 * mesma linha, senão o histórico se partia.
 *
 * A fusão desfez a premissa. Não há mais tipo para reaproveitar: **cada seleção
 * do catálogo cria um rolo novo**, e é exatamente isso que dá a cada compra o
 * seu próprio preço e o seu próprio código.
 *
 * E a trava do Silk+ não precisou ir para lugar nenhum: **a falha deixou de ser
 * expressável.** Ela dependia de um cadastro herdar o código de outro produto,
 * e sem reaproveitamento não existe herança — o rolo nasce com o código do item
 * que foi escolhido, e ponto. Por isso a função saiu inteira, em vez de ficar
 * como código morto que alguém religa sem querer.
 */
