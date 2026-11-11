import { textoParaCentavosEstrito, textoParaCentavosPositivo } from '../dinheiro';

export type CampoNumerico = { ok: true; valor: number } | { ok: false; erro: string };

/**
 * Converte texto de campo numérico em número, aceitando **vírgula decimal**.
 *
 * O sistema é em português e a vírgula é o separador natural: quem digita a
 * densidade de um PETG escreve `1,27`. `Number('1,27')` é `NaN`, e a regra de
 * "não numérico usa o padrão" transformava isso em `1,24` gravado com HTTP 200
 * e mensagem de sucesso — o valor errado, em silêncio, no campo que alimenta o
 * cálculo. O campo de preço já tratava vírgula; os outros não, e a divergência
 * entre dois campos do MESMO formulário é o que tornava o defeito invisível.
 *
 * Ponto continua valendo como decimal (`1.27`), porque teclado numérico de
 * celular costuma oferecer só ele.
 */
export function textoParaNumero(texto: string): number {
	return Number(texto.replace(',', '.'));
}

// Nome curto para o uso interno deste arquivo, que é onde ele nasceu.
const paraNumero = textoParaNumero;


/**
 * ── Criar e editar não são a mesma leitura de formulário ────────────────────
 *
 * Os helpers de CRIAÇÃO (`campoNumericoPositivo`, `campoPreco`, `campoDataHora`)
 * tratam campo em branco como "o usuário não quis preencher" e caem num padrão
 * documentado no próprio formulário. Isso é certo num cadastro novo, onde não há
 * nada a perder, e é destruição de dado numa edição: o formulário de edição vem
 * PREENCHIDO com o valor guardado, então limpar um campo é um gesto de um
 * clique — e o padrão entra por cima, com HTTP 200 e mensagem "salva".
 *
 * Pior no Carretel do que num CRUD qualquer: com "Recalcular" marcado, esses
 * padrões viram custo congelado reescrito a partir de valores que o usuário
 * nunca digitou (duração vazia zera energia e depreciação, e ainda tira a
 * impressão do horímetro, mexendo na manutenção de todas as outras da máquina).
 *
 * Os helpers abaixo são a versão de EDIÇÃO: em branco é erro, lixo é erro,
 * padrão nenhum. É o mesmo desenho que `gramas` e o peso aferido já usavam.
 */

/** Numérico que a edição EXIGE: em branco, não numérico, infinito ou ≤ 0 falham. */
export function campoNumericoObrigatorio(
	bruto: FormDataEntryValue | null,
	nome: string
): CampoNumerico {
	const texto = String(bruto ?? '').trim();
	// "não pode ficar em branco", e não "é obrigatório": os nomes de campo
	// misturam gênero ("a densidade", "o preço pago"), e um template só com
	// concordância fixa erra metade deles.
	if (!texto) return { ok: false, erro: `${nome} não pode ficar em branco` };

	const valor = paraNumero(texto);
	// `Number.isFinite` cobre NaN ("8OOO" com letra O) e Infinity ("1e999") de
	// uma vez: os dois são "não é um número que sirva", e o segundo passava por
	// todo teste que só olhava NaN e sinal.
	if (!Number.isFinite(valor)) return { ok: false, erro: `${nome}: "${texto}" não é um número` };
	if (valor <= 0) return { ok: false, erro: `${nome} deve ser maior que zero` };
	return { ok: true, valor };
}

export type CampoOpcional = { ok: true; valor: number | null } | { ok: false; erro: string };

/**
 * Numérico OPCIONAL numa edição (camada, paredes, infill, temperaturas).
 *
 * Em branco é uma resposta legítima — a coluna é nullable e a tela esconde o
 * campo quando ele é nulo —, então vazio devolve `null`. O que não pode
 * continuar passando é lixo digitado virando `null` em silêncio, que é
 * indistinguível de "apaguei de propósito".
 */
