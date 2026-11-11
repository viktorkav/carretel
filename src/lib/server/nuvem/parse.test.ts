import { describe, expect, it } from 'vitest';
import {
	TAREFA_ABORTADA,
	TAREFA_CONCLUIDA,
	TAREFA_MULTIFILAMENTO,
	TAREFA_SEM_AMS,
	TAREFA_SEM_FIM,
	TAREFA_TITULO_ESTRANHO,
	criarTarefaBruta
} from './fixtures';
import { filamentoPrincipal, lerPerfilFatiamento, normalizarTarefa } from './parse';

describe('lerPerfilFatiamento', () => {
	it('extrai camada, paredes e infill do formato conhecido', () => {
		expect(lerPerfilFatiamento('0.2mm layer, 2 walls, 15% infill')).toEqual({
			camadaMm: 0.2,
			paredes: 2,
			infillPct: 15
		});
	});

	it('aceita variações de espaçamento e singular', () => {
		expect(lerPerfilFatiamento('0.28 mm layer, 1 wall, 100 % infill')).toEqual({
			camadaMm: 0.28,
			paredes: 1,
			infillPct: 100
		});
	});

	it('devolve o que reconhecer e null no resto, em vez de tudo ou nada', () => {
		expect(lerPerfilFatiamento('0.16mm layer, 3 walls')).toEqual({
			camadaMm: 0.16,
			paredes: 3,
			infillPct: null
		});
	});

	it('não explode em formato inesperado', () => {
		expect(lerPerfilFatiamento('Perfil personalizado do Victor')).toEqual({
			camadaMm: null,
			paredes: null,
			infillPct: null
		});
	});

	it('não explode quando o campo nem é texto', () => {
		expect(lerPerfilFatiamento(undefined)).toEqual({
			camadaMm: null,
			paredes: null,
			infillPct: null
		});
		expect(lerPerfilFatiamento(42)).toEqual({ camadaMm: null, paredes: null, infillPct: null });
	});
});

