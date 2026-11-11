import { describe, expect, it } from 'vitest';
import {
	alertasDoRolo,
	calcularRestante,
	resolverPesagem,
	validarPesoAferido,
	validarSobraFinal
} from './estoque';

const DIA = 86_400_000;
const T0 = 1_754_700_000_000; // referência fixa; nada aqui depende do relógio

describe('calcularRestante', () => {
	it('desconta as impressões do peso inicial quando nunca houve aferição', () => {
		const r = calcularRestante({
			pesoInicialG: 1000,
			afericoes: [],
			impressoes: [
				{ gramas: 149, inicioEm: T0 },
				{ gramas: 179, inicioEm: T0 + DIA }
			]
		});
		expect(r.restanteG).toBe(672);
		expect(r.baseEm).toBeNull();
	});

	it('usa a aferição mais recente como novo ponto de partida', () => {
		const r = calcularRestante({
			pesoInicialG: 1000,
			afericoes: [
				{ pesoLiquidoG: 800, dataEm: T0 },
				{ pesoLiquidoG: 500, dataEm: T0 + 2 * DIA }
			],
			impressoes: [
				{ gramas: 100, inicioEm: T0 + DIA }, // antes da última aferição: ignorada
				{ gramas: 50, inicioEm: T0 + 3 * DIA } // depois: desconta
			]
		});
		expect(r.restanteG).toBe(450);
		expect(r.baseEm).toBe(T0 + 2 * DIA);
	});

	it('ignora impressão exatamente no instante da aferição', () => {
		// A aferição fotografa o rolo NAQUELE instante; o que aconteceu até ali
		// já está embutido no número pesado.
		const r = calcularRestante({
			pesoInicialG: 1000,
			afericoes: [{ pesoLiquidoG: 600, dataEm: T0 }],
			impressoes: [{ gramas: 100, inicioEm: T0 }]
		});
		expect(r.restanteG).toBe(600);
	});

	it('nunca devolve restante negativo', () => {
		const r = calcularRestante({
			pesoInicialG: 100,
			afericoes: [],
			impressoes: [{ gramas: 500, inicioEm: T0 }]
		});
		expect(r.restanteG).toBe(0);
	});

	it('calcula o percentual sobre o peso inicial', () => {
		const r = calcularRestante({
			pesoInicialG: 1000,
			afericoes: [],
			impressoes: [{ gramas: 250, inicioEm: T0 }]
		});
		expect(r.percentual).toBeCloseTo(0.75);
	});
});

describe('alertasDoRolo', () => {
	it('avisa quando o rolo passa de 85% consumido', () => {
		const a = alertasDoRolo({
			restanteG: 100,
			pesoInicialG: 1000,
			dataAbertura: T0,
			dataUltimaSecagem: T0,
			agora: T0 + DIA
		});
		expect(a).toContainEqual({ tipo: 'acabando', gravidade: 'aviso' });
	});

	it('avisa "acabando" pelo limiar de gramas absolutas mesmo com percentual folgado', () => {
		// pesoInicialG grande o bastante pro percentual (15,56%) ficar ACIMA
		// dos 15% — só o ramo de gramas absolutas (140g <= 150g) pode disparar.
		const a = alertasDoRolo({
			restanteG: 140,
			pesoInicialG: 900,
			dataAbertura: T0,
			dataUltimaSecagem: T0,
			agora: T0 + DIA
		});
		expect(a).toContainEqual({ tipo: 'acabando', gravidade: 'aviso' });
	});

	it('avisa "acabando" pelo limiar de percentual mesmo com gramas absolutas folgadas', () => {
		// restanteG (200g) fica ACIMA do limiar de 150g — só o ramo de
		// percentual (10% <= 15%) pode disparar.
		const a = alertasDoRolo({
			restanteG: 200,
			pesoInicialG: 2000,
			dataAbertura: T0,
			dataUltimaSecagem: T0,
			agora: T0 + DIA
		});
		expect(a).toContainEqual({ tipo: 'acabando', gravidade: 'aviso' });
	});

	it('avisa quando o rolo está aberto há mais de 60 dias sem secagem', () => {
		const a = alertasDoRolo({
			restanteG: 900,
			pesoInicialG: 1000,
			dataAbertura: T0,
			dataUltimaSecagem: null,
			agora: T0 + 61 * DIA
		});
		expect(a).toContainEqual({ tipo: 'umidade', gravidade: 'aviso' });
	});

	it('não avisa umidade se secou recentemente', () => {
		const a = alertasDoRolo({
			restanteG: 900,
			pesoInicialG: 1000,
			dataAbertura: T0,
			dataUltimaSecagem: T0 + 50 * DIA,
			agora: T0 + 61 * DIA
		});
		expect(a).toEqual([]);
	});

	it('não avisa nada em rolo fechado', () => {
		const a = alertasDoRolo({
			restanteG: 1000,
			pesoInicialG: 1000,
			dataAbertura: null,
			dataUltimaSecagem: null,
			agora: T0
		});
		expect(a).toEqual([]);
	});
});

