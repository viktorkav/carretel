import { chaveFilamento, type Catalogo, type ItemCatalogo } from './busca.ts';
import { enderecoDeImagemValido } from './imagem-local.ts';

/**
 * Valida um catálogo lido do disco.
 *
 * Existe porque o catálogo deixou de ser dado versionado e passou a ser
 * arquivo gerado no volume: ninguém revisa o diff dele antes de usar. Então a
 * conferência que antes era feita por teste sobre o arquivo commitado agora é
 * feita **em produção, toda vez que o arquivo é lido**.
 *
 * O que é fatal aqui é só o que impede o cadastro de estar certo — shape,
 * unicidade de id, formato de código, e colisão de chave de dedupe (que foi
 * como PLA Silk e PLA Silk+ viraram o mesmo filamento). Coisa cosmética, como
 * faltar alias de busca, não derruba o catálogo inteiro.
 */
export type Validacao =
	| { ok: true; catalogo: Catalogo }
	| { ok: false; erro: string };

const ehTexto = (v: unknown): v is string => typeof v === 'string' && v.length > 0;
const ehNumero = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

function validarItem(bruto: unknown, posicao: number): string | null {
	if (typeof bruto !== 'object' || bruto === null) return `item ${posicao} não é objeto`;
	const i = bruto as Record<string, unknown>;

	if (!ehTexto(i.id)) return `item ${posicao} sem id`;
	if (!ehTexto(i.marca)) return `item ${i.id} sem marca`;
	if (!ehTexto(i.material)) return `item ${i.id} sem material`;
	if (i.corAlias != null && typeof i.corAlias !== 'string') return `item ${i.id} com alias inválido`;
	if (i.densidadeEstimada !== undefined && typeof i.densidadeEstimada !== 'boolean') return `item ${i.id} com indicação de densidade inválida`;
	if (i.fonteCatalogo !== undefined && (typeof i.fonteCatalogo !== 'string' || !['bambu', 'ofd', 'manual'].includes(i.fonteCatalogo))) return `item ${i.id} com fonte inválida`;
	if (i.codigosCorBambu !== undefined && (!Array.isArray(i.codigosCorBambu) || !i.codigosCorBambu.every(ehTexto))) return `item ${i.id} com códigos de cor inválidos`;
	const externo = i.fonteCatalogo === 'ofd' || i.fonteCatalogo === 'manual';
	if (!(externo && i.codigoBambu === '') && !ehTexto(i.codigoBambu)) return `item ${i.id} sem código Bambu`;
	if (!(externo && i.codigoBambu === '') && !/^GF[A-Z]+[0-9]+$/.test(String(i.codigoBambu))) {
		return `item ${i.id} com código fora do padrão: ${i.codigoBambu}`;
	}
	if (i.cor !== null && !ehTexto(i.cor)) return `item ${i.id} com cor inválida`;
	if (!ehNumero(i.densidade) || i.densidade <= 0) return `item ${i.id} sem densidade utilizável`;
	if (!(externo && i.tempBico === null) && (!ehNumero(i.tempBico) || i.tempBico <= 0)) return `item ${i.id} sem temperatura de bico`;
	if (!(externo && i.tempMesa === null) && (!ehNumero(i.tempMesa) || i.tempMesa < 0)) return `item ${i.id} sem temperatura de mesa`;
	// Bico mais frio que mesa é o sintoma de bico e mesa trocados na geração —
	// erro silencioso que só apareceria no filamento derretendo errado.
	if (ehNumero(i.tempBico) && ehNumero(i.tempMesa) && i.tempBico <= i.tempMesa) {
		return `item ${i.id} com bico (${i.tempBico}) não mais quente que a mesa (${i.tempMesa})`;
	}
	if (i.corHex !== null && !(ehTexto(i.corHex) && /^#[0-9A-F]{6}$/.test(i.corHex))) {
		return `item ${i.id} com hex inválido: ${String(i.corHex)}`;
	}
	// Links para fora (a página do produto, a fonte do dado) são sempre https.
	for (const campo of ['produtoUrl', 'fonteUrl']) {
		if (i[campo] !== undefined && !(ehTexto(i[campo]) && /^https:\/\//.test(i[campo]))) {
			return `item ${i.id} com URL inválida em ${campo}`;
		}
	}
	// Imagens podem ser https de terceiro OU um arquivo da própria instalação,
	// no contrato estreito de `./imagem-local` (`/midia/catalogo/<arquivo>`).
	// Qualquer outro caminho relativo continua recusado.
	for (const campo of ['imagemUrl', 'logoUrl']) {
		if (i[campo] !== undefined && !enderecoDeImagemValido(i[campo])) {
			return `item ${i.id} com URL inválida em ${campo}`;
		}
	}
	return null;
}

export function validarCatalogo(bruto: unknown): Validacao {
	if (typeof bruto !== 'object' || bruto === null) return { ok: false, erro: 'não é um objeto' };
	const c = bruto as Record<string, unknown>;

	if (!ehTexto(c.fonte)) return { ok: false, erro: 'sem campo `fonte`' };
	if (!ehTexto(c.licencaFonte)) return { ok: false, erro: 'sem campo `licencaFonte`' };
	// O commit é o que responde "qual catálogo está em uso" sem abrir o
	// arquivo inteiro, e é o que o /config mostra na tela.
	if (!ehTexto(c.commit) || !/^[0-9a-f]{40}$/.test(c.commit)) {
		return { ok: false, erro: 'sem commit de origem válido' };
	}
	if (!Array.isArray(c.itens) || c.itens.length === 0) {
		return { ok: false, erro: 'sem itens' };
	}

	const vistos = new Set<string>();
	const porChave = new Map<string, string>();

	for (let n = 0; n < c.itens.length; n++) {
		const erro = validarItem(c.itens[n], n);
		if (erro) return { ok: false, erro };

		const item = c.itens[n] as ItemCatalogo;
		if (vistos.has(item.id)) return { ok: false, erro: `id repetido: ${item.id}` };
		vistos.add(item.id);

		const chave = chaveFilamento({ ...item, cor: item.cor ?? '' });
		const anterior = porChave.get(chave);
		if (anterior !== undefined && anterior !== item.codigoBambu) {
			return {
				ok: false,
				erro:
					`"${item.marca} ${item.material} ${item.cor ?? ''}" casa com dois códigos ` +
					`(${anterior} e ${item.codigoBambu})`
			};
		}
		porChave.set(chave, item.codigoBambu);
	}

	return { ok: true, catalogo: bruto as Catalogo };
}