describe('normalizarTarefa', () => {
	it('mapeia os campos da tarefa concluída', () => {
		const t = normalizarTarefa(TAREFA_CONCLUIDA);
		expect(t).not.toBeNull();
		expect(t!.taskId).toBe('912345678');
		expect(t!.nome).toBe('Suporte de microfone');
		expect(t!.status).toBe('sucesso');
		expect(t!.gramas).toBe(82.5);
		expect(t!.placaBuild).toBe('textured_plate');
		expect(t!.dispositivoNome).toBe('Unit-01(A1)');
		expect(t!.perfil).toEqual({ camadaMm: 0.2, paredes: 2, infillPct: 15 });
		expect(t!.importavel).toBe(true);
	});

	it('tira a duração da subtração, nunca do costTime', () => {
		// 18:00 → 20:00 = 7200 s. `costTime` da fixture é 12900 s.
		const t = normalizarTarefa(TAREFA_CONCLUIDA);
		expect(t!.duracaoS).toBe(7200);
		expect(t!.duracaoS).not.toBe(12_900);
	});

	it('numa tarefa abortada usa o intervalo real, não a estimativa cheia', () => {
		// A armadilha: `costTime` continua 12900 s (3h35 de estimativa) num job
		// que rodou 12 minutos. Duração alimenta energia, depreciação e
		// horímetro de uma vez — usar costTime envenena os três.
		const t = normalizarTarefa(TAREFA_ABORTADA);
		expect(t!.status).toBe('falha');
		expect(t!.duracaoS).toBe(720);
		expect(t!.importavel).toBe(true);
	});

	it('marca como não importável a tarefa sem endTime', () => {
		const t = normalizarTarefa(TAREFA_SEM_FIM);
		expect(t!.duracaoS).toBeNull();
		expect(t!.importavel).toBe(false);
		expect(t!.problema).toMatch(/término/i);
	});

	it('marca como não importável quando o fim vem antes do início', () => {
		const t = normalizarTarefa(
			criarTarefaBruta({ startTime: '2026-08-08T10:00:00Z', endTime: '2026-08-08T09:00:00Z' })
		);
		expect(t!.importavel).toBe(false);
		expect(t!.problema).toMatch(/intervalo/i);
	});

	it('diz que a peça ainda está imprimindo, em vez de "status desconhecido"', () => {
		// O 4 aparece toda vez que se importa com a máquina ligada. Recusar é
		// certo (peso ainda é estimativa, duração não existe), mas chamar de
		// desconhecido manda o usuário procurar defeito onde só há uma peça na
		// mesa. Foi o que aconteceu na primeira importação real.
		const t = normalizarTarefa(criarTarefaBruta({ status: 4 }));
		expect(t!.importavel).toBe(false);
		expect(t!.problema).toMatch(/ainda está imprimindo/i);
		expect(t!.problema).not.toMatch(/desconhecid/i);
	});

	it('marca como não importável o status que não é 2 nem 3', () => {
		const t = normalizarTarefa(criarTarefaBruta({ status: 1 }));
		expect(t!.status).toBeNull();
		expect(t!.importavel).toBe(false);
		expect(t!.problema).toMatch(/status/i);
	});

	it('lê os dois filamentos do amsDetailMapping', () => {
		const t = normalizarTarefa(TAREFA_MULTIFILAMENTO);
		expect(t!.filamentos).toHaveLength(2);
		expect(t!.filamentos[0]).toEqual({
			filamentId: 'GFA18',
			material: 'PLA',
			corHex: '#000000',
			gramas: 90
		});
		expect(t!.filamentos[1].material).toBe('PETG');
		expect(t!.filamentos[1].gramas).toBe(30);
		expect(t!.multifilamento).toBe(true);
	});

	it('aguenta amsDetailMapping vazio, caindo no peso total', () => {
		const t = normalizarTarefa(TAREFA_SEM_AMS);
		expect(t!.filamentos).toEqual([]);
		expect(t!.gramas).toBe(15.75);
		expect(t!.multifilamento).toBe(false);
		expect(t!.importavel).toBe(true);
	});

	it('aguenta amsDetailMapping que nem é lista', () => {
		const t = normalizarTarefa(criarTarefaBruta({ amsDetailMapping: 'nada disso' }));
		expect(t!.filamentos).toEqual([]);
		expect(t!.importavel).toBe(true);
	});

	it('não perde a tarefa por causa de um title fora do formato', () => {
		const t = normalizarTarefa(TAREFA_TITULO_ESTRANHO);
		expect(t!.importavel).toBe(true);
		expect(t!.perfil).toEqual({ camadaMm: null, paredes: null, infillPct: null });
		expect(t!.perfilBruto).toBe('Perfil personalizado do Victor');
	});

	it('aceita id numérico ou string, sempre virando texto', () => {
		expect(normalizarTarefa(criarTarefaBruta({ id: 77 }))!.taskId).toBe('77');
		expect(normalizarTarefa(criarTarefaBruta({ id: '77' }))!.taskId).toBe('77');
	});

	it('descarta o que não tem id — sem id não há deduplicação', () => {
		expect(normalizarTarefa(criarTarefaBruta({ id: null }))).toBeNull();
		expect(normalizarTarefa(null)).toBeNull();
		expect(normalizarTarefa('tarefa')).toBeNull();
	});

	it('usa um nome de reserva quando designTitle vem vazio', () => {
		const t = normalizarTarefa(criarTarefaBruta({ id: 5, designTitle: '' }));
		expect(t!.nome).toBe('tarefa 5');
	});

	it('cai no somatório do AMS quando o peso total não vem, e nunca produz NaN', () => {
		expect(normalizarTarefa(criarTarefaBruta({ weight: undefined }))!.gramas).toBe(82.5);
		expect(
			normalizarTarefa(criarTarefaBruta({ weight: 'muito', amsDetailMapping: [] }))!.gramas
		).toBe(0);
	});
});