describe('validarPesoAferido', () => {
	it('aceita peso abaixo do inicial', () => {
		expect(validarPesoAferido(800, 1000)).toEqual({ ok: true });
	});

	it('aceita peso exatamente igual ao inicial (rolo recém-aberto)', () => {
		expect(validarPesoAferido(1000, 1000)).toEqual({ ok: true });
	});

	it('recusa peso acima do inicial — é fisicamente impossível', () => {
		const r = validarPesoAferido(8000, 1000);
		expect(r.ok).toBe(false);
		expect(r).toEqual({
			ok: false,
			erro: 'peso aferido (8000 g) é maior que o peso líquido inicial do rolo (1000 g); confira a balança ou corrija o peso inicial no cadastro'
		});
	});

	// Um grama acima do inicial já é impossível. Sem este teste, trocar o `>`
	// por um `>=` folgado (ex.: `pesoAferidoG > pesoInicialG * 1.5`) passaria
	// batido, e o dígito trocado que o teste acima pega (8000 por 800) é justo
	// o caso raro — o comum é o erro pequeno.
	it('recusa um único grama acima do inicial', () => {
		expect(validarPesoAferido(1000.1, 1000).ok).toBe(false);
	});

	it('recusa peso zero ou negativo', () => {
		expect(validarPesoAferido(0, 1000).ok).toBe(false);
		expect(validarPesoAferido(-5, 1000).ok).toBe(false);
	});

	// O peso inicial vem do cadastro e é `notNull` com padrão 1000, mas nada
	// impede um registro antigo com 0 — nesse caso não há teto que faça
	// sentido, e recusar toda aferição travaria o rolo de vez.
	it('não impõe teto quando o peso inicial não é positivo', () => {
		expect(validarPesoAferido(800, 0)).toEqual({ ok: true });
	});
});

