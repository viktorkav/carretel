import { describe, expect, it } from 'vitest';
import {
	FINALIDADES,
	chaveDePeca,
	normalizarFinalidade,
	resumirFinalidades,
	sugerirFinalidade
} from './finalidade';

describe('normalizarFinalidade', () => {
	it('aceita as cinco do domínio', () => {
		for (const f of FINALIDADES) expect(normalizarFinalidade(f)).toBe(f);
	});

	it('devolve null para o que não é finalidade', () => {
		expect(normalizarFinalidade('')).toBeNull();
		expect(normalizarFinalidade(null)).toBeNull();
		expect(normalizarFinalidade('estúdio')).toBeNull();
		expect(normalizarFinalidade('ESTUDIO')).toBeNull();
		expect(normalizarFinalidade('drop table')).toBeNull();
	});

	it('não confunde string vazia com "outro"', () => {
		// A distinção é a espinha do sistema de camadas: vazio significa "herda
		// da camada de cima", e `outro` é uma escolha explícita do usuário.
		expect(normalizarFinalidade('')).not.toBe('outro');
	});
});

describe('chaveDePeca', () => {
	it('ignora caixa, acento e espaço repetido', () => {
		expect(chaveDePeca('Suporte  de  Câmera')).toBe(chaveDePeca('suporte de camera'));
	});

	it('ignora a extensão do arquivo fatiado', () => {
		// A nuvem devolve `MagicTray.3mf` numa tarefa e `MagicTray` noutra.
		expect(chaveDePeca('MagicTray.3mf')).toBe(chaveDePeca('MagicTray'));
		expect(chaveDePeca('gridfinity_1x1.gcode.3mf')).toBe(chaveDePeca('gridfinity_1x1'));
	});

	it('devolve vazio para nome que não sobrou nada', () => {
		expect(chaveDePeca('   ')).toBe('');
		expect(chaveDePeca('.3mf')).toBe('');
	});
});

describe('sugerirFinalidade', () => {
	const historico = resumirFinalidades([
		{ nome: 'MagicTray.3mf', finalidade: 'homelab', inicioEm: 10 },
		{ nome: 'MagicTray', finalidade: 'homelab', inicioEm: 20 },
		{ nome: 'MagicTray', finalidade: 'pessoal', inicioEm: 30 },
		{ nome: 'Suporte de câmera', finalidade: 'estudio', inicioEm: 40 }
	]);

	it('sugere a finalidade mais usada para aquela peça', () => {
		expect(sugerirFinalidade('MagicTray.3mf', historico)).toBe('homelab');
	});

	it('casa pelo nome normalizado, não pelo literal', () => {
		expect(sugerirFinalidade('SUPORTE DE CAMERA', historico)).toBe('estudio');
	});

	it('não sugere nada para peça inédita', () => {
		expect(sugerirFinalidade('Peça nova', historico)).toBeNull();
	});

	it('não sugere nada para nome vazio', () => {
		expect(sugerirFinalidade('  ', historico)).toBeNull();
	});

	it('desempata pelo registro mais recente', () => {
		const empate = resumirFinalidades([
			{ nome: 'Caixa', finalidade: 'estudio', inicioEm: 10 },
			{ nome: 'Caixa', finalidade: 'conteudo', inicioEm: 20 }
		]);
		expect(sugerirFinalidade('Caixa', empate)).toBe('conteudo');
	});
});

describe('resumirFinalidades', () => {
	it('ignora `outro`, que é a ausência de decisão', () => {
		// As 11 impressões reais entraram todas como `outro`. Se elas alimentassem
		// a sugestão, o defeito que estamos consertando se propagaria sozinho.
		const so = resumirFinalidades([
			{ nome: 'Caixa', finalidade: 'outro', inicioEm: 10 },
			{ nome: 'Caixa', finalidade: 'outro', inicioEm: 20 }
		]);
		expect(so.size).toBe(0);
		expect(sugerirFinalidade('Caixa', so)).toBeNull();
	});

	it('a decisão explícita sobrevive ao lixo de `outro` ao redor', () => {
		const misto = resumirFinalidades([
			{ nome: 'Caixa', finalidade: 'outro', inicioEm: 10 },
			{ nome: 'Caixa', finalidade: 'outro', inicioEm: 20 },
			{ nome: 'Caixa', finalidade: 'conteudo', inicioEm: 30 }
		]);
		expect(sugerirFinalidade('Caixa', misto)).toBe('conteudo');
	});

	it('ignora finalidade fora do domínio e nome vazio', () => {
		const sujo = resumirFinalidades([
			{ nome: 'Caixa', finalidade: 'sei-la', inicioEm: 10 },
			{ nome: '   ', finalidade: 'estudio', inicioEm: 20 }
		]);
		expect(sujo.size).toBe(0);
	});
});