describe('filamentoPrincipal', () => {
	it('é o de maior gramagem numa peça multimaterial', () => {
		const t = normalizarTarefa(TAREFA_MULTIFILAMENTO)!;
		expect(filamentoPrincipal(t)?.filamentId).toBe('GFA18');
	});

	it('é null quando não há detalhamento', () => {
		expect(filamentoPrincipal(normalizarTarefa(TAREFA_SEM_AMS)!)).toBeNull();
	});
});

describe('normalizarTarefa — peso que envenena o estoque', () => {
	it('barra peso negativo', () => {
		// O motor de custo satura em zero, mas o de estoque SOMA: -50 g
		// devolveria 50 g ao rolo e a barra de restante passaria a mentir.
		const t = normalizarTarefa(criarTarefaBruta({ weight: -50, amsDetailMapping: [] }))!;
		expect(t.gramas).toBe(-50);
		expect(t.importavel).toBe(false);
		expect(t.problema).toMatch(/negativ/i);
	});

	it('barra peso zero', () => {
		const t = normalizarTarefa(criarTarefaBruta({ weight: 0, amsDetailMapping: [] }))!;
		expect(t.importavel).toBe(false);
		expect(t.problema).toMatch(/zero/i);
	});

	it('lê decimal com vírgula em vez de virar zero', () => {
		// `Number('82,5')` é NaN, e NaN caía no somatório do AMS: 82,5 g viravam
		// 0 g e a impressão saía de graça.
		const t = normalizarTarefa(criarTarefaBruta({ weight: '82,5', amsDetailMapping: [] }))!;
		expect(t.gramas).toBe(82.5);
		expect(t.importavel).toBe(true);
	});

	it('trata vírgula de milhar sem inventar decimal', () => {
		const t = normalizarTarefa(criarTarefaBruta({ weight: '1,234.5', amsDetailMapping: [] }))!;
		expect(t.gramas).toBe(1234.5);
	});
});

describe('normalizarTarefa — multimaterial exige aceite', () => {
	it('marca a peça de dois filamentos como pendente de confirmação', () => {
		const t = normalizarTarefa(TAREFA_MULTIFILAMENTO)!;
		expect(t.importavel).toBe(true);
		expect(t.exigeConfirmacao).toBe(true);
		expect(t.avisoConfirmacao).toMatch(/um rolo só/);
	});

	it('não exige nada de uma peça de filamento único', () => {
		const t = normalizarTarefa(TAREFA_CONCLUIDA)!;
		expect(t.exigeConfirmacao).toBe(false);
		expect(t.avisoConfirmacao).toBeNull();
	});

	it('não pede confirmação de tarefa que já não é importável', () => {
		const t = normalizarTarefa(criarTarefaBruta({ status: 1 }))!;
		expect(t.exigeConfirmacao).toBe(false);
	});
});

describe('normalizarTarefa — o comprimento de filamento', () => {
	it('lê `length` em centímetros', () => {
		const t = normalizarTarefa(criarTarefaBruta({ length: 2765.9 }))!;
		expect(t.comprimentoCm).toBe(2765.9);
	});

	it('trata comprimento ausente como "não veio", e não como zero', () => {
		expect(normalizarTarefa(criarTarefaBruta({ length: null }))!.comprimentoCm).toBeNull();
		expect(normalizarTarefa(criarTarefaBruta({ length: undefined }))!.comprimentoCm).toBeNull();
	});

	it('trata comprimento zero e negativo como ausente', () => {
		expect(normalizarTarefa(criarTarefaBruta({ length: 0 }))!.comprimentoCm).toBeNull();
		expect(normalizarTarefa(criarTarefaBruta({ length: -5 }))!.comprimentoCm).toBeNull();
	});

	it('aguenta comprimento que veio como texto, inclusive com vírgula', () => {
		expect(normalizarTarefa(criarTarefaBruta({ length: '2765,9' }))!.comprimentoCm).toBe(2765.9);
	});

	it('não derruba a tarefa por causa de um comprimento imprestável', () => {
		const t = normalizarTarefa(criarTarefaBruta({ length: 'sei lá' }))!;
		expect(t.comprimentoCm).toBeNull();
		expect(t.importavel).toBe(true);
	});
});

