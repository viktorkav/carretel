/**
 * Envio repetido: o mesmo formulário chegando duas vezes.
 *
 * ── O que aconteceu ────────────────────────────────────────────────────────
 *
 * Dois POST concorrentes em `?/aferir` gravaram duas aferições idênticas, no
 * mesmo milissegundo. Não é uso torto: de pé ao lado da impressora, com um a
 * dois segundos de tela parada, tocar de novo é a reação natural. Como a
 * aferição é a âncora do estoque, o fantasma desloca o cálculo do rolo inteiro
 * (crítica de 10/08/2026, item 1).
 *
 * ── Por que um identificador de envio, e não uma janela de tempo ────────────
 *
 * A alternativa óbvia é recusar gravação idêntica dentro de N segundos. Ela foi
 * descartada por dois motivos:
 *
 * 1. **É racy exatamente no caso que precisa pegar.** O defeito relatado são
 *    duas requisições simultâneas; duas consultas "existe algo igual nos
 *    últimos 5 s?" respondem "não" as duas, e as duas gravam. Só uma transação
 *    com trava resolveria — e a trava teria que envolver o insert.
 * 2. **Ela apaga dado legítimo.** Duas pesagens iguais do mesmo rolo em
 *    sequência são improváveis, mas dois cadastros de rolo idênticos NÃO são:
 *    comprar dois carretéis iguais na mesma nota e cadastrar os dois seguidos é
 *    o fluxo normal desde a fusão, e cada compra precisa virar uma linha.
 *
 * O identificador nasce no `load`, vai num campo escondido e é gasto no
 * servidor quando produz registro. Ele distingue "o mesmo envio outra vez" de
 * "dois envios parecidos", que é a pergunta certa. E funciona sem JavaScript,
 * que é requisito duro do Carretel.
 *
 * A checagem e o consumo são **síncronos e adjacentes** de propósito: em Node,
 * nada roda entre os dois, então duas requisições simultâneas não conseguem
 * ambas achar o token livre. É o que a janela de tempo não conseguiria dar.
 *
 * ── O que ele NÃO cobre ────────────────────────────────────────────────────
 *
 * - **Reinício do processo.** A memória é do processo; o container subindo de
 *   novo esquece os envios gastos. Uma repetição que atravesse o reinício
 *   passa. (Consertar isso pediria coluna nova, e schema está fora desta
 *   rodada.)
 * - **Duas abas, dois envios.** Cada renderização tem token próprio, então o
 *   mesmo formulário aberto em duas abas e enviado nas duas grava duas vezes.
 *   É o preço de não confundir envio repetido com dado parecido.
 * - **Formulário sem token.** Página aberta antes desta versão, ou POST feito
 *   à mão, entra sem proteção — a action grava. Recusar seria transformar uma
 *   aba velha em erro sem explicação, num sistema de um usuário só.
 * - **Reenvio pelo botão do navegador** só é pego enquanto o token não expirou;
 *   depois disso, é um envio novo.
 */

import { randomUUID } from 'node:crypto';

/** Nome do campo escondido que carrega o token em todo formulário protegido. */
export const CAMPO_ENVIO = 'envio';

/** Por quanto tempo um envio gasto continua sendo reconhecido como gasto. */
const VALIDADE_MS = 2 * 60 * 60 * 1000;

/** Teto de tokens lembrados. É um sistema de um usuário; isto é folga enorme. */
const TETO = 2000;

/** Token, instante e resultado mínimo para recuperar uma resposta perdida. */
const gastos = new Map<string, { quando: number; roloId?: number }>();

function limpar(agora: number) {
	for (const [token, { quando }] of gastos) {
		if (agora - quando > VALIDADE_MS) gastos.delete(token);
	}
	// `Map` itera na ordem de inserção, então os primeiros são os mais velhos.
	while (gastos.size >= TETO) {
		const maisVelho = gastos.keys().next();
		if (maisVelho.done) break;
		gastos.delete(maisVelho.value);
	}
}

/** Um token novo, para o campo escondido de um formulário que vai ser desenhado. */
export function novoEnvio(): string {
	return randomUUID();
}

export type EstadoDoEnvio = 'novo' | 'repetido' | 'sem-token';

/**
 * Gasta o token deste envio.
 *
 * `'novo'` = pode gravar. `'repetido'` = este mesmíssimo envio já gravou, e a
 * action deve devolver sucesso sem escrever nada. `'sem-token'` = o formulário
 * não mandou identificador (página antiga, POST à mão) e a action segue sem
 * proteção.
 *
 * **Chame imediatamente antes da escrita, sem `await` no meio.** É a adjacência
 * síncrona que faz duas requisições simultâneas não passarem as duas.
 */
export function registrarEnvio(bruto: FormDataEntryValue | null): EstadoDoEnvio {
	const token = String(bruto ?? '').trim();
	if (!token) return 'sem-token';

	const agora = Date.now();
	const quando = gastos.get(token)?.quando;
	if (quando !== undefined && agora - quando <= VALIDADE_MS) return 'repetido';

	limpar(agora);
	gastos.set(token, { quando: agora });
	return 'novo';
}

/**
 * Devolve um token gasto que não chegou a produzir registro.
 *
 * ── Por que ele passou a existir na integração ──────────────────────────────
 *
 * O contrato acima é "gaste imediatamente antes da escrita", e ele parte de uma
 * premissa: que tudo que pode recusar o formulário já rodou. Isso valia quando
 * a trava foi escrita — e deixou de valer quando frentes irmãs puseram REGRAS
 * DE DOMÍNIO dentro das funções de repositório que escrevem (`criarRolo` recusa
 * código repetido; `encerrarRolo` recusa sobra maior que o rolo). Nesses casos o
 * token era queimado e nada era gravado, e o reenvio corrigido do MESMO
 * formulário respondia "já tinha sido enviado" sobre algo que nunca existiu.
 *
 * Devolver é seguro porque nada assíncrono roda entre o gasto e a devolução: em
 * Node, a janela em que o token fica marcado sem escrita é uma sequência
 * síncrona, e nenhuma outra requisição corre nela. A adjacência que faz a trava
 * funcionar é a mesma que faz a devolução não abrir buraco.
 *
 * Só devolva num caminho que NÃO escreveu. Devolver depois de gravar
 * transformaria o token em enfeite.
 */
export function devolverEnvio(bruto: FormDataEntryValue | null): void {
	const token = String(bruto ?? '').trim();
	if (token) gastos.delete(token);
}

/** Só para os testes: esquece tudo que foi gasto. */
export function esquecerEnvios(): void {
	gastos.clear();
}

/** Guarda o ID só depois da escrita; compartilha expiração e limite com o token. */
export function lembrarRoloDoEnvio(bruto: FormDataEntryValue | null, roloId: number): void {
 const entrada = gastos.get(String(bruto ?? '').trim());
 if (entrada) entrada.roloId = roloId;
}

export function roloDoEnvio(bruto: FormDataEntryValue | null): number | undefined {
 const entrada = gastos.get(String(bruto ?? '').trim());
 return entrada && Date.now() - entrada.quando <= VALIDADE_MS ? entrada.roloId : undefined;
}
