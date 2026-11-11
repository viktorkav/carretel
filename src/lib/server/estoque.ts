import { textoParaNumero } from './formulario';

export interface EntradaEstoque {
	pesoInicialG: number;
	afericoes: { pesoLiquidoG: number; dataEm: number }[];
	impressoes: { gramas: number; inicioEm: number }[];
}

export interface Restante {
	restanteG: number;
	/** Instante da aferição usada como base, ou null se partiu do peso inicial. */
	baseEm: number | null;
	percentual: number;
}

const LIMITE_PERCENTUAL = 0.15;
const LIMITE_GRAMAS = 150;
const DIAS_ATE_SECAR = 60;

/**
 * As duas parcelas do saldo, ANTES do arredondamento: de onde ele parte (a
 * pesagem mais recente, ou o peso inicial) e o que foi consumido depois dela.
 *
 * Existe separado de `calcularRestante` porque a conferência do registro
 * precisa prever o saldo de uma impressão que ainda não foi gravada, e prever
 * a partir do saldo já arredondado erra o décimo quando há resíduo de
 * centésimos. A regra continua uma só: `calcularRestante` usa esta função.
 */
export function parcelasDoSaldo(p: EntradaEstoque): {
	baseG: number;
	consumidoG: number;
	baseEm: number | null;
} {
	// A aferição na balança é a única medida real que existe: a A1 não tem
	// sensor de peso e, sem AMS lite, não lê o RFID do rolo. Toda estimativa
	// do slicer acumula erro (purga, abortos), então partimos sempre da
	// pesagem mais recente e só descontamos o que veio depois dela.
	const ultima = p.afericoes.reduce<{ pesoLiquidoG: number; dataEm: number } | null>(
		(maisRecente, a) => (!maisRecente || a.dataEm > maisRecente.dataEm ? a : maisRecente),
		null
	);

	const base = ultima ? ultima.pesoLiquidoG : p.pesoInicialG;
	const corte = ultima ? ultima.dataEm : -Infinity;

	const consumido = p.impressoes
		.filter((i) => i.inicioEm > corte)
		.reduce((soma, i) => soma + i.gramas, 0);

	return { baseG: base, consumidoG: consumido, baseEm: ultima ? ultima.dataEm : null };
}

export function calcularRestante(p: EntradaEstoque): Restante {
	const { baseG, consumidoG, baseEm } = parcelasDoSaldo(p);

	const restanteG = Math.max(0, Math.round((baseG - consumidoG) * 10) / 10);

	return {
		restanteG,
		baseEm,
		percentual: p.pesoInicialG > 0 ? restanteG / p.pesoInicialG : 0
	};
}

export type Validacao = { ok: true } | { ok: false; erro: string };

/**
 * A aferição é a âncora de `calcularRestante`: tudo que vem depois dela é
 * descontado dela, e não existe tela para apagar uma aferição errada. Um peso
 * impossível gravado aqui não é um número feio no relatório — é um rolo que
 * passa a reportar o valor errado para sempre.
 *
 * Por isso rejeitamos (em vez de aceitar com aviso) peso acima do peso líquido
 * inicial: filamento não brota no carretel, então ou a balança está errada ou
 * o peso inicial do cadastro está. Nos dois casos o certo é o usuário conferir
 * antes de ancorar o cálculo — aceitar com aviso deixaria o dado ruim gravado
 * e sem como remover.
 *
 * Peso inicial não positivo (registro antigo/corrompido) não tem teto que faça
 * sentido; nesse caso só a regra de "maior que zero" vale, senão o rolo ficaria
 * impossível de aferir.
 */
export function validarPesoAferido(pesoAferidoG: number, pesoInicialG: number): Validacao {
	if (!Number.isFinite(pesoAferidoG) || pesoAferidoG <= 0) {
		return { ok: false, erro: 'peso aferido deve ser maior que zero' };
	}
	if (pesoInicialG > 0 && pesoAferidoG > pesoInicialG) {
		return {
			ok: false,
			erro:
				`peso aferido (${pesoAferidoG} g) é maior que o peso líquido inicial do rolo ` +
				`(${pesoInicialG} g); confira a balança ou corrija o peso inicial no cadastro`
		};
	}
	return { ok: true };
}