describe('resolverPesagem — a balança dá bruto, o sistema pedia líquido', () => {
	// O gesto mais importante do sistema é feito de pé, ao lado da impressora,
	// com o rolo na mão. Era o único que exigia uma subtração de cabeça — e o
	// sintoma é que os dois rolos reais marcam "aferido em: nunca".
	const carretel = { pesoCarretelG: 250 };

	it('converte o bruto da balança em líquido', () => {
		expect(resolverPesagem({ bruto: '812', liquido: '', ...carretel })).toEqual({
			ok: true,
			pesoLiquidoG: 562,
			origem: 'bruto'
		});
	});

	it('aceita o líquido direto, para quem já tirou o carretel', () => {
		expect(resolverPesagem({ bruto: '', liquido: '562', ...carretel })).toEqual({
			ok: true,
			pesoLiquidoG: 562,
			origem: 'liquido'
		});
	});

	it('aceita vírgula decimal nos dois campos', () => {
		expect(resolverPesagem({ bruto: '812,5', liquido: '', ...carretel })).toMatchObject({
			ok: true,
			pesoLiquidoG: 562.5
		});
		expect(resolverPesagem({ bruto: '', liquido: '562,5', ...carretel })).toMatchObject({
			ok: true,
			pesoLiquidoG: 562.5
		});
	});

	it('os dois preenchidos e coerentes valem — é o que o JavaScript deixa na tela', () => {
		// Com script, digitar num campo preenche o outro: os DOIS chegam ao
		// servidor. Recusar isso quebraria justamente o caminho feliz.
		expect(resolverPesagem({ bruto: '812', liquido: '562', ...carretel })).toMatchObject({
			ok: true,
			pesoLiquidoG: 562
		});
	});

	it('os dois preenchidos e brigando é erro, não escolha silenciosa', () => {
		const r = resolverPesagem({ bruto: '812', liquido: '400', ...carretel });
		expect(r.ok).toBe(false);
		if (!r.ok) {
			expect(r.erro).toMatch(/812/);
			expect(r.erro).toMatch(/400/);
			expect(r.campo).toBe('pesoLiquidoG');
		}
	});

	it('tolera o arredondamento de um grama, e o líquido digitado é o que vale', () => {
		// Qual dos dois grava importa: se fosse o convertido, a mesma pesagem
		// mudaria de valor conforme o campo em que se digitou, com os dois na tela
		// dizendo a mesma coisa.
		expect(resolverPesagem({ bruto: '812', liquido: '562,4', ...carretel })).toEqual({
			ok: true,
			pesoLiquidoG: 562.4,
			origem: 'liquido'
		});
	});

	it('nenhum dos dois preenchido é erro no campo do bruto', () => {
		// O bruto é o campo que a balança responde, então é nele que o foco deve
		// cair — não no líquido, que ninguém tem como ler.
		const r = resolverPesagem({ bruto: '', liquido: '', ...carretel });
		expect(r.ok).toBe(false);
		if (!r.ok) expect(r.campo).toBe('pesoBrutoG');
	});

	it('bruto que não chega ao peso do carretel é recusado com a conta escrita', () => {
		const r = resolverPesagem({ bruto: '200', liquido: '', ...carretel });
		expect(r.ok).toBe(false);
		if (!r.ok) {
			expect(r.erro).toMatch(/250/);
			expect(r.campo).toBe('pesoBrutoG');
		}
	});

	it('bruto igual ao carretel é recusado: rolo vazio se encerra, não se afere em 0 g', () => {
		expect(resolverPesagem({ bruto: '250', liquido: '', ...carretel }).ok).toBe(false);
	});

	it('lixo digitado é erro, e não zero em silêncio', () => {
		for (const lixo of ['abc', '8OO', '1e999', '-5']) {
			expect(resolverPesagem({ bruto: lixo, liquido: '', ...carretel }).ok).toBe(false);
			expect(resolverPesagem({ bruto: '', liquido: lixo, ...carretel }).ok).toBe(false);
		}
	});

	it('peso de carretel ausente ou absurdo não inventa conversão', () => {
		// Sem um peso de carretel confiável não há como converter: o certo é pedir
		// o líquido, não subtrair um número inventado da leitura da balança.
		const r = resolverPesagem({ bruto: '812', liquido: '', pesoCarretelG: 0 });
		expect(r.ok).toBe(false);
		if (!r.ok) expect(r.erro).toMatch(/carretel/);
	});

	it('sem peso de carretel, o líquido digitado continua passando', () => {
		expect(resolverPesagem({ bruto: '', liquido: '562', pesoCarretelG: 0 })).toMatchObject({
			ok: true,
			pesoLiquidoG: 562
		});
	});
});

describe('validarSobraFinal', () => {
	/**
	 * A única diferença para `validarPesoAferido`, e ela é o ponto: no
	 * encerramento o zero é uma AFIRMAÇÃO ("acabou, não sobrou nada"), enquanto
	 * na pesagem avulsa ele é sintoma de campo em branco.
	 */
	it('aceita zero, que é o que “acabou” quer dizer', () => {
		expect(validarSobraFinal(0, 1000)).toEqual({ ok: true });
		expect(validarPesoAferido(0, 1000).ok).toBe(false);
	});

	it('aceita sobra abaixo do peso inicial', () => {
		expect(validarSobraFinal(6, 20)).toEqual({ ok: true });
	});

	it('aceita sobra igual ao peso inicial — encerrar um rolo que nunca foi usado', () => {
		expect(validarSobraFinal(1000, 1000)).toEqual({ ok: true });
	});

	it('recusa sobra acima do peso inicial: filamento não brota no carretel', () => {
		expect(validarSobraFinal(1000.1, 1000).ok).toBe(false);
		expect(validarSobraFinal(900, 20).ok).toBe(false);
	});

	it('recusa negativo e não-número', () => {
		expect(validarSobraFinal(-1, 1000).ok).toBe(false);
		expect(validarSobraFinal(Number.NaN, 1000).ok).toBe(false);
		expect(validarSobraFinal(Number.POSITIVE_INFINITY, 1000).ok).toBe(false);
	});

	it('não impõe teto quando o peso inicial não é positivo', () => {
		expect(validarSobraFinal(800, 0)).toEqual({ ok: true });
	});
});
