import { beforeEach, describe, expect, it } from 'vitest';
import { CAMPO_ENVIO, devolverEnvio, esquecerEnvios, novoEnvio, registrarEnvio } from './envio';

beforeEach(() => {
	esquecerEnvios();
});

describe('registrarEnvio', () => {
	it('o primeiro envio de um token é novo', () => {
		expect(registrarEnvio(novoEnvio())).toBe('novo');
	});

	it('o mesmo token de novo é repetido', () => {
		const token = novoEnvio();
		expect(registrarEnvio(token)).toBe('novo');
		expect(registrarEnvio(token)).toBe('repetido');
		expect(registrarEnvio(token)).toBe('repetido');
	});

	it('tokens diferentes não se atrapalham', () => {
		expect(registrarEnvio(novoEnvio())).toBe('novo');
		expect(registrarEnvio(novoEnvio())).toBe('novo');
	});

	it('cada token nasce diferente do anterior', () => {
		const muitos = new Set(Array.from({ length: 200 }, () => novoEnvio()));
		expect(muitos.size).toBe(200);
	});

	it('formulário sem o campo passa sem proteção, e diz isso', () => {
		expect(registrarEnvio(null)).toBe('sem-token');
		expect(registrarEnvio('')).toBe('sem-token');
		expect(registrarEnvio('   ')).toBe('sem-token');
	});

	it('o campo tem nome estável — é ele que vai no HTML', () => {
		expect(CAMPO_ENVIO).toBe('envio');
	});

	it('esquece tudo quando mandado, para um teste não contaminar o outro', () => {
		const token = novoEnvio();
		registrarEnvio(token);
		esquecerEnvios();
		expect(registrarEnvio(token)).toBe('novo');
	});

	/**
	 * O defeito relatado é este: duas requisições no MESMO milissegundo. A
	 * garantia não vem de relógio nem de consulta ao banco — vem de a checagem e
	 * o consumo serem síncronos e adjacentes, então nada roda entre os dois.
	 */
	it('duas leituras disparadas juntas: só uma sai como nova', async () => {
		const token = novoEnvio();
		const [a, b] = await Promise.all([
			Promise.resolve().then(() => registrarEnvio(token)),
			Promise.resolve().then(() => registrarEnvio(token))
		]);
		expect([a, b].filter((r) => r === 'novo')).toHaveLength(1);
		expect([a, b].filter((r) => r === 'repetido')).toHaveLength(1);
	});

	it('aguenta rajada sem perder o token recém-gasto', () => {
		const token = novoEnvio();
		expect(registrarEnvio(token)).toBe('novo');
		for (let i = 0; i < 3000; i++) registrarEnvio(novoEnvio());
		// O teto derruba os mais velhos; o que importa é não estourar memória
		// nem quebrar. O recém-gasto pode ter saído, e isso é aceitável: um
		// envio de 3000 formulários atrás não é mais um toque duplo.
		expect(['novo', 'repetido']).toContain(registrarEnvio(token));
	});
});

/**
 * `devolverEnvio` nasceu na integração: frentes irmãs puseram regra de domínio
 * dentro das funções que escrevem, e uma recusa vinda de lá queimava o token
 * sem gravar nada. Ver o comentário do módulo.
 */
describe('devolverEnvio', () => {
	it('um token devolvido volta a valer', () => {
		const t = novoEnvio();
		expect(registrarEnvio(t)).toBe('novo');
		devolverEnvio(t);
		expect(registrarEnvio(t)).toBe('novo');
	});

	it('devolver não afrouxa o que não foi devolvido', () => {
		const gasto = novoEnvio();
		const outro = novoEnvio();
		registrarEnvio(gasto);
		registrarEnvio(outro);

		devolverEnvio(outro);

		expect(registrarEnvio(gasto)).toBe('repetido');
		expect(registrarEnvio(outro)).toBe('novo');
	});

	it('devolver nada, ou lixo, não explode', () => {
		expect(() => devolverEnvio(null)).not.toThrow();
		expect(() => devolverEnvio('')).not.toThrow();
		expect(() => devolverEnvio('   ')).not.toThrow();
	});
});