/**
 * ── A balança dá bruto; o formulário pedia líquido ──────────────────────────
 *
 * O rolo na balança pesa filamento MAIS carretel. O sistema guardava o peso do
 * carretel, a dica do campo até dizia que ele servia "para converter a pesagem
 * bruta" — e nada convertia. O resultado é que o gesto mais importante do
 * sistema, feito de pé ao lado da impressora, era o único que exigia aritmética
 * de cabeça. Os dois rolos reais marcam "aferido em: nunca".
 *
 * Agora os dois campos existem e este módulo resolve qual virou a pesagem.
 * **A conversão viva no navegador é conforto, não requisito**: com JavaScript,
 * digitar num campo preenche o outro e os dois chegam aqui; sem ele, um dos
 * dois chega vazio e a conta é feita aqui. Os dois caminhos gravam o mesmo
 * número, que é a única forma de o modo sem script não ser um modo pior.
 */
export type Pesagem =
	| { ok: true; pesoLiquidoG: number; origem: 'bruto' | 'liquido' }
	| { ok: false; erro: string; campo: 'pesoBrutoG' | 'pesoLiquidoG' };

export interface EntradaPesagem {
	/** Texto cru do campo do bruto (o que se lê na balança). */
	bruto: string;
	/** Texto cru do campo do líquido (filamento sem o carretel). */
	liquido: string;
	pesoCarretelG: number;
}

/**
 * Diferença tolerada entre o que os dois campos afirmam, em gramas.
 *
 * Existe porque a conversão viva arredonda para uma casa e a balança de cozinha
 * mede em gramas inteiras: `812 − 250` e `562,4` são a mesma pesagem, e recusar
 * isso transformaria o conforto em armadilha. Acima disso, os dois números
 * discordam de verdade e quem decide é quem está com o rolo na mão.
 */
const TOLERANCIA_G = 1;

/**
 * O número como o usuário o escreve: vírgula decimal.
 *
 * Desde que os campos decimais aceitam vírgula (ver `Entrada.svelte`), um rolo
 * pode ser cadastrado com carretel de `212,3 g` — e a mensagem de recusa
 * respondia "212.3 g", com ponto, sobre um número que ela mesma acabou de
 * aceitar com vírgula. Sem arredondar: a mensagem repete o dado, não o formata.
 */
const comoSeEscreve = (n: number) => String(n).replace('.', ',');

function numeroDoCampo(
	texto: string,
	campo: 'pesoBrutoG' | 'pesoLiquidoG',
	nome: string
): { ok: true; valor: number } | { ok: false; erro: string; campo: typeof campo } {
	const valor = textoParaNumero(texto);
	// `Number.isFinite` cobre NaN ("8OO" com letra O) e Infinity ("1e999") de uma
	// vez — o segundo passava por qualquer guarda que só olhasse NaN e sinal, e
	// um peso infinito ancoraria o estoque daquele rolo para sempre.
	if (!Number.isFinite(valor)) return { ok: false, erro: `${nome}: "${texto}" não é um número`, campo };
	if (valor <= 0) return { ok: false, erro: `${nome} deve ser maior que zero`, campo };
	return { ok: true, valor };
}

