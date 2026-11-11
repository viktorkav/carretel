/**
 * Imagem de catálogo guardada NA PRÓPRIA INSTALAÇÃO.
 *
 * Até aqui a foto de um filamento só podia ser uma URL `https://` de terceiro
 * (a loja da fabricante, o CDN do catálogo aberto). Isso deixa de fora dois
 * casos legítimos: a instalação sem internet e a imagem que é da própria
 * pessoa — a foto que ela tirou do rolo, a ilustração de uma marca que não tem
 * foto publicada.
 *
 * O contrato é estreito de propósito. Uma imagem local é escrita no catálogo
 * como
 *
 *     /midia/catalogo/<arquivo>
 *
 * e mais nada: um caminho absoluto de mesma origem, com prefixo fixo e UM nome
 * de arquivo. Não há subpasta, não há `..`, não há barra invertida, não há
 * parâmetro, não há outro prefixo. O arquivo mora em `UPLOADS_PATH/catalogo/`
 * (o mesmo volume das capas) e é servido por `routes/midia/catalogo/[arquivo]`,
 * que passa pelas mesmas defesas de `$lib/server/imagens`: raiz conferida
 * antes e depois dos links simbólicos, só arquivo comum, tipo decidido pela
 * extensão.
 *
 * SVG fica de fora pelo mesmo motivo das capas: é documento executável.
 *
 * Este módulo não toca disco nem rede; por isso serve à validação do catálogo
 * (que roda em qualquer lugar) e à rota (que roda no servidor).
 */

export const PREFIXO_IMAGEM_LOCAL = '/midia/catalogo/';

/** Minúsculas, dígitos, ponto, hífen e sublinhado; começa por letra ou dígito; extensão de imagem. */
const NOME_DE_ARQUIVO = /^[a-z0-9][a-z0-9._-]{0,79}\.(?:png|jpg|jpeg|webp)$/;

/**
 * O nome de arquivo, se ele é um nome que este contrato aceita; senão `null`.
 * Recebe o nome SOZINHO (o parâmetro da rota), nunca um caminho.
 */
export function arquivoDeImagemLocal(nome: unknown): string | null {
	if (typeof nome !== 'string') return null;
	if (!NOME_DE_ARQUIVO.test(nome)) return null;
	// `a..png` casaria com a expressão acima; dois pontos seguidos não têm uso
	// legítimo num nome de imagem e são a matéria-prima de `../`.
	if (nome.includes('..')) return null;
	return nome;
}

/**
 * O nome do arquivo de uma imagem local escrita no catálogo
 * (`/midia/catalogo/<arquivo>`), ou `null` quando o valor não é isso.
 */
export function imagemLocalDoCatalogo(valor: unknown): string | null {
	if (typeof valor !== 'string' || !valor.startsWith(PREFIXO_IMAGEM_LOCAL)) return null;
	return arquivoDeImagemLocal(valor.slice(PREFIXO_IMAGEM_LOCAL.length));
}

/** Endereço que uma imagem de catálogo pode ter: `https://…` de terceiro ou o caminho local do contrato. */
export function enderecoDeImagemValido(valor: unknown): boolean {
	if (typeof valor !== 'string' || valor.length === 0) return false;
	return /^https:\/\//.test(valor) || imagemLocalDoCatalogo(valor) !== null;
}
