/**
 * Sugestão de rolo para uma tarefa da nuvem.
 *
 * **O problema de produto que este arquivo existe para resolver:** a nuvem sabe
 * material e cor, e não sabe qual rolo físico saiu da prateleira. Sem rolo não
 * há preço pago, e sem preço não há custo — a impressão importada seria uma
 * linha sem a informação que justifica o sistema inteiro.
 *
 * Como pedir a atribuição uma a uma não escala (a primeira importação traz o
 * histórico todo de uma vez), o desenho é: sugerir por material, agrupar as
 * tarefas que compartilham a mesma sugestão e deixar o usuário corrigir só as
 * exceções. Módulo puro, sem banco — é a regra que decide, e ela é testável
 * sozinha.
 */

import { sugerirFinalidade, type Finalidade } from '$lib/finalidade';
import { filamentoPrincipal, type TarefaNuvem } from './parse';

export interface RoloCandidato {
	id: number;
	apelido: string | null;
	status: 'fechado' | 'aberto' | 'vazio' | 'descartado';
	/** `rolo.material`, que é `NOT NULL` desde a fusão — antes vinha da junção. */
	material: string;
	corHex: string | null;
	/** `rolo.codigoBambu`, ex.: `GFA18`. Casa com `filamentId` da tarefa. */
	codigoBambu: string | null;
	dataAbertura: number | null;
}

function norm(v: string | null): string | null {
	if (!v) return null;
	return v.trim().toUpperCase();
}

const encerrado = (rolo: RoloCandidato) => rolo.status === 'vazio' || rolo.status === 'descartado';

/**
 * O rolo bate com o filamento da tarefa? Mesma pergunta que `sugerirRolo` faz
 * antes de pontuar, extraída porque `encerradosQueCasam` precisa dela idêntica:
 * duas cópias divergindo fariam a tela explicar a ausência de sugestão com um
 * rolo que nunca teria sido sugerido.
 */
function casaComATarefa(tarefa: TarefaNuvem, rolo: RoloCandidato): boolean {
	const principal = filamentoPrincipal(tarefa);
	if (!principal) return false;

	const codigo = norm(principal.filamentId);
	const material = norm(principal.material);
	return (
		(codigo !== null && norm(rolo.codigoBambu) === codigo) ||
		(material !== null && norm(rolo.material) === material)
	);
}

/**
 * Os rolos ENCERRADOS que teriam sido candidatos se ainda estivessem em
 * circulação.
 *
 * Existe por causa de um buraco que o encerramento abriu: encerrar o único rolo
 * de um material deixa a importação sem sugestão para aquele grupo, e a tela
 * dizia "nenhum rolo cadastrado bate com este material" — que passou a ser
 * mentira. Existe rolo; ele só saiu de circulação. E as duas situações pedem
 * saídas diferentes: cadastrar um rolo novo, ou reabrir o que foi encerrado
 * cedo demais.
 */
export function encerradosQueCasam(tarefa: TarefaNuvem, rolos: RoloCandidato[]): RoloCandidato[] {
	return rolos.filter((rolo) => encerrado(rolo) && casaComATarefa(tarefa, rolo));
}

/**
 * Chave de agrupamento: tarefas com a mesma chave receberam o mesmo material e
 * a mesma cor, então quase sempre saíram do mesmo rolo. É por ela que a tela
 * oferece "aplicar este rolo a todas as N tarefas deste material".
 */
export function chaveDeMaterial(tarefa: TarefaNuvem): string {
	const principal = filamentoPrincipal(tarefa);
	if (!principal) return 'sem-detalhamento';
	const partes = [
		norm(principal.filamentId) ?? '?',
		norm(principal.material) ?? '?',
		norm(principal.corHex) ?? '?'
	];
	return partes.join('|');
}

/** Rótulo humano do grupo, para o cabeçalho do lote na tela. */
export function rotuloDeMaterial(tarefa: TarefaNuvem): string {
	const principal = filamentoPrincipal(tarefa);
	if (!principal) return 'sem detalhamento de filamento';
	const pedacos = [principal.material ?? 'material desconhecido'];
	if (principal.corHex) pedacos.push(principal.corHex);
	if (principal.filamentId) pedacos.push(principal.filamentId);
	return pedacos.join(' · ');
}