export function campoNumericoOpcional(
	bruto: FormDataEntryValue | null,
	nome: string,
	opcoes: { permiteZero?: boolean } = {}
): CampoOpcional {
	const texto = String(bruto ?? '').trim();
	if (!texto) return { ok: true, valor: null };

	const valor = paraNumero(texto);
	if (!Number.isFinite(valor)) return { ok: false, erro: `${nome}: "${texto}" não é um número` };
	// Zero é domínio válido em alguns campos e absurdo em outros: infill 0% é
	// peça vazada, e o fatiador escreve isso; altura de camada 0 não existe.
	// Sem esta distinção, três impressões importadas com infill 0% ficavam
	// IMPOSSÍVEIS de editar, e a única saída (limpar o campo) apagava o
	// parâmetro que veio da nuvem.
	if (opcoes.permiteZero ? valor < 0 : valor <= 0) {
		return {
			ok: false,
			erro: opcoes.permiteZero
				? `${nome} não pode ser negativo`
				: `${nome} deve ser maior que zero`
		};
	}
	return { ok: true, valor };
}

/**
 * Numérico opcional em que ZERO é uma resposta, e não campo em branco.
 *
 * É o único do projeto assim, e existe para um campo só: a sobra pesada no
 * encerramento de um rolo. Todos os outros numéricos recusam zero de propósito
 * — peso inicial zero é divisão por zero no custo, pesagem avulsa zero é
 * `Number('')` disfarçado. Aqui `0` quer dizer "acabou, não sobrou nada", que é
 * exatamente o dado mais útil dos dois motivos de encerramento.
 *
 * Vazio devolve `null` ("não pesei"), que é resposta legítima. Lixo é erro: uma
 * pesagem digitada errada virando `null` seria indistinguível de não ter pesado,
 * e o encerramento passaria sem o número que justifica a tela.
 */
export function campoNumericoNaoNegativoOpcional(
	bruto: FormDataEntryValue | null,
	nome: string
): CampoOpcional {
	const texto = String(bruto ?? '').trim();
	if (!texto) return { ok: true, valor: null };

	// `paraNumero`, e não `Number`: este helper nasceu na frente do encerramento,
	// que saiu de uma base ANTERIOR à correção da vírgula decimal — e chegou aqui
	// como o único numérico do arquivo que ainda recusava `6,4`. Uma sobra final
	// digitada com vírgula viraria "não é um número" no único campo do sistema em
	// que o usuário está lendo uma balança.
	const valor = paraNumero(texto);
	if (!Number.isFinite(valor)) return { ok: false, erro: `${nome}: "${texto}" não é um número` };
	if (valor < 0) return { ok: false, erro: `${nome} não pode ser negativa` };
	return { ok: true, valor };
}

/**
 * Preço numa edição. Em branco falha; "0" e "0,00" continuam significando
 * "não informado", porque é assim que o valor volta preenchido no formulário.
 */
export function campoPrecoObrigatorio(
	bruto: FormDataEntryValue | null,
	nome: string
): CampoNumerico {
	const texto = String(bruto ?? '').trim();
	if (!texto) {
		return {
			ok: false,
			erro: `${nome} não pode ficar em branco; digite 0,00 se você não souber o valor`
		};
	}

	const cents = textoParaCentavosEstrito(texto);
	if (cents === null) {
		return { ok: false, erro: `${nome} inválido; use algo como 129,90, ou 0,00 se não souber` };
	}
	return { ok: true, valor: cents };
}

/** Data e hora que a edição EXIGE: em branco não pode virar "agora" em silêncio. */
export function campoDataHoraObrigatoria(
	bruto: FormDataEntryValue | null,
	nome: string
): CampoNumerico {
	const texto = String(bruto ?? '').trim();
	if (!texto) return { ok: false, erro: `${nome} não pode ficar em branco` };

	const valor = new Date(texto).getTime();
	if (!Number.isFinite(valor)) return { ok: false, erro: `${nome} inválido` };
	return { ok: true, valor };
}

