import { describe, expect, it } from 'vitest';
import {
	TAREFA_CONCLUIDA,
	TAREFA_MULTIFILAMENTO,
	TAREFA_SEM_AMS,
	TAREFA_SEM_FIM,
	criarTarefaBruta
} from './fixtures';
import { normalizarTarefa, type TarefaNuvem } from './parse';
import {
	agruparParaAtribuicao,
	chaveDeMaterial,
	encerradosQueCasam,
	rotuloDeMaterial,
	sugerirImpressora,
	sugerirRolo,
	type RoloCandidato
} from './sugestao';
import { resumirFinalidades } from '$lib/finalidade';

function tarefaDe(material: string, corHex: string, filamentId = 'GFA18'): TarefaNuvem {
	return normalizarTarefa(
		criarTarefaBruta({
			amsDetailMapping: [
				{ filamentId, filamentType: material, targetColor: corHex.replace('#', '') + 'FF', weight: 50 }
			]
		})
	)!;
}

function rolo(over: Partial<RoloCandidato> = {}): RoloCandidato {
	return {
		id: 1,
		apelido: null,
		status: 'aberto',
		material: 'PLA',
		corHex: '#000000',
		codigoBambu: 'GFA18',
		dataAbertura: null,
		...over
	};
}

describe('sugerirRolo', () => {
	it('sugere o rolo aberto do mesmo material', () => {
		const rolos = [rolo({ id: 1, material: 'PETG' }), rolo({ id: 2, material: 'PLA' })];
		expect(sugerirRolo(tarefaDe('PLA', '#000000'), rolos)).toBe(2);
	});

	/**
	 * Os ids vão INVERTIDOS de propósito: o candidato certo é o de id MENOR.
	 *
	 * O desempate final de `sugerirRolo` é `rolo.id > melhor.id`. Com o aberto
	 * também sendo o de id maior, o teste passava mesmo deletando o bônus de
	 * rolo aberto — ele confirmava a ordem dos ids, não a regra. Depois da
	 * fusão isso deixou de ser um detalhe: dois rolos iguais, um aberto e um
	 * lacrado, viraram o caso NORMAL, e é este bônus que impede o custo de sair
	 * do rolo que está na gaveta.
	 */
	it('prefere o aberto ao fechado quando os dois batem', () => {
		const rolos = [rolo({ id: 2, status: 'fechado' }), rolo({ id: 1, status: 'aberto' })];
		expect(sugerirRolo(tarefaDe('PLA', '#000000'), rolos)).toBe(1);
	});

	it('desempata pela cor', () => {
		const rolos = [
			rolo({ id: 1, corHex: '#FFFFFF' }),
			rolo({ id: 2, corHex: '#000000' }),
			rolo({ id: 3, corHex: '#FF0000' })
		];
		expect(sugerirRolo(tarefaDe('PLA', '#000000'), rolos)).toBe(2);
	});

	/**
	 * Ids invertidos pelo mesmo motivo do teste acima: aqui o rolo aberto mais
	 * recentemente é o de id MENOR, então `dataAbertura` precisa ser lida de
	 * verdade para a resposta sair certa. É este desempate que escolhe, entre
	 * dois rolos idênticos e abertos, o que está na máquina.
	 */
	it('desempata pelo rolo aberto mais recentemente', () => {
		const rolos = [
			rolo({ id: 2, dataAbertura: 1_700_000_000_000 }),
			rolo({ id: 1, dataAbertura: 1_750_000_000_000 })
		];
		expect(sugerirRolo(tarefaDe('PLA', '#000000'), rolos)).toBe(1);
	});

	it('nunca sugere rolo vazio ou descartado', () => {
		const rolos = [rolo({ id: 1, status: 'vazio' }), rolo({ id: 2, status: 'descartado' })];
		expect(sugerirRolo(tarefaDe('PLA', '#000000'), rolos)).toBeNull();
	});

	it('não sugere nada quando nenhum rolo é daquele material', () => {
		// Sugerir PETG para peça de PLA seria pior que não sugerir: confirmado
		// em lote, o custo sai do rolo errado e fica congelado sem sinal nenhum.
		const rolos = [rolo({ id: 1, material: 'PETG', codigoBambu: 'GFG99' })];
		expect(sugerirRolo(tarefaDe('PLA', '#000000'), rolos)).toBeNull();
	});

	it('casa pelo código do catálogo mesmo com o material escrito diferente', () => {
		const rolos = [rolo({ id: 7, material: 'PLA Basic', codigoBambu: 'GFA18' })];
		expect(sugerirRolo(tarefaDe('PLA', '#000000'), rolos)).toBe(7);
	});

	it('ignora caixa e espaço na comparação', () => {
		const rolos = [rolo({ id: 3, material: ' pla ', codigoBambu: 'gfa18' })];
		expect(sugerirRolo(tarefaDe('PLA', '#000000'), rolos)).toBe(3);
	});

	it('numa peça multimaterial sugere pelo filamento que mais pesou', () => {
		// 90 g de PLA contra 30 g de PETG.
		const t = normalizarTarefa(TAREFA_MULTIFILAMENTO)!;
		const rolos = [
			rolo({ id: 1, material: 'PETG', codigoBambu: 'GFG99', corHex: '#FFFFFF' }),
			rolo({ id: 2, material: 'PLA', codigoBambu: 'GFA18', corHex: '#000000' })
		];
		expect(sugerirRolo(t, rolos)).toBe(2);
	});

	it('não sugere nada sem detalhamento de filamento', () => {
		expect(sugerirRolo(normalizarTarefa(TAREFA_SEM_AMS)!, [rolo()])).toBeNull();
	});

	it('não sugere nada quando não há rolo cadastrado', () => {
		expect(sugerirRolo(tarefaDe('PLA', '#000000'), [])).toBeNull();
	});
});

