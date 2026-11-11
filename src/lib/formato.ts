/**
 * Formatação de APRESENTAÇÃO — só o que a tela escreve.
 *
 * Nada aqui calcula: as contas moram em `$lib/server`, e a conversão de
 * centavos para decimal mora em `$lib/dinheiro`. `reais()` COMPÕE sobre
 * `centavosParaTexto` em vez de refazer a conta, para não existirem duas
 * definições de "quanto vale um centavo" no mesmo repositório.
 *
 * Os mapas de rótulo estão aqui, e não repetidos em cada tela, porque o
 * design system tem uma lei sobre eles: caixa alta tem um dono só — o rótulo
 * genérico de campo. Valor de enum, nome de estado e nome de finalidade são
 * palavra comum, em caixa baixa. Ter os três num lugar só é o que impede uma
 * tela escrever "Acabando" e a vizinha escrever "acabando".
 */
import { centavosParaTexto } from './dinheiro';

/** "R$ 1.284,60" — com separador de milhar, que `centavosParaTexto` não põe. */
export function reais(cents: number): string {
	const texto = centavosParaTexto(cents);
	const [inteiro, decimal] = texto.split(',');
	const negativo = inteiro.startsWith('-');
	const digitos = negativo ? inteiro.slice(1) : inteiro;
	const comMilhar = digitos.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
	return `R$ ${negativo ? '-' : ''}${comMilhar},${decimal}`;
}

export function numero(valor: number, casas = 1): string {
	return valor.toLocaleString('pt-BR', {
		minimumFractionDigits: casas,
		maximumFractionDigits: casas
	});
}

/** Unidade sempre separada do número por um espaço — inclusive "mm". */
export function comUnidade(valor: number, unidade: string, casas = 1): string {
	return `${numero(valor, casas)} ${unidade}`;
}

/**
 * Massa de uma peça ou de um consumo, em gramas, do jeito que se lê: inteiro
 * sem casas ("50 g"), décimos e centésimos só quando existem ("82,5 g",
 * "0,04 g"). O fatiador informa centésimos; "0,04 g" não pode virar "0 g".
 */
export function massa(gramas: number): string {
	if (!Number.isFinite(gramas)) return '—';
	return `${gramas.toLocaleString('pt-BR', { maximumFractionDigits: 2 })} g`;
}

/** Duração por extenso curto: "45 min", "1 h", "1 h 30 min". */
export function duracaoCurta(segundos: number): string {
	if (!Number.isFinite(segundos) || segundos < 0) return '—';
	const min = Math.round(segundos / 60);
	const h = Math.floor(min / 60);
	const m = min % 60;
	return h === 0 ? `${m} min` : m === 0 ? `${h} h` : `${h} h ${String(m).padStart(2, '0')} min`;
}

export function dataCurta(ms: number | Date): string {
	return new Date(ms).toLocaleDateString('pt-BR');
}

export function dataHora(ms: number | Date): string {
	return new Date(ms).toLocaleString('pt-BR', {
		day: '2-digit',
		month: '2-digit',
		year: 'numeric',
		hour: '2-digit',
		minute: '2-digit'
	});
}

/**
 * Valor de `<input type="datetime-local">`: "2026-08-09T21:00", sem offset.
 *
 * `toISOString()` não serve — ele converte para UTC, e o campo é lido de volta
 * como hora LOCAL por `campoDataHora`. Uma ida e volta pelo ISO deslocaria a
 * impressão em três horas a cada edição salva sem tocar no campo.
 */
export function paraCampoDataHora(ms: number | Date): string {
	const d = new Date(ms);
	const doisDigitos = (n: number) => String(n).padStart(2, '0');
	return (
		`${d.getFullYear()}-${doisDigitos(d.getMonth() + 1)}-${doisDigitos(d.getDate())}` +
		`T${doisDigitos(d.getHours())}:${doisDigitos(d.getMinutes())}`
	);
}

/**
 * Duração em segundos no formato que `duracaoParaSegundos` lê de volta.
 *
 * Sem `toLocaleString` de propósito: ele põe separador de MILHAR, e "1.234,56h"
 * volta do parser como zero. Aqui a vírgula é só o separador decimal.
 */
export function paraCampoDuracao(duracaoS: number): string {
	return `${(duracaoS / 3600).toFixed(2).replace('.', ',')}h`;
}

/**
 * A mesma palavra, com a inicial maiúscula. Os nomes de finalidade e de status
 * são guardados em caixa baixa porque entram no meio de frases ("reclassificada
 * como estúdio"); quando a palavra aparece SOZINHA (opção de lista, cabeçalho,
 * legenda), ela começa a frase e leva maiúscula.
 */
export function inicial(texto: string): string {
	return texto.charAt(0).toLocaleUpperCase('pt-BR') + texto.slice(1);
}

