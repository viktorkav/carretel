import { describe, expect, it } from 'vitest';
import {
	campoCorHex,
	campoDataHora,
	campoDataHoraObrigatoria,
	campoId,
	campoIds,
	campoNumericoNaoNegativoOpcional,
	campoNumericoObrigatorio,
	campoNumericoOpcional,
	campoNumericoPositivo,
	campoPreco,
	campoPrecoObrigatorio,
	ecoDoFormulario
} from './formulario';

describe('campoNumericoPositivo', () => {
	it('usa o padrão quando o campo é null (ausente)', () => {
		expect(campoNumericoPositivo(null, 5000, 'vida útil')).toEqual({ ok: true, valor: 5000 });
	});

	it('usa o padrão quando o campo vem vazio', () => {
		expect(campoNumericoPositivo('', 5000, 'vida útil')).toEqual({ ok: true, valor: 5000 });
	});

	it('usa o padrão quando o campo vem só com espaços', () => {
		expect(campoNumericoPositivo('   ', 100, 'potência')).toEqual({ ok: true, valor: 100 });
	});

	it('usa o padrão quando o texto não é numérico', () => {
		expect(campoNumericoPositivo('abc', 1.24, 'densidade')).toEqual({ ok: true, valor: 1.24 });
	});

	it('aceita o número digitado quando ele é positivo', () => {
		expect(campoNumericoPositivo('8000', 5000, 'vida útil')).toEqual({ ok: true, valor: 8000 });
	});

	it('aceita número decimal positivo', () => {
		expect(campoNumericoPositivo('1.4', 1.24, 'densidade')).toEqual({ ok: true, valor: 1.4 });
	});

	it('recusa zero com mensagem de erro', () => {
		const r = campoNumericoPositivo('0', 5000, 'vida útil');
		expect(r.ok).toBe(false);
		expect(r).toEqual({ ok: false, erro: 'vida útil deve ser maior que zero' });
	});

	it('recusa negativo com mensagem de erro', () => {
		const r = campoNumericoPositivo('-100', 250, 'peso do carretel');
		expect(r.ok).toBe(false);
		expect(r).toEqual({ ok: false, erro: 'peso do carretel deve ser maior que zero' });
	});

	it('recusa infinito — "1e999" não é NaN nem <= 0 e chegava até o banco', () => {
		// `Number('1e999')` é Infinity: passava por aqui e gravava
		// `peso_liquido_inicial_g = Inf`, que a tela renderizava como
		// `<progress value="Infinity">` e nenhuma conta de estoque suporta.
		const r = campoNumericoPositivo('1e999', 1000, 'peso líquido inicial');
		expect(r).toEqual({ ok: false, erro: 'peso líquido inicial é grande demais' });
	});

	it('recusa infinito escrito por extenso', () => {
		expect(campoNumericoPositivo('Infinity', 1000, 'peso').ok).toBe(false);
	});

	it('o padrão NaN continua passando — é assim que /rolos exige a aferição', () => {
		// `aferir` usa padrão NaN de propósito e checa a finitude depois, pra
		// transformar "campo vazio" em "campo obrigatório". A trava do infinito
		// não pode atropelar isso.
		const r = campoNumericoPositivo('', NaN, 'peso aferido');
		expect(r.ok).toBe(true);
		expect(r.ok && Number.isNaN(r.valor)).toBe(true);
	});
	// Infinity não é NaN (não vira padrão) e não é ≤ 0 (não cai na guarda de
	// sinal): ia gravado. É o mesmo caso de zero e negativo — número digitado,
	// fora de faixa —, então é erro.
	it('recusa 1e999 em vez de gravar Infinity', () => {
		const r = campoNumericoPositivo('1e999', 5000, 'vida útil');
		expect(r.ok).toBe(false);
	});
});

describe('campoCorHex', () => {
	it('aceita vazio — cor sem hex é normal', () => {
		expect(campoCorHex(null, 'cor')).toEqual({ ok: true, valor: '' });
		expect(campoCorHex('  ', 'cor')).toEqual({ ok: true, valor: '' });
	});

	it('aceita hex de 6 dígitos e normaliza pra caixa alta', () => {
		expect(campoCorHex('#bb9af7', 'cor')).toEqual({ ok: true, valor: '#BB9AF7' });
	});

	it('aceita hex sem o "#"', () => {
		expect(campoCorHex('BB9AF7', 'cor')).toEqual({ ok: true, valor: '#BB9AF7' });
	});

	it('recusa CSS arbitrário — o valor vai direto pra style="background-color"', () => {
		const r = campoCorHex('red; background-image: url(http://x/y)', 'cor');
		expect(r.ok).toBe(false);
	});

	it('recusa hex de 3 dígitos e de 8', () => {
		expect(campoCorHex('#fff', 'cor').ok).toBe(false);
		expect(campoCorHex('#FF6A13FF', 'cor').ok).toBe(false);

	});
});

