/**
 * Tradução do JSON da nuvem da Bambu para o vocabulário do Carretel.
 *
 * Módulo puro: entra `unknown` vindo da rede, sai objeto do domínio. Nenhum
 * acesso a banco, nenhuma chamada HTTP — é o que permite testar todo o
 * comportamento delicado (duração, status, multimaterial, formato estranho)
 * sem tocar na conta de ninguém.
 *
 * Regra que atravessa o arquivo inteiro: **a API é engenharia reversa**. Todo
 * campo pode vir com outro tipo, faltando ou nulo, e nada disso pode derrubar
 * a importação inteira — no máximo marca UMA tarefa como não importável.
 */

export interface FilamentoDaTarefa {
	/** Código do catálogo da Bambu, ex.: `GFA18`. Amarra com `filamento.codigoBambu`. */
	filamentId: string | null;
	/** `PLA`, `PETG`, `ABS`… */
	material: string | null;
	/** Cor em `#RRGGBB`. A API manda `RRGGBBAA`; o alfa é descartado. */
	corHex: string | null;
	gramas: number;
}

export interface TarefaNuvem {
	taskId: string;
	nome: string;
	perfilBruto: string | null;
	perfil: { camadaMm: number | null; paredes: number | null; infillPct: number | null };
	inicioEm: number | null;
	fimEm: number | null;
	/** Sempre `fimEm - inicioEm`. Nunca `costTime` — ver comentário em `duracaoDaTarefa`. */
	duracaoS: number | null;
	/**
	 * A estimativa de tempo do fatiamento (`costTime`), em segundos.
	 *
	 * ⛔ **Isto não é duração e não pode virar duração em lugar nenhum.** Está
	 * aqui por um motivo só: é o denominador da fração de tempo decorrido, que
	 * é o que permite SUGERIR quanto de material saiu numa peça abortada. Vale
	 * como escala de uma estimativa contra outra, nunca como medida.
	 */
	tempoEstimadoS: number | null;
	/** `duracaoS / tempoEstimadoS`, saturado em 1. `null` quando não dá para calcular. */
	fracaoDecorrida: number | null;
	/**
	 * Peso da nuvem multiplicado pela fração de tempo decorrido — **sugestão
	 * grosseira**, porque o consumo de filamento não é linear no tempo (parede
	 * externa, brim e primeiras camadas gastam mais por minuto que o corpo da
	 * peça). Existe para o formulário não vir vazio, e nunca é gravada sozinha.
	 */
	gramasRateadas: number | null;
	gramas: number;
	/** Comprimento de filamento em centímetros (`length`). Ver `massa.ts`. */
	comprimentoCm: number | null;
	status: 'sucesso' | 'falha' | null;
	dispositivoNome: string | null;
	dispositivoModelo: string | null;
	placaBuild: string | null;
	filamentos: FilamentoDaTarefa[];
	multifilamento: boolean;
	/** URL S3 pré-assinada, validade de 1 h. Só serve se for baixada na hora. */
	capaUrl: string | null;
	/**
	 * Qual plate do projeto rodou (`plateIndex`). É o campo que separa "a base"
	 * de "a tampa" dentro do MESMO arquivo — sem ele, nome repetido é tudo o que
	 * há, e nome repetido não prova conteúdo igual.
	 *
	 * `null` quando a nuvem não disse, ou disse algo que não é número de plate.
	 * Ver `lerIndicePlate` para por que zero não conta.
	 */
	indicePlate: number | null;
	/**
	 * O identificador do projeto na nuvem (`designId`), como texto.
	 *
	 * É a chave real: sobrevive a renomear o modelo e não confunde dois projetos
	 * de nome parecido. `null` quando o arquivo é do próprio usuário — ver
	 * `lerProjetoId`.
	 */
	projetoId: string | null;
	/** `true` quando dá para virar uma linha de `impressao` com custo confiável. */
	importavel: boolean;
	/** Por que não é importável. `null` quando é. */
	problema: string | null;
	/**
	 * `true` quando a tarefa só entra com aceite explícito do usuário, linha a
	 * linha, porque o dado gravado será **sabidamente aproximado**.
	 */
	exigeConfirmacao: boolean;
	/** O que exatamente ficará errado se o usuário aceitar. `null` quando nada. */
	avisoConfirmacao: string | null;
	/**
	 * `true` quando o peso que a nuvem manda é a estimativa CHEIA de uma peça
	 * que não terminou — hoje, toda tarefa abortada.
	 *
	 * `weight` é escrito no fatiamento, não medido na máquina: uma tarefa
	 * rodando havia 17 segundos já reportava 202,67 g. Numa peça concluída isso
	 * não incomoda, porque a estimativa cheia é o que de fato saiu; numa que
	 * caiu aos 3 minutos de 5 horas, debitar os 202 g tira do rolo material que
	 * ainda está no rolo (crítica de 10/08/2026, item 2).
	 */
	exigePesoReal: boolean;
	/** O que está errado no peso desta tarefa. `null` quando nada. */
	avisoPeso: string | null;
}