describe('chaveDeMaterial', () => {
	it('junta tarefas do mesmo material e cor no mesmo grupo', () => {
		expect(chaveDeMaterial(tarefaDe('PLA', '#000000'))).toBe(
			chaveDeMaterial(tarefaDe('PLA', '#000000'))
		);
	});

	it('separa cores diferentes do mesmo material', () => {
		expect(chaveDeMaterial(tarefaDe('PLA', '#000000'))).not.toBe(
			chaveDeMaterial(tarefaDe('PLA', '#FFFFFF'))
		);
	});

	it('põe todas as tarefas sem detalhamento num grupo só', () => {
		expect(chaveDeMaterial(normalizarTarefa(TAREFA_SEM_AMS)!)).toBe('sem-detalhamento');
	});
});

describe('rotuloDeMaterial', () => {
	it('descreve o grupo de forma legível', () => {
		expect(rotuloDeMaterial(tarefaDe('PLA', '#000000'))).toBe('PLA · #000000 · GFA18');
	});

	it('diz quando não há detalhamento', () => {
		expect(rotuloDeMaterial(normalizarTarefa(TAREFA_SEM_AMS)!)).toMatch(/sem detalhamento/);
	});
});

describe('sugerirImpressora', () => {
	const t = normalizarTarefa(criarTarefaBruta({ deviceName: 'Unit-01(A1)' }))!;

	it('amarra pelo apelido que a máquina usa na nuvem', () => {
		const impressoras = [
			{ id: 1, nome: 'P1S', apelidoBambu: 'Unit-02(P1S)' },
			{ id: 2, nome: 'A1', apelidoBambu: 'Unit-01(A1)' }
		];
		expect(sugerirImpressora(t, impressoras)).toBe(2);
	});

	it('cai na única impressora cadastrada quando o apelido não bate', () => {
		expect(sugerirImpressora(t, [{ id: 9, nome: 'A1', apelidoBambu: null }])).toBe(9);
	});

	it('não escolhe por conta própria entre duas impressoras sem apelido', () => {
		const impressoras = [
			{ id: 1, nome: 'A1', apelidoBambu: null },
			{ id: 2, nome: 'P1S', apelidoBambu: null }
		];
		expect(sugerirImpressora(t, impressoras)).toBeNull();
	});
});

