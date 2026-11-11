import { describe, expect, it } from 'vitest';
import { erroDeCampo } from './erro-campo';

describe('erroDeCampo', () => {
	it('amarra a mensagem ao campo que a action apontou', () => {
		expect(erroDeCampo({ erro: 'gramas é obrigatório', campo: 'gramas' })).toEqual({
			campo: 'gramas',
			mensagem: 'gramas é obrigatório'
		});
	});

	it('erro sem campo não marca controle nenhum', () => {
		// "rolo não encontrado" e as falhas da nuvem não são de um controle: pintar
		// um campo ao acaso é pior do que não pintar nenhum.
		expect(erroDeCampo({ erro: 'rolo não encontrado' })).toBeNull();
		expect(erroDeCampo({ erro: 'x', campo: '' })).toBeNull();
	});

	it('formulário ausente ou sem erro não vira erro', () => {
		expect(erroDeCampo(null)).toBeNull();
		expect(erroDeCampo(undefined)).toBeNull();
		expect(erroDeCampo({ sucesso: true })).toBeNull();
		expect(erroDeCampo('erro')).toBeNull();
	});

	it('ignora tipos que não são texto em vez de renderizá-los', () => {
		expect(erroDeCampo({ erro: 42, campo: 'gramas' })).toBeNull();
		expect(erroDeCampo({ erro: 'x', campo: 42 })).toBeNull();
	});
});