/**
 * O rolo mais provável, ou `null` quando não dá para arriscar.
 *
 * Ordem de preferência, do mais forte ao mais fraco: código do catálogo da
 * Bambu batendo (`GFA18` ⇄ `filamento.codigoBambu`), cor igual, rolo aberto,
 * rolo aberto mais recentemente.
 *
 * Rolo `vazio` ou `descartado` nunca é sugerido, e **nada é sugerido sem que
 * material ou código batam** — sugerir PETG para uma peça de PLA seria pior
 * que não sugerir: o usuário confirmaria em lote e o custo sairia do rolo
 * errado, congelado, sem nenhum sinal de que houve erro.
 *
 * Depois da fusão, dois rolos com material, cor e código idênticos deixaram de
 * ser exceção e viraram o caso normal (comprar de novo = registro novo). O
 * desempate que já existia é justamente o que resolve isso, e na ordem certa:
 * `aberto` na frente de `fechado`, e entre dois abertos o aberto mais
 * recentemente — que é o que está na máquina. O rolo lacrado na gaveta nunca
 * ganha do que está em uso.
 */
export function sugerirRolo(tarefa: TarefaNuvem, rolos: RoloCandidato[]): number | null {
	const principal = filamentoPrincipal(tarefa);
	if (!principal) return null;

	const codigo = norm(principal.filamentId);
	const material = norm(principal.material);
	const cor = norm(principal.corHex);

	let melhor: { id: number; pontos: number; abertura: number } | null = null;

	for (const rolo of rolos) {
		if (encerrado(rolo)) continue;

		const casaCodigo = codigo !== null && norm(rolo.codigoBambu) === codigo;
		const casaMaterial = material !== null && norm(rolo.material) === material;
		if (!casaCodigo && !casaMaterial) continue;

		let pontos = 0;
		if (casaCodigo) pontos += 4;
		if (casaMaterial) pontos += 3;
		if (cor !== null && norm(rolo.corHex) === cor) pontos += 3;
		if (rolo.status === 'aberto') pontos += 2;

		const abertura = rolo.dataAbertura ?? 0;
		const ganha =
			melhor === null ||
			pontos > melhor.pontos ||
			(pontos === melhor.pontos && abertura > melhor.abertura) ||
			(pontos === melhor.pontos && abertura === melhor.abertura && rolo.id > melhor.id);

		if (ganha) melhor = { id: rolo.id, pontos, abertura };
	}

	return melhor?.id ?? null;
}

export interface ImpressoraCandidata {
	id: number;
	apelidoBambu: string | null;
	nome: string;
}

/**
 * Amarração automática da impressora pelo apelido que a máquina usa na nuvem
 * (`deviceName`, ex.: `Unit-01(A1)`). Sem apelido cadastrado e com uma única
 * impressora ativa, é ela — não faz sentido pedir escolha entre uma opção só.
 */
export function sugerirImpressora(
	tarefa: TarefaNuvem,
	impressoras: ImpressoraCandidata[]
): number | null {
	const nome = norm(tarefa.dispositivoNome);
	if (nome) {
		const casada = impressoras.find((i) => norm(i.apelidoBambu) === nome);
		if (casada) return casada.id;
	}
	if (impressoras.length === 1) return impressoras[0].id;
	return null;
}

export interface LinhaAtribuicao {
	taskId: string;
	nome: string;
	inicioEm: number | null;
	duracaoS: number | null;
	gramas: number;
	status: 'sucesso' | 'falha' | null;
	importavel: boolean;
	problema: string | null;
	exigeConfirmacao: boolean;
	avisoConfirmacao: string | null;
	/** Peça abortada: o peso da nuvem é estimativa cheia e a tela pede o real. */
	exigePesoReal: boolean;
	avisoPeso: string | null;
	/** Sugestão rateada pelo tempo decorrido — aproximação grosseira, ver `parse.ts`. */
	gramasRateadas: number | null;
	dispositivoNome: string | null;
	perfilBruto: string | null;
	multifilamento: boolean;
	temCapa: boolean;
	impressoraSugeridaId: number | null;
	/**
	 * Primeira das três camadas de finalidade, espelhando o que o rolo já fazia.
	 * `null` = peça inédita, e aí quem decide é o grupo ou o lote — nunca um
	 * chute, pelo mesmo motivo que não se sugere rolo de outro material.
	 */
	finalidadeSugerida: Finalidade | null;
}