function texto(bruto: unknown): string | null {
	if (typeof bruto === 'string') {
		const t = bruto.trim();
		return t === '' ? null : t;
	}
	if (typeof bruto === 'number' && Number.isFinite(bruto)) return String(bruto);
	return null;
}

function numero(bruto: unknown): number | null {
	if (typeof bruto === 'number') return Number.isFinite(bruto) ? bruto : null;
	if (typeof bruto === 'string' && bruto.trim() !== '') {
		// `"82,5"` já apareceu em campo numérico de API que serializa no locale
		// do servidor. `Number('82,5')` é NaN, e NaN aqui caía no somatório do
		// AMS — na prática, 82,5 g viravam 0 g e a impressão saía de graça.
		// A troca só vale para a vírgula decimal isolada; com ponto no meio
		// ("1,234.5") a vírgula é separador de milhar e some.
		const texto = bruto.trim();
		const normalizado = texto.includes('.') ? texto.replace(/,/g, '') : texto.replace(',', '.');
		const n = Number(normalizado);
		return Number.isFinite(n) ? n : null;
	}
	return null;
}

function instante(bruto: unknown): number | null {
	const t = texto(bruto);
	if (!t) return null;
	const ms = new Date(t).getTime();
	return Number.isFinite(ms) ? ms : null;
}

/**
 * `"0.2mm layer, 2 walls, 15% infill"` → camada, paredes e infill.
 *
 * Cada pedaço tem regex própria e independente: um perfil personalizado que só
 * traz camada e paredes devolve as duas e `null` no infill, em vez de descartar
 * tudo. O campo é livre no Bambu Studio — dá para renomear o perfil e mandar
 * qualquer coisa —, então formato desconhecido é caso normal, não erro.
 */
export function lerPerfilFatiamento(bruto: unknown): {
	camadaMm: number | null;
	paredes: number | null;
	infillPct: number | null;
} {
	const t = typeof bruto === 'string' ? bruto : '';

	const camada = t.match(/([\d]+(?:[.,][\d]+)?)\s*mm\s*layer/i);
	const paredes = t.match(/([\d]+)\s*walls?/i);
	const infill = t.match(/([\d]+(?:[.,][\d]+)?)\s*%\s*infill/i);

	const paraNumero = (m: RegExpMatchArray | null) => {
		if (!m) return null;
		const n = Number(m[1].replace(',', '.'));
		return Number.isFinite(n) ? n : null;
	};

	const paredesNum = paraNumero(paredes);

	return {
		camadaMm: paraNumero(camada),
		paredes: paredesNum === null ? null : Math.round(paredesNum),
		infillPct: (() => {
			const n = paraNumero(infill);
			return n === null ? null : Math.round(n);
		})()
	};
}

/**
 * Duração real, em segundos, **sempre** por subtração.
 *
 * `costTime` existe no payload e é a estimativa do fatiamento, não o tempo de
 * máquina. Diverge nas duas direções, e num job abortado carrega a estimativa
 * cheia enquanto o intervalo real é de minutos. Como a duração alimenta
 * energia, depreciação e horímetro de uma vez, usar `costTime` erraria três
 * números ao mesmo tempo e de forma silenciosa. Por isso este arquivo nem lê
 * o campo.
 */
export function duracaoDaTarefa(inicioEm: number | null, fimEm: number | null): number | null {
	if (inicioEm === null || fimEm === null) return null;
	const s = Math.round((fimEm - inicioEm) / 1000);
	return s < 0 ? null : s;
}

/**
 * Que fatia do trabalho previsto a máquina chegou a rodar.
 *
 * Satura em 1: passar do tempo estimado é normal (a estimativa erra para os
 * dois lados) e não significa que saiu mais material do que a peça inteira.
 * Devolve `null` quando falta qualquer um dos dois números — e `null` aqui
 * significa "não há sugestão a oferecer", nunca "rodou tudo".
 */
export function fracaoDecorridaDaTarefa(
	duracaoS: number | null,
	tempoEstimadoS: number | null
): number | null {
	if (duracaoS === null || tempoEstimadoS === null) return null;
	if (!Number.isFinite(duracaoS) || duracaoS < 0) return null;
	if (!Number.isFinite(tempoEstimadoS) || tempoEstimadoS <= 0) return null;
	return Math.min(1, duracaoS / tempoEstimadoS);
}