describe('agruparParaAtribuicao', () => {
	const impressoras = [{ id: 1, nome: 'A1', apelidoBambu: 'Unit-01(A1)' }];

	function tarefaEm(material: string, cor: string, quando: string, nome = 'x') {
		return normalizarTarefa(
			criarTarefaBruta({
				designTitle: nome,
				startTime: quando,
				endTime: quando.replace('T09', 'T11'),
				amsDetailMapping: [
					{
						filamentId: 'GF' + material,
						filamentType: material,
						targetColor: cor + 'FF',
						weight: 20
					}
				]
			})
		)!;
	}

	it('junta 50 tarefas do mesmo material num grupo só', () => {
		// O ponto de produto inteiro: importar 50 tarefas não pode virar 50
		// decisões manuais.
		const tarefas = Array.from({ length: 50 }, (_, i) =>
			tarefaEm('PLA', '000000', '2026-08-07T09:00:00Z', `peça ${i}`)
		);
		const grupos = agruparParaAtribuicao(
			tarefas,
			[rolo({ id: 4, codigoBambu: 'GFPLA' })],
			impressoras
		);

		expect(grupos).toHaveLength(1);
		expect(grupos[0].tarefas).toHaveLength(50);
		expect(grupos[0].roloSugeridoId).toBe(4);
	});

	it('separa material e cor em grupos diferentes, maior primeiro', () => {
		// O maior grupo aparece por último na ordem de chegada de propósito: é o
		// que separa "ordenou" de "manteve a ordem em que veio".
		const tarefas = [
			tarefaEm('PETG', 'FFFFFF', '2026-08-07T09:00:00Z'),
			tarefaEm('PLA', 'FF0000', '2026-08-07T09:00:00Z'),
			tarefaEm('PLA', '000000', '2026-08-07T09:00:00Z'),
			tarefaEm('PLA', '000000', '2026-08-07T09:00:00Z')
		];
		const grupos = agruparParaAtribuicao(tarefas, [], impressoras);

		expect(grupos.map((g) => g.tarefas.length)).toEqual([2, 1, 1]);
		expect(grupos[0].rotulo).toMatch(/#000000/);
	});

	it('ordena as tarefas do grupo da mais recente para a mais antiga', () => {
		const tarefas = [
			tarefaEm('PLA', '000000', '2026-08-01T09:00:00Z', 'antiga'),
			tarefaEm('PLA', '000000', '2026-08-09T09:00:00Z', 'nova')
		];
		const [g] = agruparParaAtribuicao(tarefas, [], impressoras);
		expect(g.tarefas.map((t) => t.nome)).toEqual(['nova', 'antiga']);
	});

	it('carrega a sugestão de impressora por tarefa e o motivo de quem não dá para importar', () => {
		const grupos = agruparParaAtribuicao(
			[normalizarTarefa(TAREFA_SEM_FIM)!, normalizarTarefa(TAREFA_CONCLUIDA)!],
			[rolo({ id: 2 })],
			impressoras
		);
		const linhas = grupos.flatMap((g) => g.tarefas);

		expect(linhas.every((l) => l.impressoraSugeridaId === 1)).toBe(true);
		const semFim = linhas.find((l) => l.taskId === '912345680')!;
		expect(semFim.importavel).toBe(false);
		expect(semFim.problema).toMatch(/término/i);
	});

	it('devolve lista vazia quando não há nada novo', () => {
		expect(agruparParaAtribuicao([], [rolo()], impressoras)).toEqual([]);
	});
});

describe('agruparParaAtribuicao — o que a tela precisa para não errar em bloco', () => {
	const impressoras = [{ id: 1, nome: 'A1', apelidoBambu: 'Unit-01(A1)' }];

	function tarefaEm(material: string, cor: string, quando: string, nome = 'x') {
		return normalizarTarefa(
			criarTarefaBruta({
				designTitle: nome,
				startTime: quando,
				endTime: quando.replace('T09', 'T11'),
				amsDetailMapping: [
					{ filamentId: 'GF' + material, filamentType: material, targetColor: cor + 'FF', weight: 20 }
				]
			})
		)!;
	}

	it('leva o aceite pendente da peça multimaterial até a linha', () => {
		const [g] = agruparParaAtribuicao(
			[normalizarTarefa(TAREFA_MULTIFILAMENTO)!],
			[rolo({ id: 1, codigoBambu: 'GFA18' })],
			impressoras
		);
		expect(g.tarefas[0].exigeConfirmacao).toBe(true);
		expect(g.tarefas[0].avisoConfirmacao).toMatch(/um rolo só/);
	});

	it('junta as tarefas sem detalhamento numa chave que a tela sabe tratar à parte', () => {
		// Este grupo pode misturar PLA e PETG: a tela não oferece lote nele.
		const [g] = agruparParaAtribuicao(
			[normalizarTarefa(TAREFA_SEM_AMS)!],
			[rolo({ id: 1 })],
			impressoras
		);
		expect(g.chave).toBe('sem-detalhamento');
		expect(g.roloSugeridoId).toBeNull();
	});

	it('carrega a finalidade sugerida pelo histórico daquela peça', () => {
		// A primeira das três camadas, replicada do rolo. Sem ela, a finalidade
		// nasceria sempre no mesmo balde — que é o defeito que o card "Por
		// finalidade" denunciou com uma barra só, de 100%.
		const historico = resumirFinalidades([
			{ nome: 'MagicTray', finalidade: 'homelab', inicioEm: 1 }
		]);
		const [g] = agruparParaAtribuicao(
			[tarefaEm('PLA', '000000', '2026-08-07T09:00:00Z', 'MagicTray.3mf')],
			[],
			impressoras,
			historico
		);
		expect(g.tarefas[0].finalidadeSugerida).toBe('homelab');
	});

	it('deixa a finalidade sugerida nula quando a peça é inédita', () => {
		const [g] = agruparParaAtribuicao(
			[tarefaEm('PLA', '000000', '2026-08-07T09:00:00Z', 'peça nova')],
			[],
			impressoras,
			resumirFinalidades([{ nome: 'MagicTray', finalidade: 'homelab', inicioEm: 1 }])
		);
		expect(g.tarefas[0].finalidadeSugerida).toBeNull();
	});

	it('sem histórico nenhum, nenhuma linha vem sugerida', () => {
		const [g] = agruparParaAtribuicao(
			[tarefaEm('PLA', '000000', '2026-08-07T09:00:00Z', 'MagicTray')],
			[],
			impressoras
		);
		expect(g.tarefas[0].finalidadeSugerida).toBeNull();
	});
});

describe('agruparParaAtribuicao — o que a linha leva para a tela', () => {
	it('leva o aviso de peso e a sugestão rateada da peça abortada', () => {
		const abortada = normalizarTarefa(
			criarTarefaBruta({
				id: 90_001,
				status: 3,
				startTime: '2026-08-09T10:00:00Z',
				endTime: '2026-08-09T10:03:00Z',
				costTime: 18_000,
				weight: 202.67
			})
		)!;
		const [grupo] = agruparParaAtribuicao([abortada], [], []);
		const linha = grupo.tarefas[0];

		expect(linha.exigePesoReal).toBe(true);
		expect(linha.avisoPeso).toMatch(/estimativa cheia/);
		expect(linha.gramasRateadas).toBeGreaterThan(0);
		expect(linha.gramasRateadas!).toBeLessThan(202.67);
	});

	it('a peça que terminou bem não pede peso nenhum', () => {
		const boa = normalizarTarefa(criarTarefaBruta({ id: 90_002 }))!;
		const [grupo] = agruparParaAtribuicao([boa], [], []);

		expect(grupo.tarefas[0].exigePesoReal).toBe(false);
		expect(grupo.tarefas[0].gramasRateadas).toBeNull();
	});
});

/**
 * O buraco que o encerramento de rolo abriu: encerrar o ÚNICO rolo de um
 * material deixa a importação sem sugestão para aquele grupo — e a tela dizia
 * "nenhum rolo cadastrado bate com este material", que passou a ser mentira.
 * Existe rolo, ele só saiu de circulação, e a saída (reabrir) é diferente da
 * saída de quando não há rolo nenhum (cadastrar).
 */
describe('encerradosQueCasam — por que não há sugestão', () => {
	const t = tarefaDe('PLA', '#000000');

	it('aponta o rolo encerrado que teria sido a sugestão', () => {
		const encerrado = rolo({ id: 5, status: 'vazio', apelido: 'PLA-BRANCO-01' });
		expect(encerradosQueCasam(t, [encerrado]).map((r) => r.id)).toEqual([5]);
	});

	it('vale para os dois status de encerramento', () => {
		const rolos = [rolo({ id: 1, status: 'vazio' }), rolo({ id: 2, status: 'descartado' })];
		expect(encerradosQueCasam(t, rolos).map((r) => r.id)).toEqual([1, 2]);
	});

	it('não conta rolo encerrado de OUTRO material — ele não seria sugestão nem aberto', () => {
		const outro = rolo({ id: 9, status: 'vazio', material: 'PETG', codigoBambu: 'GFG99' });
		expect(encerradosQueCasam(t, [outro])).toEqual([]);
	});

	it('não conta rolo em circulação, que é sugestão de verdade', () => {
		expect(encerradosQueCasam(t, [rolo({ id: 1, status: 'aberto' })])).toEqual([]);
		expect(encerradosQueCasam(t, [rolo({ id: 2, status: 'fechado' })])).toEqual([]);
	});

	it('sem detalhamento de filamento não há o que casar', () => {
		expect(encerradosQueCasam(normalizarTarefa(TAREFA_SEM_AMS)!, [rolo({ status: 'vazio' })])).toEqual(
			[]
		);
	});

	it('o grupo carrega a explicação junto da falta de sugestão', () => {
		const [g] = agruparParaAtribuicao(
			[t],
			[rolo({ id: 5, status: 'vazio', apelido: 'PLA-BRANCO-01' })],
			[{ id: 1, nome: 'A1', apelidoBambu: null }]
		);
		expect(g.roloSugeridoId).toBeNull();
		expect(g.encerradosCompativeis.map((r) => r.apelido)).toEqual(['PLA-BRANCO-01']);
	});

	/**
	 * O rolo encerrado do MESMO material vai junto de propósito: sem ele, a
	 * lista viria vazia por não haver o que listar, e o teste confirmaria a
	 * fixture em vez da regra. Com ele, só a porta (`roloSugeridoId === null`)
	 * segura a explicação.
	 */
	it('com sugestão de verdade, o grupo não carrega encerrado nenhum a explicar', () => {
		const [g] = agruparParaAtribuicao(
			[t],
			[rolo({ id: 3, status: 'aberto' }), rolo({ id: 5, status: 'vazio', apelido: 'PLA-BRANCO-01' })],
			[{ id: 1, nome: 'A1', apelidoBambu: null }]
		);
		expect(g.roloSugeridoId).toBe(3);
		expect(encerradosQueCasam(t, [rolo({ id: 5, status: 'vazio' })])).toHaveLength(1);
		expect(g.encerradosCompativeis).toEqual([]);
	});
});