/**
 * ── os helpers de EDIÇÃO ────────────────────────────────────────────────────
 * A diferença de contrato com os de criação é uma só, e é a que importa: campo
 * em branco não tem padrão, porque na edição o formulário volta preenchido e
 * limpar um campo é apagar um valor guardado.
 */
describe('campoNumericoObrigatorio', () => {
	it('recusa ausente, vazio e só espaços — onde a versão de criação usaria o padrão', () => {
		expect(campoNumericoObrigatorio(null, 'vida útil').ok).toBe(false);
		expect(campoNumericoObrigatorio('', 'vida útil').ok).toBe(false);
		expect(campoNumericoObrigatorio('   ', 'vida útil').ok).toBe(false);
		// contraste explícito com o helper de criação
		expect(campoNumericoPositivo('', 5000, 'vida útil')).toEqual({ ok: true, valor: 5000 });
	});

	it('recusa texto não numérico — inclusive o typo com letra O no lugar do zero', () => {
		expect(campoNumericoObrigatorio('abc', 'densidade').ok).toBe(false);
		expect(campoNumericoObrigatorio('8OOO', 'vida útil').ok).toBe(false);
	});

	it('recusa infinito, zero e negativo', () => {
		expect(campoNumericoObrigatorio('1e999', 'vida útil').ok).toBe(false);
		expect(campoNumericoObrigatorio('0', 'vida útil').ok).toBe(false);
		expect(campoNumericoObrigatorio('-5', 'vida útil').ok).toBe(false);
	});

	it('aceita número positivo, inteiro ou decimal', () => {
		expect(campoNumericoObrigatorio('8000', 'vida útil')).toEqual({ ok: true, valor: 8000 });
		expect(campoNumericoObrigatorio('1.31', 'densidade')).toEqual({ ok: true, valor: 1.31 });
	});

	it('nomeia o campo na mensagem, para o erro dizer qual dos seis é', () => {
		expect(campoNumericoObrigatorio('', 'potência média')).toEqual({
			ok: false,
			erro: 'potência média não pode ficar em branco'
		});
		expect(campoNumericoObrigatorio('8OOO', 'vida útil')).toEqual({
			ok: false,
			erro: 'vida útil: "8OOO" não é um número'
		});
	});
});

/**
 * O único campo do projeto em que ZERO é uma afirmação, e não campo em branco:
 * a sobra pesada no encerramento de um rolo que acabou. Todos os outros
 * numéricos recusam zero de propósito (peso inicial zero é divisão por zero no
 * custo; pesagem zero avulsa é `Number('')`).
 */
