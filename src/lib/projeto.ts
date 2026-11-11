/**
 * As outras impressões do MESMO ARQUIVO DE PROJETO — e, dentro delas, quais
 * rodaram A MESMA PLATE.
 *
 * ## A regra que não mudou: plate diferente não soma
 *
 * A crítica pedia "custo total por peça": o MagicTray saiu quatro vezes
 * (R$ 6,05, 6,89, 7,52 e 6,60) e somar daria R$ 27,06. **Continuamos não
 * somando**, e a razão é do domínio:
 *
 * > Quando o nome do modelo é repetido, significa que o arquivo original da
 * > impressão veio do mesmo projeto, mas o conteúdo da plate pode ser
 * > diferente. Pode ser peças complementares, pode ter uma plate mais cheia do
 * > que outra.
 *
 * As quatro tarefas chamadas "MagicTray" podem ser a base, depois a tampa,
 * depois uma plate com três suportes, depois a peça refeita. R$ 27,06 é um
 * número preciso que não responde pergunta nenhuma — falsa precisão é
 * exatamente o que o resto deste sistema evita (é a mesma lei do "sem aferição,
 * o restante é estimativa").
 *
 * ## O que mudou: `indicePlate` e `projetoIdNuvem` existem
 *
 * Os dois campos chegavam no payload da nuvem e o parser os descartava. Agora
 * são coluna em `impressao`, e é isso que torna possível a única distinção que
 * o dono aceita:
 *
 * - **a mesma plate rodada de novo é comparável** — mesmo conteúdo, mesma
 *   massa esperada, mesmo custo esperado. A distância entre duas rodadas dessas
 *   é retrabalho ou variação de máquina, e ela pode ser lida;
 * - **plates diferentes do mesmo projeto são complementares** — lado a lado,
 *   sem soma, exatamente como antes.
 *
 * ## Por que a leitura da mesma plate é VARIAÇÃO e não SOMA
 *
 * Somar duas rodadas da mesma plate responderia "quanto gastei nesta plate ao
 * todo", e essa pergunta parece legítima — mas o dado não distingue **três
 * tentativas até acertar** de **três cópias entregues**. `status` separa
 * sucesso de falha, e não separa reimpressão de segunda unidade: uma plate que
 * saiu bem três vezes são três peças na mesa, e chamar isso de "o que a peça me
 * custou" seria multiplicar o custo por três num rótulo que diz o contrário.
 *
 * A variação não tem essa ambiguidade: "a mesma plate custou entre R$ 6,05 e
 * R$ 7,52" é verdade nos dois cenários, e é justamente a leitura de retrabalho
 * que a crítica queria. Por isso o módulo mede a distância e não o acumulado.
 *
 * A conta ainda exclui as rodadas que falharam: uma peça que abortou aos três
 * minutos custa quase nada, e comparar R$ 0,13 com R$ 7,52 produziria um
 * percentual gigante que não é sobre consistência nenhuma. Elas continuam
 * visíveis na lista — só não entram na medida.
 *
 * ## A capa continua sendo o sinal do olho
 *
 * `imagemPath` mostra a plate montada, e é o que confirma para o humano o que o
 * índice afirma. Ela não sai de cena: o índice organiza, a capa comprova.
 */

export interface ImpressaoDoProjeto {
	corHex?: string | null;
	id: number;
	nomeLivre: string;
	inicioEm: number;
	gramas: number;
	custoTotalCents: number;
	status: 'sucesso' | 'falha' | 'cancelada';
	temImagem: boolean;
	/** Qual plate do arquivo rodou. `null` no histórico anterior a esta rodada. */
	indicePlate: number | null;
	/** O projeto na nuvem. `null` em arquivo do próprio dono e no histórico antigo. */
	projetoIdNuvem: string | null;
}

/**
 * Nome livre → chave do arquivo de projeto.
 *
 * Dobra o que é sujeira de digitação e transporte (espaço nas pontas, espaço
 * dobrado no meio, caixa) e **não** dobra acento: "peça" e "peca" são nomes
 * diferentes, e juntar por semelhança começaria a inventar parentesco que
 * ninguém declarou — que é o erro que este módulo inteiro existe para não
 * cometer em escala maior.
 */
export function chaveDoProjeto(nome: string): string {
	return nome.trim().replace(/\s+/g, ' ').toLowerCase();
}

/**
 * Duas impressões vieram do mesmo arquivo de projeto?
 *
 * A ordem de autoridade é: **o identificador do projeto quando os DOIS lados o
 * têm, e o nome como último recurso.**
 *
 * O identificador só pode SEPARAR quando existe dos dois lados. Se ele bastasse
 * de um lado só, a entrega de hoje faria o card perder irmãs que ele já mostra:
 * as 11 linhas em produção não têm identificador nenhum, e a primeira
 * importação nova traria linhas que têm — duas metades do mesmo projeto
 * deixariam de se reconhecer justamente por causa de um campo novo. Quando
 * falta em qualquer um dos lados, o nome volta a ser tudo o que há, que é
 * exatamente onde o sistema estava antes.
 *
 * Com o id nos dois lados, ele ganha do nome nas duas direções: renomear o
 * modelo não separa, e dois projetos de nome parecido não se juntam.
 */