/**
 * `plateIndex` → qual plate do projeto rodou.
 *
 * **Zero não é plate, e a recusa é deliberada.** O fatiador numera a partir de
 * 1 ("Plate 1"), e zero é justamente o valor que esta API usa para "não se
 * aplica" — `designId: 0` no arquivo do próprio usuário, `instanceId: 0` em
 * toda tarefa. O custo dos dois erros é assimétrico:
 *
 * - aceitar um zero que significa "nenhuma" faz TODAS as plates de um projeto
 *   virarem a mesma plate, que é exatamente a leitura que este sistema proíbe;
 * - recusar um zero que significasse "a primeira" só produz "plate não
 *   identificada" — degrada a leitura, nunca inventa uma.
 *
 * Como a API é engenharia reversa e o levantamento no repositório não fixa a
 * base da numeração, fica-se com o erro que não mente. Se a primeira
 * importação real mostrar zero em massa (e a ação de completar mostra isso na
 * tela, como "sem índice de plate na nuvem"), a base é 0 e a regra é uma linha.
 */
export function lerIndicePlate(bruto: unknown): number | null {
	const n = numero(bruto);
	if (n === null || !Number.isInteger(n) || n < 1) return null;
	return n;
}

/**
 * `designId` → o identificador do projeto, como TEXTO.
 *
 * Texto pelo mesmo motivo de `taskId`: id de API não entra em aritmética, e um
 * campo que hoje é inteiro pode vir string amanhã sem quebrar a leitura.
 *
 * **Zero e negativo viram `null`**, porque `designId: 0` é o que a nuvem manda
 * quando o arquivo é do próprio usuário — a AUSÊNCIA de projeto, não um projeto
 * chamado zero. Guardar `"0"` faria todo arquivo local do dono cair na mesma
 * chave, e o agrupamento juntaria a caixa do Rode com o Gridfinity: um erro
 * pior que não agrupar.
 */
export function lerProjetoId(bruto: unknown): string | null {
	const t = texto(bruto);
	if (t === null) return null;
	const n = Number(t);
	if (Number.isFinite(n) && n <= 0) return null;
	return t;
}

function lerFilamentos(bruto: unknown): FilamentoDaTarefa[] {
	if (!Array.isArray(bruto)) return [];
	return bruto.flatMap((linha): FilamentoDaTarefa[] => {
		if (typeof linha !== 'object' || linha === null) return [];
		const l = linha as Record<string, unknown>;
		const corBruta = texto(l.targetColor) ?? texto(l.sourceColor);
		// A API manda RRGGBBAA; o alfa não interessa e o `#` não vem.
		const corHex = corBruta ? `#${corBruta.replace(/^#/, '').slice(0, 6).toUpperCase()}` : null;
		return [
			{
				filamentId: texto(l.filamentId),
				material: texto(l.filamentType) ?? texto(l.targetFilamentType),
				corHex,
				gramas: numero(l.weight) ?? 0
			}
		];
	});
}

/** O filamento que mais pesou na peça — é dele que sai a sugestão de rolo. */
export function filamentoPrincipal(tarefa: TarefaNuvem): FilamentoDaTarefa | null {
	if (tarefa.filamentos.length === 0) return null;
	return tarefa.filamentos.reduce((a, b) => (b.gramas > a.gramas ? b : a));
}

/**
 * Uma tarefa da nuvem no vocabulário do Carretel.
 *
 * Devolve `null` só quando não há `id`: sem ele não existe chave de
 * deduplicação, e importar seria criar duplicata a cada rodada. Qualquer outro
 * defeito vira `importavel: false` com o motivo escrito, para que a tarefa
 * continue VISÍVEL na tela em vez de sumir em silêncio.
 */