describe('normalizarTarefa — o peso de uma peça que abortou', () => {
	it('exige peso real da tarefa abortada, porque o da nuvem é a estimativa cheia', () => {
		const t = normalizarTarefa(TAREFA_ABORTADA)!;
		expect(t.status).toBe('falha');
		expect(t.exigePesoReal).toBe(true);
		expect(t.avisoPeso).toMatch(/estimativa cheia/);
	});

	it('não exige nada da peça que terminou bem', () => {
		const t = normalizarTarefa(TAREFA_CONCLUIDA)!;
		expect(t.exigePesoReal).toBe(false);
		expect(t.avisoPeso).toBeNull();
		expect(t.gramasRateadas).toBeNull();
	});

	it('não pede peso de tarefa que já não é importável', () => {
		const t = normalizarTarefa(criarTarefaBruta({ status: 3, endTime: null }))!;
		expect(t.importavel).toBe(false);
		expect(t.exigePesoReal).toBe(false);
	});

	it('sugere o peso rateado pela fração de tempo decorrido', () => {
		// 12 min corridos de 3h35 estimadas, sobre 4,2 g de estimativa cheia.
		const t = normalizarTarefa(TAREFA_ABORTADA)!;
		expect(t.tempoEstimadoS).toBe(12_900);
		expect(t.duracaoS).toBe(720);
		expect(t.fracaoDecorrida).toBeCloseTo(720 / 12_900, 6);
		expect(t.gramasRateadas).toBeCloseTo(4.2 * (720 / 12_900), 2);
	});

	it('o caso do relatório: 17 s de trabalho não valem 202,67 g', () => {
		const t = normalizarTarefa(
			criarTarefaBruta({
				status: 3,
				startTime: '2026-08-09T10:00:00Z',
				endTime: '2026-08-09T10:00:17Z',
				costTime: 18_000,
				weight: 202.67
			})
		)!;
		expect(t.gramas).toBe(202.67);
		expect(t.exigePesoReal).toBe(true);
		expect(t.gramasRateadas).toBeLessThan(1);
	});

	it('satura a fração em 1 quando a peça passou do tempo estimado', () => {
		const t = normalizarTarefa(
			criarTarefaBruta({
				status: 3,
				startTime: '2026-08-09T10:00:00Z',
				endTime: '2026-08-09T20:00:00Z',
				costTime: 3600,
				weight: 50
			})
		)!;
		expect(t.fracaoDecorrida).toBe(1);
		expect(t.gramasRateadas).toBe(50);
	});

	it('fica sem sugestão quando a nuvem não mandou a estimativa de tempo', () => {
		const t = normalizarTarefa(
			criarTarefaBruta({
				status: 3,
				startTime: '2026-08-09T10:00:00Z',
				endTime: '2026-08-09T10:05:00Z',
				costTime: null,
				weight: 50
			})
		)!;
		expect(t.exigePesoReal).toBe(true);
		expect(t.tempoEstimadoS).toBeNull();
		expect(t.gramasRateadas).toBeNull();
		expect(t.avisoPeso).toMatch(/estimativa cheia/);
	});

	// A trava do projeto: `costTime` entrou no arquivo para ser denominador de
	// uma sugestão, e não pode ter virado duração pela porta dos fundos.
	it('a duração continua vindo da subtração, nunca de costTime', () => {
		const t = normalizarTarefa(TAREFA_ABORTADA)!;
		expect(t.duracaoS).toBe(720);
		expect(t.duracaoS).not.toBe(t.tempoEstimadoS);
	});
});