export function resolverPesagem(p: EntradaPesagem): Pesagem {
	const bruto = p.bruto.trim();
	const liquido = p.liquido.trim();

	if (!bruto && !liquido) {
		// O erro aponta para o BRUTO de propósito: é o campo que a balança
		// responde. Mandar o usuário para o líquido é mandá-lo para o número que
		// ele justamente não tem.
		return {
			ok: false,
			erro: 'informe o peso; o bruto é o que a balança mostra, com o carretel',
			campo: 'pesoBrutoG'
		};
	}

	let doLiquido: number | null = null;
	if (liquido) {
		const r = numeroDoCampo(liquido, 'pesoLiquidoG', 'peso líquido');
		if (!r.ok) return r;
		doLiquido = r.valor;
	}

	let convertido: number | null = null;
	if (bruto) {
		const r = numeroDoCampo(bruto, 'pesoBrutoG', 'peso bruto');
		if (!r.ok) return r;

		if (!(p.pesoCarretelG > 0)) {
			// Sem peso de carretel confiável não há conversão possível. Subtrair um
			// número inventado da leitura da balança seria pior do que pedir o
			// líquido: gravaria uma âncora errada com cara de medição.
			return {
				ok: false,
				erro:
					'este filamento está sem peso do carretel cadastrado; corrija o cadastro, ' +
					'ou pese o filamento fora do carretel e use o campo do líquido',
				campo: 'pesoBrutoG'
			};
		}

		convertido = Math.round((r.valor - p.pesoCarretelG) * 10) / 10;
		if (convertido <= 0) {
			return {
				ok: false,
				erro:
					`peso bruto (${comoSeEscreve(r.valor)} g) não passa do peso do carretel ` +
					`(${comoSeEscreve(p.pesoCarretelG)} g); ` +
					'confira se a balança está zerada, ou se o carretel do cadastro é este mesmo',
				campo: 'pesoBrutoG'
			};
		}
	}

	if (doLiquido !== null && convertido !== null) {
		if (Math.abs(doLiquido - convertido) > TOLERANCIA_G) {
			return {
				ok: false,
				erro:
					`os dois pesos não batem: ${p.bruto.trim()} g brutos menos ` +
					`${comoSeEscreve(p.pesoCarretelG)} g de carretel dá ${comoSeEscreve(convertido)} g, ` +
					`e o campo do líquido diz ${comoSeEscreve(doLiquido)} g; ` +
					'apague um dos dois e deixe o sistema converter',
				campo: 'pesoLiquidoG'
			};
		}
		// Coerentes: vale o líquido, que é o número que a coluna guarda. Preferir
		// o convertido aqui faria a pesagem mudar de valor conforme o campo em que
		// se digitou, com os dois na tela dizendo a mesma coisa.
		return { ok: true, pesoLiquidoG: doLiquido, origem: 'liquido' };
	}

	if (doLiquido !== null) return { ok: true, pesoLiquidoG: doLiquido, origem: 'liquido' };
	return { ok: true, pesoLiquidoG: convertido!, origem: 'bruto' };
}

/**
 * A sobra pesada no ENCERRAMENTO do rolo.
 *
 * É a mesma regra de `validarPesoAferido` com uma diferença, e ela é o ponto
 * inteiro: **zero é aceito**. Na pesagem avulsa, zero é sintoma de campo em
 * branco (`Number('')` é 0) e gravá-lo trava o rolo em 0 g para sempre; no
 * encerramento, zero é uma afirmação deliberada — "acabou, não sobrou nada" —,
 * e é justamente o número que fecha a conta entre o que o fatiador estimou e o
 * que o rolo rendeu.
 *
 * O campo do formulário é opcional e separado desta função: quem decide se
 * houve pesagem é `campoNumericoNaoNegativoOpcional`, e só o que ele devolve
 * como número chega aqui.
 */
export function validarSobraFinal(sobraG: number, pesoInicialG: number): Validacao {
	if (!Number.isFinite(sobraG) || sobraG < 0) {
		return { ok: false, erro: 'sobra na balança não pode ser negativa' };
	}
	if (pesoInicialG > 0 && sobraG > pesoInicialG) {
		return {
			ok: false,
			erro:
				`sobra na balança (${sobraG} g) é maior que o peso líquido inicial do rolo ` +
				`(${pesoInicialG} g); confira a balança ou corrija o peso inicial no cadastro`
		};
	}
	return { ok: true };
}

export interface EntradaAlerta {
	restanteG: number;
	pesoInicialG: number;
	dataAbertura: number | null;
	dataUltimaSecagem: number | null;
	agora: number;
}

export interface Alerta {
	tipo: 'acabando' | 'umidade';
	gravidade: 'aviso';
}

export function alertasDoRolo(p: EntradaAlerta): Alerta[] {
	const alertas: Alerta[] = [];

	// Rolo lacrado não tem o que alertar.
	if (p.dataAbertura === null) return alertas;

	const percentual = p.pesoInicialG > 0 ? p.restanteG / p.pesoInicialG : 0;
	if (percentual <= LIMITE_PERCENTUAL || p.restanteG <= LIMITE_GRAMAS) {
		alertas.push({ tipo: 'acabando', gravidade: 'aviso' });
	}

	// PLA e principalmente PETG absorvem umidade do ar e passam a imprimir
	// mal — sintoma que costuma ser confundido com defeito da máquina.
	const referencia = p.dataUltimaSecagem ?? p.dataAbertura;
	const dias = (p.agora - referencia) / 86_400_000;
	if (dias > DIAS_ATE_SECAR) {
		alertas.push({ tipo: 'umidade', gravidade: 'aviso' });
	}

	return alertas;
}
