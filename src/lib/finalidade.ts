/**
 * A finalidade da impressão — o eixo do único card de ANÁLISE do painel.
 *
 * O card "Por finalidade" nasceu morto: a tela de importação tinha um seletor
 * único para o lote inteiro, as 11 impressões reais entraram no mesmo balde e o
 * painel desenha hoje uma barra só, com 100%. Uma barra de 100% não responde
 * pergunta nenhuma.
 *
 * Este módulo é a parte PURA da correção: o domínio fechado, a leitura tolerante
 * de formulário, e a sugestão automática que dá à finalidade a mesma primeira
 * camada que o rolo já tinha. Sem banco e sem Svelte — quem fala com o banco é
 * `$lib/server/nuvem/importacao`, e quem desenha é a tela.
 */

export const FINALIDADES = ['estudio', 'homelab', 'conteudo', 'pessoal', 'outro'] as const;

export type Finalidade = (typeof FINALIDADES)[number];

/**
 * Texto de formulário → finalidade, ou `null` quando não é uma delas.
 *
 * **`null` não é `outro`.** A diferença é o que sustenta as camadas de
 * precedência: campo vazio significa "herda de quem está acima" (a sugestão, o
 * grupo, o lote), e `outro` é uma escolha que o usuário fez de propósito. Um
 * helper que saturasse vazio em `outro` reconstruiria o defeito — todo lote
 * voltaria a cair no mesmo balde, agora por dentro.
 */
export function normalizarFinalidade(bruto: FormDataEntryValue | string | null): Finalidade | null {
	const texto = String(bruto ?? '').trim();
	return (FINALIDADES as readonly string[]).includes(texto) ? (texto as Finalidade) : null;
}

/**
 * Chave de peça: é ela que liga uma tarefa nova ao que já foi impresso antes.
 *
 * O mesmo modelo chega com nomes ligeiramente diferentes conforme quem fatiou
 * (`MagicTray.3mf`, `MagicTray`, `magictray`), então caixa, acento, espaço
 * repetido e extensão de arquivo saem fora. É reconhecimento de peça, não
 * identidade: errar para o lado de casar demais custa uma sugestão ruim que o
 * usuário troca num clique; errar para o outro custa a sugestão inteira.
 */
export function chaveDePeca(nome: string): string {
	return nome
		.normalize('NFD')
		.replace(/[\u0300-\u036f]/gu, '')
		.toLowerCase()
		// `.gcode.3mf` sai em duas passadas — por isso o `+` no fim.
		.replace(/(\.(3mf|gcode|stl|step|obj))+$/g, '')
		.replace(/\s+/g, ' ')
		.trim();
}

interface RegistroDeFinalidade {
	nome: string;
	finalidade: string;
	inicioEm: number;
}

/**
 * O histórico de finalidade condensado numa resposta por peça.
 *
 * **`outro` não entra na conta.** Ele é a ausência de decisão, não uma decisão:
 * é literalmente o valor que as 11 impressões receberam por não ter havido
 * escolha. Deixá-lo alimentar a sugestão faria o defeito se propagar sozinho —
 * o balde único ensinaria o sistema a continuar sugerindo o balde único.
 *
 * Entre finalidades de verdade, ganha a mais frequente; no empate, a mais
 * recente, que é a intenção mais atual sobre aquela peça.
 */
export function resumirFinalidades(
	registros: RegistroDeFinalidade[]
): Map<string, Finalidade> {
	const contagem = new Map<string, Map<Finalidade, { vezes: number; ultima: number }>>();

	for (const r of registros) {
		const finalidade = normalizarFinalidade(r.finalidade);
		if (!finalidade || finalidade === 'outro') continue;

		const chave = chaveDePeca(r.nome);
		if (!chave) continue;

		let porFinalidade = contagem.get(chave);
		if (!porFinalidade) {
			porFinalidade = new Map();
			contagem.set(chave, porFinalidade);
		}
		const atual = porFinalidade.get(finalidade);
		porFinalidade.set(finalidade, {
			vezes: (atual?.vezes ?? 0) + 1,
			ultima: Math.max(atual?.ultima ?? -Infinity, r.inicioEm)
		});
	}

	const resumo = new Map<string, Finalidade>();
	for (const [chave, porFinalidade] of contagem) {
		let melhor: { finalidade: Finalidade; vezes: number; ultima: number } | null = null;
		for (const [finalidade, dados] of porFinalidade) {
			const ganha =
				melhor === null ||
				dados.vezes > melhor.vezes ||
				(dados.vezes === melhor.vezes && dados.ultima > melhor.ultima);
			if (ganha) melhor = { finalidade, ...dados };
		}
		if (melhor) resumo.set(chave, melhor.finalidade);
	}
	return resumo;
}

/**
 * A finalidade provável de uma peça, ou `null` quando ela é inédita.
 *
 * É a camada mais fraca que ainda diz alguma coisa: o MagicTray foi impresso
 * quatro vezes, e a quinta não deveria ter que ser classificada do zero.
 * Nunca chuta — peça sem histórico devolve `null` e cai no que o lote mandar.
 */
export function sugerirFinalidade(
	nome: string,
	historico: Map<string, Finalidade>
): Finalidade | null {
	// Sem guarda para nome vazio de propósito: `resumirFinalidades` nunca grava
	// chave vazia, então `historico.get('')` já é `undefined`. Uma guarda a mais
	// aqui seria linha que nenhum teste consegue matar.
	return historico.get(chaveDePeca(nome)) ?? null;
}