export interface GrupoAtribuicao {
	chave: string;
	rotulo: string;
	roloSugeridoId: number | null;
	/**
	 * Rolos deste material que estão encerrados. Só interessa quando
	 * `roloSugeridoId` é `null`: é a diferença entre "não há rolo deste material"
	 * e "o rolo deste material foi encerrado", que pedem saídas diferentes.
	 */
	encerradosCompativeis: RoloCandidato[];
	tarefas: LinhaAtribuicao[];
}

/**
 * Monta a tela de atribuição: as tarefas novas agrupadas por material+cor, cada
 * grupo com uma sugestão de rolo.
 *
 * É isto que impede que importar cinquenta tarefas vire cinquenta decisões:
 * cinquenta tarefas viram tipicamente dois ou três grupos (imprime-se em poucos
 * rolos por vez), e cada grupo se resolve num `select` só. A escolha tarefa a
 * tarefa continua existindo, para as exceções.
 *
 * Ordena grupo maior primeiro — o lote que economiza mais cliques fica no topo —
 * e, dentro dele, tarefa mais recente primeiro.
 */
export function agruparParaAtribuicao(
	tarefas: TarefaNuvem[],
	rolos: RoloCandidato[],
	impressoras: ImpressoraCandidata[],
	/**
	 * Histórico de finalidade por peça, vindo de `resumirFinalidades`. Vazio por
	 * padrão: a primeira importação de uma base nova não tem o que sugerir, e
	 * isso não é um caso especial — é o mapa vazio funcionando.
	 */
	finalidades: Map<string, Finalidade> = new Map()
): GrupoAtribuicao[] {
	const mapa = new Map<string, GrupoAtribuicao>();

	for (const t of tarefas) {
		const chave = chaveDeMaterial(t);
		let grupo = mapa.get(chave);
		if (!grupo) {
			const roloSugeridoId = sugerirRolo(t, rolos);
			grupo = {
				chave,
				rotulo: rotuloDeMaterial(t),
				roloSugeridoId,
				// Só quando não há sugestão: com uma sugestão de verdade na mão, a
				// tela não tem nada a explicar, e a lista seria ruído.
				encerradosCompativeis: roloSugeridoId === null ? encerradosQueCasam(t, rolos) : [],
				tarefas: []
			};
			mapa.set(chave, grupo);
		}
		grupo.tarefas.push({
			taskId: t.taskId,
			nome: t.nome,
			inicioEm: t.inicioEm,
			duracaoS: t.duracaoS,
			gramas: t.gramas,
			status: t.status,
			importavel: t.importavel,
			problema: t.problema,
			exigeConfirmacao: t.exigeConfirmacao,
			avisoConfirmacao: t.avisoConfirmacao,
			exigePesoReal: t.exigePesoReal,
			avisoPeso: t.avisoPeso,
			gramasRateadas: t.gramasRateadas,
			dispositivoNome: t.dispositivoNome,
			perfilBruto: t.perfilBruto,
			multifilamento: t.multifilamento,
			temCapa: t.capaUrl !== null,
			impressoraSugeridaId: sugerirImpressora(t, impressoras),
			finalidadeSugerida: sugerirFinalidade(t.nome, finalidades)
		});
	}

	const grupos = [...mapa.values()];
	for (const g of grupos) g.tarefas.sort((a, b) => (b.inicioEm ?? 0) - (a.inicioEm ?? 0));
	grupos.sort((a, b) => b.tarefas.length - a.tarefas.length);
	return grupos;
}