describe('campoNumericoNaoNegativoOpcional', () => {
	it('aceita zero, que aqui quer dizer "acabou, não sobrou nada"', () => {
		expect(campoNumericoNaoNegativoOpcional('0', 'sobra')).toEqual({ ok: true, valor: 0 });
		expect(campoNumericoNaoNegativoOpcional('0.0', 'sobra')).toEqual({ ok: true, valor: 0 });
	});

	it('aceita vazio como "não pesei"', () => {
		expect(campoNumericoNaoNegativoOpcional('', 'sobra')).toEqual({ ok: true, valor: null });
		expect(campoNumericoNaoNegativoOpcional(null, 'sobra')).toEqual({ ok: true, valor: null });
		expect(campoNumericoNaoNegativoOpcional('   ', 'sobra')).toEqual({ ok: true, valor: null });
	});

	it('recusa lixo — uma pesagem digitada errada não pode sumir como "não pesei"', () => {
		expect(campoNumericoNaoNegativoOpcional('abc', 'sobra').ok).toBe(false);
		expect(campoNumericoNaoNegativoOpcional('5g', 'sobra').ok).toBe(false);
	});

	it('recusa negativo e infinito', () => {
		expect(campoNumericoNaoNegativoOpcional('-1', 'sobra').ok).toBe(false);
		expect(campoNumericoNaoNegativoOpcional('1e999', 'sobra').ok).toBe(false);
	});

	/**
	 * ⚠️ Este teste MUDOU DE LADO na integração, e a premissa dele é o motivo.
	 *
	 * Ele afirmava que a vírgula não chega aqui, porque o campo era
	 * `<input type="number">` — que em pt-BR exibe vírgula e submete a forma
	 * canônica. A premissa caiu duas vezes: `type="number"` **recusa a vírgula
	 * na digitação** (o teclado do usuário nem escreve o caractere, e o
	 * comportamento varia com o idioma do sistema), e por isso os campos
	 * decimais do projeto passaram a `type="text" inputmode="decimal"` — que
	 * submete exatamente o que foi digitado, vírgula inclusive.
	 *
	 * Este era o ÚNICO numérico do arquivo que ainda recusava `6,4`: ele nasceu
	 * na frente do encerramento, saída de uma base anterior à correção da
	 * vírgula. Um campo do mesmo formulário aceitando e o vizinho recusando é
	 * exatamente a divergência que escondeu o defeito da densidade.
	 */
	it('aceita decimal com ponto E com vírgula, como todo numérico do projeto', () => {
		expect(campoNumericoNaoNegativoOpcional('6.4', 'sobra')).toEqual({ ok: true, valor: 6.4 });
		expect(campoNumericoNaoNegativoOpcional('6,4', 'sobra')).toEqual({ ok: true, valor: 6.4 });
	});

	it('nomeia o campo na mensagem', () => {
		expect(campoNumericoNaoNegativoOpcional('abc', 'sobra na balança')).toEqual({
			ok: false,
			erro: 'sobra na balança: "abc" não é um número'
		});
	});
});

describe('campoNumericoOpcional', () => {
	it('aceita vazio como "não informado"', () => {
		expect(campoNumericoOpcional('', 'camada')).toEqual({ ok: true, valor: null });
		expect(campoNumericoOpcional(null, 'camada')).toEqual({ ok: true, valor: null });
	});

	it('recusa lixo em vez de deixá-lo virar null — que seria indistinguível de apagar', () => {
		expect(campoNumericoOpcional('abc', 'camada').ok).toBe(false);
		expect(campoNumericoOpcional('1e999', 'camada').ok).toBe(false);
		expect(campoNumericoOpcional('-1', 'camada').ok).toBe(false);
	});

	it('aceita número positivo', () => {
		expect(campoNumericoOpcional('0.2', 'camada')).toEqual({ ok: true, valor: 0.2 });
	});
});

describe('campoPrecoObrigatorio', () => {
	it('recusa em branco, onde a versão de criação gravaria zero', () => {
		expect(campoPrecoObrigatorio('', 'preço pago').ok).toBe(false);
		expect(campoPrecoObrigatorio(null, 'preço pago').ok).toBe(false);
		expect(campoPreco('', 'preço pago')).toEqual({ ok: true, valor: 0 });
	});

	// Precisa aceitar zero DIGITADO: é assim que "preço não informado" volta
	// preenchido no formulário de edição ("0,00").
	it('aceita zero digitado', () => {
		expect(campoPrecoObrigatorio('0,00', 'preço pago')).toEqual({ ok: true, valor: 0 });
	});

	it('recusa typo e valor fora de faixa', () => {
		expect(campoPrecoObrigatorio('129,9O', 'preço pago').ok).toBe(false);
		expect(campoPrecoObrigatorio('1e999', 'preço pago').ok).toBe(false);
		expect(campoPrecoObrigatorio('-10', 'preço pago').ok).toBe(false);
	});

	it('lê preço normal', () => {
		expect(campoPrecoObrigatorio('1.899', 'preço pago')).toEqual({ ok: true, valor: 189900 });
	});
});

describe('campoDataHoraObrigatoria', () => {
	it('recusa em branco, onde a versão de criação usaria "agora"', () => {
		expect(campoDataHoraObrigatoria('', 'início').ok).toBe(false);
		expect(campoDataHoraObrigatoria(null, 'início').ok).toBe(false);
		expect(campoDataHora('', 12345)).toEqual({ ok: true, valor: 12345 });
	});

	it('recusa texto que não é data', () => {
		expect(campoDataHoraObrigatoria('abc', 'início').ok).toBe(false);
		expect(campoDataHoraObrigatoria('2026-13-01T10:00', 'início').ok).toBe(false);
	});

	it('lê datetime-local no fuso do processo', () => {
		expect(campoDataHoraObrigatoria('2026-08-09T21:00', 'início')).toEqual({
			ok: true,
			valor: new Date(2026, 7, 9, 21, 0).getTime()
		});
	});
});