/**
 * Lê um campo numérico do formulário que nunca faz sentido em zero ou
 * negativo (vida útil, potência, densidade, peso). Ausente, vazio ou texto
 * não numérico (ex.: "abc") usa o padrão documentado no próprio formulário
 * — o usuário só não preencheu, não é erro. Um número que o usuário de fato
 * digitou mas está fora do domínio (zero ou negativo) é erro real: falha a
 * request em vez de gravar um valor que quebra a conta depois (ex.: custo
 * por hora = preço / 0).
 */
export function campoNumericoPositivo(
	bruto: FormDataEntryValue | null,
	padrao: number,
	nome: string
): CampoNumerico {
	const texto = String(bruto ?? '').trim();
	if (!texto) return { ok: true, valor: padrao };

	const valor = paraNumero(texto);
	if (Number.isNaN(valor)) return { ok: true, valor: padrao };
	if (valor <= 0) return { ok: false, erro: `${nome} deve ser maior que zero` };
	// `Number('1e999')` e `Number('Infinity')` são Infinity: não são NaN, não
	// são <= 0, e passavam direto até o banco. `peso_liquido_inicial_g = Inf`
	// renderiza como `<progress value="Infinity">` e envenena toda conta de
	// estoque daquele rolo. (O padrão pode ser NaN de propósito — `aferir` usa
	// isso pra exigir o campo —, e ele sai antes, pelo ramo do texto vazio.)
	//
	// A `catalogo` e a `edicao` acharam este mesmo buraco separadas e o taparam
	// cada uma com a sua mensagem; o merge empilhou as duas guardas e deixou a
	// segunda inalcançável. Ficou uma só. A mensagem é a de "grande demais"
	// porque é a verdadeira: "1e999" É um número, ele só estourou a faixa — e
	// com a guarda de sinal na frente, "-1e999" ainda cai no erro certo, que é
	// o de ser maior que zero.
	if (!Number.isFinite(valor)) return { ok: false, erro: `${nome} é grande demais` };
	return { ok: true, valor };
}

/**
 * Cor em hexadecimal do cadastro manual.
 *
 * O valor é renderizado direto em `style="background-color: …"`, então texto
 * livre aqui vira CSS arbitrário na página. Não é XSS e a máquina é do dono,
 * mas o campo tem exatamente um formato válido e não custa exigir. Aceita com
 * ou sem `#`, e normaliza pra caixa alta, que é como o catálogo grava.
 */
export function campoCorHex(
	bruto: FormDataEntryValue | null,
	nome: string
): { ok: true; valor: string } | { ok: false; erro: string } {
	const texto = String(bruto ?? '').trim();
	if (!texto) return { ok: true, valor: '' };

	const comCerquilha = texto.startsWith('#') ? texto : `#${texto}`;
	if (!/^#[0-9A-Fa-f]{6}$/.test(comCerquilha)) {
		return { ok: false, erro: `${nome} inválida; use um hex de 6 dígitos, tipo #bb9af7` };
	}
	return { ok: true, valor: comCerquilha.toUpperCase() };
}

/**
 * Id vindo de `<select>` ou de campo escondido. A regra do projeto é que
 * nenhuma action responde 500 por entrada de usuário, e um id malformado que
 * chega até o `insert` vira `FOREIGN KEY constraint failed` — 500 com stack no
 * log e nada dito ao usuário. Aqui morre tudo que não é inteiro positivo:
 * ausente, vazio, "abc", "0", negativo e fracionário.
 *
 * Existência no banco é outra checagem, e mora na rota (é ela que tem o `db`).
 */
export function campoId(bruto: FormDataEntryValue | null, erro: string): CampoNumerico {
	// Ausente e vazio não precisam de ramo próprio: `Number('')` é 0, e 0 já
	// não passa no teste de inteiro positivo abaixo.
	const valor = Number(String(bruto ?? '').trim());
	if (!Number.isInteger(valor) || valor <= 0) return { ok: false, erro };
	return { ok: true, valor };
}

