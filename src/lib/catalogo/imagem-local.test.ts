import { describe, expect, it } from 'vitest';
import { arquivoDeImagemLocal, enderecoDeImagemValido, imagemLocalDoCatalogo } from './imagem-local';

describe('imagem local do catálogo: o contrato /midia/catalogo/<arquivo>', () => {
	it('aceita o caminho do contrato e devolve só o nome do arquivo', () => {
		expect(imagemLocalDoCatalogo('/midia/catalogo/demo-pla-cinza.webp')).toBe('demo-pla-cinza.webp');
		expect(imagemLocalDoCatalogo('/midia/catalogo/rolo_01.png')).toBe('rolo_01.png');
		expect(imagemLocalDoCatalogo('/midia/catalogo/foto.v2.jpeg')).toBe('foto.v2.jpeg');
		expect(imagemLocalDoCatalogo('/midia/catalogo/a.jpg')).toBe('a.jpg');
	});

	it('recusa qualquer tentativa de sair da pasta', () => {
		for (const hostil of [
			'/midia/catalogo/../segredo.png',
			'/midia/catalogo/../../etc/passwd',
			'/midia/catalogo/sub/pasta.png',
			'/midia/catalogo/..%2Fsegredo.png',
			'/midia/catalogo/%2e%2e/segredo.png',
			'/midia/catalogo/a..png',
			'/midia/catalogo/.oculto.png',
			'/midia/catalogo/a\\b.png',
			'/midia/catalogo/a.png\0.jpg',
			'/midia/catalogo/',
			'/midia/catalogo'
		]) {
			expect(imagemLocalDoCatalogo(hostil), hostil).toBeNull();
		}
	});

	it('recusa outro prefixo, outra origem e outro esquema', () => {
		for (const fora of [
			'midia/catalogo/a.png',
			'/midia/rolo/n1-corpo.webp',
			'/impressoes/1/imagem',
			'//exemplo.invalid/midia/catalogo/a.png',
			'http://exemplo.invalid/midia/catalogo/a.png',
			'javascript:alert(1)',
			'data:image/png;base64,AAAA',
			'file:///etc/passwd',
			' /midia/catalogo/a.png',
			'/MIDIA/catalogo/a.png'
		]) {
			expect(imagemLocalDoCatalogo(fora), fora).toBeNull();
		}
	});

	it('recusa parâmetro, fragmento, maiúscula e extensão que não é imagem servível', () => {
		for (const torto of [
			'/midia/catalogo/a.png?x=1',
			'/midia/catalogo/a.png#x',
			'/midia/catalogo/A.png',
			'/midia/catalogo/a.PNG',
			'/midia/catalogo/a.svg',
			'/midia/catalogo/a.gif',
			'/midia/catalogo/a.html',
			'/midia/catalogo/a',
			'/midia/catalogo/a b.png',
			`/midia/catalogo/${'a'.repeat(120)}.png`
		]) {
			expect(imagemLocalDoCatalogo(torto), torto).toBeNull();
		}
	});

	it('o nome sozinho segue a mesma regra, e o que não é texto não passa', () => {
		expect(arquivoDeImagemLocal('demo-petg-azul.webp')).toBe('demo-petg-azul.webp');
		expect(arquivoDeImagemLocal('../demo.webp')).toBeNull();
		expect(arquivoDeImagemLocal('pasta/demo.webp')).toBeNull();
		expect(arquivoDeImagemLocal(undefined)).toBeNull();
		expect(arquivoDeImagemLocal(42)).toBeNull();
	});

	it('endereço válido de imagem: https de terceiro ou o caminho local, e só', () => {
		expect(enderecoDeImagemValido('https://loja.exemplo.invalid/rolo.jpg')).toBe(true);
		expect(enderecoDeImagemValido('/midia/catalogo/demo-pla-branco.webp')).toBe(true);
		expect(enderecoDeImagemValido('http://loja.exemplo.invalid/rolo.jpg')).toBe(false);
		expect(enderecoDeImagemValido('/qualquer/outro/caminho.png')).toBe(false);
		expect(enderecoDeImagemValido('')).toBe(false);
		expect(enderecoDeImagemValido(null)).toBe(false);
	});
});