describe('campoId', () => {
	it('aceita id inteiro positivo', () => {
		expect(campoId('7', 'escolha um rolo')).toEqual({ ok: true, valor: 7 });
	});

	it('recusa id ausente', () => {
		expect(campoId(null, 'escolha um rolo')).toEqual({ ok: false, erro: 'escolha um rolo' });
	});

	it('recusa id vazio', () => {
		expect(campoId('', 'escolha um rolo').ok).toBe(false);
	});

	it('recusa id não numérico', () => {
		expect(campoId('abc', 'escolha um rolo').ok).toBe(false);
	});

	it('recusa zero e negativo', () => {
		expect(campoId('0', 'escolha um rolo').ok).toBe(false);
		expect(campoId('-3', 'escolha um rolo').ok).toBe(false);
	});

	// Id fracionário chegaria ao `where` como 1.5 e simplesmente não acharia
	// linha nenhuma — mas o certo é recusar na borda, não deixar virar
	// "não encontrado" mais adiante.
	it('recusa id fracionário', () => {
		expect(campoId('1.5', 'escolha um rolo').ok).toBe(false);
	});

	it('devolve exatamente a mensagem que o chamador passou', () => {
		expect(campoId('x', 'escolha uma impressora')).toEqual({
			ok: false,
			erro: 'escolha uma impressora'
		});
	});
});

describe('campoDataHora', () => {
	const AGORA = 1_754_700_000_000;

	it('usa "agora" quando o campo vem ausente', () => {
		expect(campoDataHora(null, AGORA)).toEqual({ ok: true, valor: AGORA });
	});

	it('usa "agora" quando o campo vem vazio', () => {
		expect(campoDataHora('', AGORA)).toEqual({ ok: true, valor: AGORA });
	});

	it('converte datetime-local no fuso do processo', () => {
		const r = campoDataHora('2026-08-09T21:00', AGORA);
		expect(r.ok).toBe(true);
		expect(r).toEqual({ ok: true, valor: new Date(2026, 7, 9, 21, 0).getTime() });
	});

	it('recusa texto que não é data em vez de gravar NaN', () => {
		expect(campoDataHora('abc', AGORA)).toEqual({ ok: false, erro: 'data de início inválida' });
	});

	// Sem estes casos, uma implementação que só olhasse o formato com regex
	// passaria: os três têm a cara de um datetime-local.
	it('recusa mês e hora fora de faixa', () => {
		expect(campoDataHora('2026-13-01T10:00', AGORA).ok).toBe(false);
		expect(campoDataHora('2026-08-09T25:00', AGORA).ok).toBe(false);
		expect(campoDataHora('2026-99-99T99:99', AGORA).ok).toBe(false);
	});

	// Documentado, não desejado: dia fora do mês o próprio `Date` rola pra
	// frente (30/02 vira 02/03). Não vale código extra — o campo é um picker
	// de navegador, que não produz isso, e o resultado é uma data plausível,
	// não um NaN que estoura o `notNull` do banco.
	it('deixa o Date rolar o dia excedente do mês, sem quebrar', () => {
		const r = campoDataHora('2026-02-30T10:00', AGORA);
		expect(r).toEqual({ ok: true, valor: new Date(2026, 2, 2, 10, 0).getTime() });
	});
});

describe('campoPreco', () => {
	it('aceita preço com vírgula decimal', () => {
		expect(campoPreco('129,90', 'preço do rolo')).toEqual({ ok: true, valor: 12990 });
	});

	it('aceita preço com separador de milhar sem centavos', () => {
		expect(campoPreco('1.899', 'preço da impressora')).toEqual({ ok: true, valor: 189900 });
	});

	// Preço legitimamente desconhecido continua possível — mas só EM BRANCO,
	// de forma explícita. Zero deixa de ser o destino de qualquer lixo digitado.
	it('trata campo em branco como "preço não informado" (zero)', () => {
		expect(campoPreco('', 'preço do rolo')).toEqual({ ok: true, valor: 0 });
		expect(campoPreco(null, 'preço do rolo')).toEqual({ ok: true, valor: 0 });
		expect(campoPreco('   ', 'preço do rolo')).toEqual({ ok: true, valor: 0 });
	});

	it('recusa typo em vez de virar R$ 0,00 silenciosamente', () => {
		const r = campoPreco('129,9O', 'preço do rolo');
		expect(r.ok).toBe(false);
		expect(r).toEqual({
			ok: false,
			erro: 'preço do rolo inválido; use algo como 129,90, ou deixe em branco se não souber'
		});
	});

	it('recusa zero e negativo digitados', () => {
		expect(campoPreco('0', 'preço do rolo').ok).toBe(false);
		expect(campoPreco('0,00', 'preço do rolo').ok).toBe(false);
		expect(campoPreco('-10', 'preço do rolo').ok).toBe(false);
	});
});