export function mesmoProjeto(a: ImpressaoDoProjeto, b: ImpressaoDoProjeto): boolean {
	if (a.projetoIdNuvem !== null && b.projetoIdNuvem !== null) {
		return a.projetoIdNuvem === b.projetoIdNuvem;
	}
	const chave = chaveDoProjeto(a.nomeLivre);
	// Sem nome não há projeto: duas linhas em branco não são parentes.
	if (chave === '') return false;
	return chave === chaveDoProjeto(b.nomeLivre);
}

/**
 * As OUTRAS impressões que vieram do mesmo arquivo, da mais recente para a
 * mais antiga.
 *
 * Devolve as linhas como elas são. Não soma, não tira média, não elege a mais
 * barata: nome igual continua não provando conteúdo igual.
 */
export function irmasDoProjeto<T extends ImpressaoDoProjeto>(id: number, todas: T[]): T[] {
	const atual = todas.find((i) => i.id === id);
	if (!atual) return [];

	return todas
		.filter((i) => i.id !== id && mesmoProjeto(atual, i))
		.sort((a, b) => b.inicioEm - a.inicioEm);
}

/**
 * A distância entre a rodada mais barata e a mais cara da MESMA plate.
 *
 * `pct` é `null` quando a mais barata custou zero — impressão registrada sem
 * preço de rolo, que existe no banco e daria `Infinity` na tela.
 */
export interface VariacaoDaPlate {
	/** Quantas rodadas bem-sucedidas entraram na conta. Sempre ≥ 2. */
	comparaveis: number;
	menorCents: number;
	maiorCents: number;
	pct: number | null;
}

export interface LeituraDoProjeto<T extends ImpressaoDoProjeto> {
	/** O índice da plate da impressão aberta. `null` = não identificada. */
	plateAtual: number | null;
	/** Outras rodadas da MESMA plate — comparáveis. */
	mesmaPlate: T[];
	/** Outras plates conhecidas do mesmo projeto — complementares, sem soma. */
	outrasPlates: T[];
	/**
	 * Irmãs que não dá para situar: ou elas não têm índice, ou a impressão
	 * aberta não tem. **Não são chutadas para nenhum dos dois lados.**
	 */
	semIndice: T[];
	/** `null` quando não há duas rodadas bem-sucedidas da mesma plate. */
	variacao: VariacaoDaPlate | null;
}

/**
 * Divide as irmãs em três leituras, sem inventar nenhuma delas.
 *
 * A terceira lista é a parte importante: para a tarefa antiga, que entrou antes
 * de existir coluna de plate, a resposta honesta é "plate não identificada" —
 * nem "a mesma" (não há prova) nem "outra" (também não há). O mesmo vale ao
 * contrário: se a impressão ABERTA não tem índice, nenhuma irmã pode ser
 * declarada a mesma plate, por mais que ela própria tenha índice.
 */
export function lerDoProjeto<T extends ImpressaoDoProjeto>(
	id: number,
	todas: T[]
): LeituraDoProjeto<T> {
	const atual = todas.find((i) => i.id === id);
	const vazia: LeituraDoProjeto<T> = {
		plateAtual: null,
		mesmaPlate: [],
		outrasPlates: [],
		semIndice: [],
		variacao: null
	};
	if (!atual) return vazia;

	const irmas = irmasDoProjeto(id, todas);
	const plateAtual = atual.indicePlate;

	const mesmaPlate: T[] = [];
	const outrasPlates: T[] = [];
	const semIndice: T[] = [];

	for (const irma of irmas) {
		if (plateAtual === null || irma.indicePlate === null) semIndice.push(irma);
		else if (irma.indicePlate === plateAtual) mesmaPlate.push(irma);
		else outrasPlates.push(irma);
	}

	return { plateAtual, mesmaPlate, outrasPlates, semIndice, variacao: variar(atual, mesmaPlate) };
}

/**
 * A variação entre as rodadas BEM-SUCEDIDAS da mesma plate, a aberta inclusive.
 *
 * Falha e cancelamento ficam de fora: elas param no meio, custam a fração que
 * rodou, e comparar uma peça que abortou aos 3 minutos com uma que terminou
 * mede o momento do aborto, não a consistência da plate.
 */
function variar(atual: ImpressaoDoProjeto, mesmaPlate: ImpressaoDoProjeto[]): VariacaoDaPlate | null {
	const custos = [atual, ...mesmaPlate]
		.filter((i) => i.status === 'sucesso')
		.map((i) => i.custoTotalCents);
	if (custos.length < 2) return null;

	const menorCents = Math.min(...custos);
	const maiorCents = Math.max(...custos);

	return {
		comparaveis: custos.length,
		menorCents,
		maiorCents,
		pct: menorCents > 0 ? Math.round(((maiorCents - menorCents) / menorCents) * 1000) / 10 : null
	};
}