export function normalizarTarefa(bruto: unknown): TarefaNuvem | null {
	if (typeof bruto !== 'object' || bruto === null || Array.isArray(bruto)) return null;
	const t = bruto as Record<string, unknown>;

	const taskId = texto(t.id);
	if (!taskId) return null;

	const inicioEm = instante(t.startTime);
	const fimEm = instante(t.endTime);
	const duracaoS = duracaoDaTarefa(inicioEm, fimEm);

	const statusBruto = numero(t.status);
	const status = statusBruto === 2 ? 'sucesso' : statusBruto === 3 ? 'falha' : null;

	const filamentos = lerFilamentos(t.amsDetailMapping);
	const gramasAms = filamentos.reduce((soma, f) => soma + f.gramas, 0);
	// `weight` é o total da tarefa. Só cai no somatório do AMS quando o total
	// não veio — os dois devem bater, e quando não batem o total manda.
	const gramas = numero(t.weight) ?? gramasAms;

	const comprimentoBruto = numero(t.length);
	const comprimentoCm =
		comprimentoBruto !== null && comprimentoBruto > 0 ? comprimentoBruto : null;

	// `costTime` é lido AQUI e em nenhum outro lugar do arquivo. Ver o campo
	// `tempoEstimadoS`: ele é denominador de proporção, não duração.
	const tempoBruto = numero(t.costTime);
	const tempoEstimadoS = tempoBruto !== null && tempoBruto > 0 ? Math.round(tempoBruto) : null;
	const fracaoDecorrida = fracaoDecorridaDaTarefa(duracaoS, tempoEstimadoS);

	let problema: string | null = null;
	// A nuvem usa 2 para concluída e 3 para abortada. O 4 é "imprimindo agora", e
	// aparece toda vez que se importa com a máquina ligada — chamá-lo de
	// "desconhecido" faz o usuário procurar defeito onde só há uma peça na mesa.
	// Recusar continua certo: enquanto não termina, o peso é estimativa pura e a
	// duração ainda não existe.
	if (statusBruto === 4) {
		problema = 'ainda está imprimindo; importe quando terminar';
	} else if (status === null) {
		problema = `status ${statusBruto ?? '?'} desconhecido (nem concluída nem abortada)`;
	}
	else if (inicioEm === null) problema = 'sem início registrado';
	else if (fimEm === null) problema = 'sem término registrado; provavelmente ainda rodando';
	else if (duracaoS === null) problema = 'intervalo inválido: o término vem antes do início';
	// Peso negativo é veneno silencioso: o motor de CUSTO satura em zero, mas o
	// de ESTOQUE soma, então um consumo negativo DEVOLVE filamento ao rolo e a
	// barra de restante passa a mentir para cima. Peso zero é o outro lado da
	// mesma moeda: uma impressão que não custa nada e não consome nada, que só
	// serve para poluir a taxa de sucesso e o horímetro.
	else if (gramas < 0) problema = `peso negativo (${gramas} g); a nuvem devolveu um número impossível`;
	else if (gramas === 0) problema = 'peso zero; não dá para calcular custo nem debitar estoque';

	// Multimaterial não é defeito da nuvem, é limite do nosso modelo: `impressao`
	// amarra UM rolo, então o peso inteiro seria debitado de um filamento só.
	// Numa peça de 90 g de PLA + 30 g de PETG com preços diferentes, o custo sai
	// errado e o segundo rolo nunca é debitado. Por isso ela não entra sozinha.
	const exigeConfirmacao = problema === null && filamentos.length > 1;
	const avisoConfirmacao = exigeConfirmacao
		? `${filamentos.length} filamentos na mesma peça: o peso inteiro (${gramas} g) será debitado de um rolo só, ` +
			'e o custo do outro material não entra na conta'
		: null;

	// Peça abortada: `weight` continua sendo a estimativa do fatiamento da peça
	// INTEIRA, e é isso que faz uma falha aos 3 minutos debitar o rolo como se
	// a peça tivesse saído. O peso passa a ser pedido à mão na importação.
	const exigePesoReal = problema === null && status === 'falha';
	const gramasRateadas =
		exigePesoReal && fracaoDecorrida !== null
			? Math.round(gramas * fracaoDecorrida * 100) / 100
			: null;
	const avisoPeso = exigePesoReal
		? `a peça abortou e a nuvem só sabe a estimativa cheia do fatiamento (${gramas} g)` +
			(fracaoDecorrida !== null
				? `; ela rodou ${Math.round(fracaoDecorrida * 1000) / 10}% do tempo previsto`
				: '')
		: null;

	return {
		taskId,
		// Sem `designTitle` o nome cai no id, e NÃO em `title`: `title` é o perfil
		// de fatiamento, e "0.2mm layer, 2 walls, 15% infill" não nomeia peça
		// nenhuma — viraria uma lista de impressões todas com o mesmo nome.
		nome: texto(t.designTitle) ?? `tarefa ${taskId}`,
		perfilBruto: texto(t.title),
		perfil: lerPerfilFatiamento(t.title),
		inicioEm,
		fimEm,
		duracaoS,
		tempoEstimadoS,
		fracaoDecorrida,
		gramasRateadas,
		gramas,
		comprimentoCm,
		status,
		dispositivoNome: texto(t.deviceName),
		dispositivoModelo: texto(t.deviceModel),
		placaBuild: texto(t.bedType),
		filamentos,
		multifilamento: filamentos.length > 1,
		capaUrl: texto(t.cover),
		// Os dois campos da plate NÃO entram na conta de `importavel`: eles
		// servem à leitura depois da importação, e uma nuvem que pare de
		// mandá-los não pode fechar a porta de entrada do histórico.
		indicePlate: lerIndicePlate(t.plateIndex),
		projetoId: lerProjetoId(t.designId),
		importavel: problema === null,
		problema,
		exigeConfirmacao,
		avisoConfirmacao,
		exigePesoReal,
		avisoPeso
	};
}