/**
 * Uma LISTA de ids vinda de caixas de seleção com o mesmo `name`.
 *
 * É o que a edição em lote de `/impressoes` submete. A lei é a de `campoId`,
 * repetida por item: nenhuma action responde 500 por entrada de usuário, e
 * `where id in (NaN)` é erro de driver, não mensagem de formulário. O que não é
 * inteiro positivo simplesmente não entra na lista.
 *
 * Deduplica porque marcar a mesma linha duas vezes (formulário adulterado, ou
 * dois controles apontando para a mesma peça) é uma linha, não duas — e o
 * número de linhas afetadas é o que a tela devolve como confirmação.
 */
export function campoIds(form: FormData, nome: string): number[] {
	const vistos = new Set<number>();
	for (const bruto of form.getAll(nome)) {
		const n = Number(String(bruto ?? '').trim());
		if (!Number.isInteger(n) || n <= 0) continue;
		vistos.add(n);
	}
	return [...vistos];
}

/**
 * O que foi digitado, de volta para a tela junto com o erro.
 *
 * **O defeito que isto conserta:** errar um campo devolvia o formulário inteiro
 * VAZIO, com a mensagem a 1.400 px acima do ponto do erro. O padrão certo já
 * existia no próprio repositório — `criarDoCatalogo` devolve `marca` e `cor`
 * junto do `fail` justamente para que um preço mal digitado não apague o que já
 * tinha sido ajustado à mão. Este helper é aquele gesto virado peça, para as
 * outras actions o repetirem sem cada uma inventar o seu.
 *
 * Nada é normalizado: o eco é para o humano reler o que ELE escreveu, e um
 * `trim()` aqui esconderia justamente o espaço sobrando que causou o erro.
 * `File` vira string vazia — não há campo de arquivo no Carretel, e devolver o
 * objeto para um `value=` renderizaria `[object File]` na cara do usuário.
 */
export function ecoDoFormulario(form: FormData, nomes: string[]): Record<string, string> {
	const eco: Record<string, string> = {};
	for (const nome of nomes) {
		const bruto = form.get(nome);
		eco[nome] = typeof bruto === 'string' ? bruto : '';
	}
	return eco;
}

/**
 * Campo `<input type="datetime-local">`, que manda `"2026-08-09T21:00"` — sem
 * offset de fuso. Quem resolve o instante é o fuso do processo, fixado em
 * `TZ=America/Sao_Paulo` no compose (ver README).
 *
 * Vazio significa "agora", que é o comportamento útil pra quem registra a
 * impressão assim que ela termina. Texto que não é data devolve erro em vez de
 * virar `NaN` — `new Date('abc').getTime()` é NaN, e NaN num campo `notNull`
 * de timestamp vira `NOT NULL constraint failed`, ou seja, 500.
 */
export function campoDataHora(bruto: FormDataEntryValue | null, agora: number): CampoNumerico {
	const texto = String(bruto ?? '').trim();
	if (!texto) return { ok: true, valor: agora };

	const valor = new Date(texto).getTime();
	if (!Number.isFinite(valor)) return { ok: false, erro: 'data de início inválida' };
	return { ok: true, valor };
}

/**
 * Preço de cadastro (rolo, impressora), em centavos.
 *
 * `textoParaCentavos` satura qualquer lixo em `0`, e zero num preço de rolo não
 * é um erro visível: é custo de filamento zero em TODA impressão daquele rolo,
 * congelado no registro — continua errado mesmo depois de corrigir o cadastro.
 *
 * Preço legitimamente desconhecido continua permitido, mas só **em branco**, de
 * forma explícita: campo vazio é 0 ("não informado"), e qualquer coisa digitada
 * precisa ser um valor monetário positivo de verdade.
 */
export function campoPreco(bruto: FormDataEntryValue | null, nome: string): CampoNumerico {
	const texto = String(bruto ?? '').trim();
	if (!texto) return { ok: true, valor: 0 };

	const cents = textoParaCentavosPositivo(texto);
	if (cents === null) {
		return {
			ok: false,
			erro: `${nome} inválido; use algo como 129,90, ou deixe em branco se não souber`
		};
	}
	return { ok: true, valor: cents };
}