describe('vírgula decimal — o separador que se digita em português', () => {
	it('aceita vírgula na densidade, em vez de cair no padrão em silêncio', () => {
		// Antes: Number('1,27') era NaN, a regra "não numérico usa o padrão"
		// gravava 1,24 e a tela dizia "cadastrado com sucesso".
		expect(campoNumericoPositivo('1,27', 1.24, 'densidade')).toEqual({ ok: true, valor: 1.27 });
	});

	it('aceita vírgula onde a edição exige valor', () => {
		expect(campoNumericoObrigatorio('938,5', 'peso aferido')).toEqual({ ok: true, valor: 938.5 });
	});

	it('continua aceitando ponto, que é o que o teclado do celular oferece', () => {
		expect(campoNumericoPositivo('1.27', 1.24, 'densidade')).toEqual({ ok: true, valor: 1.27 });
	});

	it('texto que não é número continua sendo texto que não é número', () => {
		const r = campoNumericoObrigatorio('1,2,3', 'densidade');
		expect(r.ok).toBe(false);
	});
});

describe('infill 0% é peça vazada, não erro de digitação', () => {
	it('aceita zero quando o campo permite', () => {
		expect(campoNumericoOpcional('0', 'infill', { permiteZero: true })).toEqual({
			ok: true,
			valor: 0
		});
	});

	it('recusa negativo mesmo permitindo zero', () => {
		const r = campoNumericoOpcional('-5', 'infill', { permiteZero: true });
		expect(r.ok).toBe(false);
	});

	it('sem a permissão, zero continua sendo erro', () => {
		const r = campoNumericoOpcional('0', 'altura de camada');
		expect(r.ok).toBe(false);
	});
});

describe('campoIds — a lista de marcadas de uma edição em lote', () => {
	function formDe(valores: string[]) {
		const f = new FormData();
		for (const v of valores) f.append('marcada', v);
		return f;
	}

	it('lê os inteiros positivos na ordem em que vieram', () => {
		expect(campoIds(formDe(['3', '1', '7']), 'marcada')).toEqual([3, 1, 7]);
	});

	it('descarta o que não é id em vez de deixar chegar ao banco', () => {
		// Mesma lei de `campoId`: nenhuma action responde 500 por entrada de
		// usuário, e `where id in (NaN)` é erro de driver, não de formulário.
		expect(campoIds(formDe(['abc', '0', '-1', '1.5', '', '4']), 'marcada')).toEqual([4]);
	});

	it('deduplica: marcar a mesma linha duas vezes é uma linha', () => {
		expect(campoIds(formDe(['5', '5', '5']), 'marcada')).toEqual([5]);
	});

	it('campo ausente é lista vazia, não erro', () => {
		expect(campoIds(new FormData(), 'marcada')).toEqual([]);
	});
});

describe('ecoDoFormulario — o que foi digitado volta com o erro', () => {
	it('devolve os campos pedidos como texto', () => {
		const f = new FormData();
		f.append('marca', 'Bambu');
		f.append('preco', '129,90');
		expect(ecoDoFormulario(f, ['marca', 'preco'])).toEqual({ marca: 'Bambu', preco: '129,90' });
	});

	it('campo ausente volta vazio, e não `undefined` renderizado na tela', () => {
		expect(ecoDoFormulario(new FormData(), ['marca'])).toEqual({ marca: '' });
	});

	it('preserva o espaço interno e o valor exatamente como digitado', () => {
		// O eco é para o humano reler o que ele escreveu. Normalizar aqui esconde
		// justamente o erro de digitação que ele precisa enxergar.
		const f = new FormData();
		f.append('cor', '  Preto  Fosco ');
		expect(ecoDoFormulario(f, ['cor']).cor).toBe('  Preto  Fosco ');
	});

	it('ignora arquivo, que não é texto para devolver ao campo', () => {
		const f = new FormData();
		f.append('anexo', new File(['x'], 'x.txt'));
		expect(ecoDoFormulario(f, ['anexo'])).toEqual({ anexo: '' });
	});
});