describe('normalizarTarefa — qual plate, de qual projeto', () => {
	it('lê o índice da plate e o identificador do projeto', () => {
		const t = normalizarTarefa(criarTarefaBruta({ plateIndex: 3, designId: 912_345 }))!;
		expect(t.indicePlate).toBe(3);
		expect(t.projetoId).toBe('912345');
	});

	// `designId: 0` é o que a nuvem manda quando o arquivo é do PRÓPRIO usuário —
	// não é um projeto, é a ausência de um. Se virasse a chave `"0"`, todo
	// arquivo local do dono cairia no MESMO projeto, e o card juntaria a caixa do
	// Rode com o Gridfinity. Zero vira `null`, e aí o nome volta a ser tudo o que há.
	it('designId 0 é "arquivo do próprio usuário", e não um projeto chamado zero', () => {
		expect(normalizarTarefa(criarTarefaBruta({ designId: 0 }))!.projetoId).toBeNull();
		expect(normalizarTarefa(criarTarefaBruta({ designId: '0' }))!.projetoId).toBeNull();
		expect(normalizarTarefa(criarTarefaBruta({ designId: -3 }))!.projetoId).toBeNull();
	});

	it('o identificador do projeto sobrevive como texto, e não como número', () => {
		// A API é engenharia reversa: um id que hoje é inteiro pode vir string
		// amanhã, e id de API não entra em aritmética nenhuma. Mesmo tratamento
		// que `taskId` já recebe.
		const t = normalizarTarefa(criarTarefaBruta({ designId: '  99887766  ' }))!;
		expect(t.projetoId).toBe('99887766');
	});

	it('campo ausente, nulo ou impossível vira "não identificada", nunca zero', () => {
		const semNada = normalizarTarefa({ id: 7 })!;
		expect(semNada.indicePlate).toBeNull();
		expect(semNada.projetoId).toBeNull();

		// O índice é um NÚMERO de plate: texto que não é número não é índice.
		for (const lixo of [null, '', 'plate um', {}, [], NaN, Infinity]) {
			expect(normalizarTarefa(criarTarefaBruta({ plateIndex: lixo }))!.indicePlate).toBeNull();
		}

		// O identificador do projeto é OPACO, como o `taskId`: texto não numérico
		// continua sendo um id (a API é engenharia reversa e pode trocar inteiro
		// por hash sem aviso). O que não é id: ausente, vazio e o zero.
		for (const lixo of [null, undefined, '', '   ', {}, [], NaN, Infinity]) {
			expect(normalizarTarefa(criarTarefaBruta({ designId: lixo }))!.projetoId).toBeNull();
		}
		expect(normalizarTarefa(criarTarefaBruta({ designId: 'a3f9c1' }))!.projetoId).toBe('a3f9c1');
	});

	// Plate 0 não existe no vocabulário do fatiador (o Bambu Studio numera a
	// partir de 1), e 0 é justamente o valor que esta API usa para "não se
	// aplica" (`designId: 0`, `instanceId: 0`). Aceitá-lo tem um custo
	// assimétrico: se 0 for "nenhuma", todas as plates de um projeto viram A
	// MESMA, que é exatamente a leitura proibida. Recusar só custa um
	// "plate não identificada" — degrada, não mente.
	it('índice 0, negativo ou fracionário não vira plate', () => {
		for (const v of [0, -1, 1.5, '2,5']) {
			expect(normalizarTarefa(criarTarefaBruta({ plateIndex: v }))!.indicePlate).toBeNull();
		}
	});

	it('índice em texto ainda é índice', () => {
		expect(normalizarTarefa(criarTarefaBruta({ plateIndex: '4' }))!.indicePlate).toBe(4);
	});

	// Nenhum dos dois campos é obrigatório para a tarefa entrar: eles servem à
	// LEITURA depois, e uma nuvem que pare de mandá-los não pode fechar a porta
	// da importação.
	it('a ausência dos dois não torna a tarefa inimportável', () => {
		const t = normalizarTarefa(criarTarefaBruta({ plateIndex: null, designId: null }))!;
		expect(t.importavel).toBe(true);
		expect(t.problema).toBeNull();
	});
});