/**
 * Um número para o `value` de um campo decimal, com vírgula: é assim que ele é
 * digitado aqui ("0,2", "82,5"), e os campos decimais aceitam os dois sinais.
 */
export function paraCampoDecimal(n: number | null | undefined): string {
	return n == null || !Number.isFinite(n) ? '' : String(n).replace('.', ',');
}

/**
 * Uma mensagem como frase: inicial maiúscula e ponto final.
 *
 * As recusas e os avisos saem do servidor em caixa baixa e sem ponto ("preço
 * pago inválido; use algo como 129,90"), porque lá são valores, comparados por
 * teste. Na tela eles são ditos a uma pessoa, e começam e terminam como frase.
 */
export function frase(texto: string): string {
	const t = texto.trim();
	if (!t) return '';
	return inicial(t) + (/[.!?…:]["”')\]]?$/.test(t) ? '' : '.');
}

/**
 * O banco guarda o enum sem acento e em caixa baixa (`estudio`, `conteudo`).
 * A tela escreve a palavra em português, acentuada e em caixa baixa: não é
 * saída de máquina verbatim, é palavra comum.
 */
export const FINALIDADE: Record<string, string> = {
	estudio: 'estúdio',
	homelab: 'homelab',
	conteudo: 'conteúdo',
	pessoal: 'pessoal',
	outro: 'outro'
};

/**
 * Finalidade → a cor do ponto e da barra em "Por finalidade", no Início.
 *
 * As cinco cores moram em `src/app.css` (`--fin-*`) e são cor de DADO
 * categórico, separadas de propósito das três que o produto usa para falar de
 * si: o petróleo da ação e da seleção (`--acento`), o âmbar do alerta e o
 * vermelho do erro. Uma finalidade pintada em qualquer uma dessas leria como
 * "clique aqui", "atenção" ou "deu errado" numa legenda que não é veredito
 * nenhum.
 *
 * "outro" é o balde residual e leva a mais quieta (`--fin-outro`): em dado
 * real ele pode ser a fatia inteira do período, e a barra de ponta a ponta não
 * deve ser a mais acesa da tela.
 *
 * Nenhuma delas se confunde com cor de FILAMENTO, que vem sempre de
 * `rolo.corHex` e só aparece na amostra redonda ao lado do nome do rolo.
 */
export const COR_FINALIDADE: Record<string, string> = {
	estudio: 'var(--fin-estudio)',
	homelab: 'var(--fin-homelab)',
	conteudo: 'var(--fin-conteudo)',
	pessoal: 'var(--fin-pessoal)',
	outro: 'var(--fin-outro)'
};

/**
 * Status do rolo → a palavra que a tela escreve.
 *
 * O banco guarda a palavra curta (`vazio`, `descartado`), que diz o estado mas
 * não diz a HISTÓRIA — e as duas de encerramento são justamente histórias
 * diferentes: `vazio` é o filamento ter acabado, `descartado` é o dono ter
 * encerrado um rolo que ainda tem material. Escrever "descartado" na tela faria
 * o dono ler "joguei fora", que não é o que aconteceu com a amostra de 20 g.
 *
 * As palavras dos VALORES continuam as do banco no `<select>` de correção — lá
 * o que se está editando é a coluna. Aqui é o que se lê.
 */
export const STATUS_ROLO: Record<string, string> = {
	fechado: 'lacrado',
	aberto: 'aberto',
	vazio: 'acabou',
	descartado: 'encerrado com sobra'
};

/**
 * O texto do alerta carrega a informação inteira: se o ponto colorido sumisse,
 * a frase continuaria completa. Cor nunca é canal único.
 */
export const ALERTA: Record<string, string> = {
	acabando: 'acabando',
	umidade: 'pode estar úmido, secar antes de usar'
};

/**
 * As marcas da Mesa: três estados, a identidade — e o LIGADO.
 *
 * `ligado` não é um quarto estado: é a assinatura da mãe (a casa, grau 217 do
 * anel) para A coisa acesa da bancada — aqui, a impressão em andamento, o LED
 * da impressora rodando. Teto de UM ligado por tela; todo o resto fica
 * apagado. O desenho mora em `.marca--ligado` de app.css (casa + halo
 * emissivo + pulso-do-ligado, a única oscilação legal do sistema).
 */
export type Estado = 'ok' | 'atencao' | 'falha' | 'materia' | 'ligado';

/**
 * Estado da impressão → marca da Mesa. As palavras ESCRITAS continuam sendo as
 * do domínio (`sucesso`, `falha`, `cancelada`): a Mesa exige palavra comum em
 * caixa baixa, não exige as palavras dela. O que o mapa escolhe é só de que
 * cor é o ponto.
 */
export const ESTADO_DA_IMPRESSAO: Record<string, Estado> = {
	sucesso: 'ok',
	falha: 'falha',
	cancelada: 'atencao'
};
