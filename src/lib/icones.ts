/**
 * A família de ícones do Carretel.
 *
 * Uma regra de desenho vale para todos, e é ela que dá a cara da família:
 * **contorno é ferramenta, sólido é plástico.** O traço (1,75 px numa grade de
 * 24, pontas redondas) desenha a máquina, a moldura, o gesto. A forma cheia —
 * a classe `m`, de material — é o que saiu ou vai sair do bico: o enrolamento
 * do carretel, a camada recém-depositada, a peça na mesa. Onde o ícone fala de
 * um rolo específico, o sólido recebe a cor cadastrada dele
 * (`--icone-material`); no resto, herda a cor do texto.
 *
 * São vetores de propósito: precisam ficar nítidos de 16 a 28 px, e ícone de
 * navegação e de estado não é lugar para bitmap. Os objetos (o rolo, a peça, a
 * impressora) é que são imagem — ver `FiguraRolo.svelte`.
 *
 * Cada entrada é o miolo de um `<svg viewBox="0 0 24 24">`; quem monta o
 * elemento é `Icone.svelte`.
 */

const anel = (r: number) => `<circle cx="12" cy="12" r="${r}"/>`;
/** Coroa circular cheia (enrolamento visto de frente), entre dois raios. */
const coroa = (fora: number, dentro: number) =>
	`<path class="m" fill-rule="evenodd" d="M12 ${12 - fora}a${fora} ${fora} 0 1 0 0 ${2 * fora} ${fora} ${fora} 0 0 0 0-${2 * fora}zm0 ${fora - dentro}a${dentro} ${dentro} 0 1 1 0 ${2 * dentro} ${dentro} ${dentro} 0 0 1 0-${2 * dentro}z"/>`;

export const ICONES = {
	// ── navegação ──────────────────────────────────────────────────────────
	/** A bancada: uma peça pronta e um rolo em cima da mesa. */
	inicio:
		'<path d="M2.75 15.25h18.5M5.25 15.25v5.5M18.75 15.25v5.5"/><rect class="m" x="4.75" y="8.4" width="6.25" height="5.6" rx="1.3"/><circle cx="16.25" cy="10.5" r="3.5"/><circle class="m" cx="16.25" cy="10.5" r=".95"/>',
	/** O bico deixando uma camada sobre as anteriores. */
	impressoes:
		'<path d="M8.5 2.75h7v4.5l-2.25 3h-2.5L8.5 7.25z"/><rect class="m" x="6" y="12.6" width="12" height="3" rx="1.5"/><path d="M4.5 18.5h15M4.5 21.25h15"/>',
	/** O carretel de frente: aba, enrolamento, furo. */
	filamentos: `${anel(9.25)}${coroa(6.5, 3.3)}<circle class="m" cx="12" cy="12" r="1.05"/>`,
	/** A impressora: pórtico, eixo, cabeça e a peça na mesa. */
	impressoras:
		'<path d="M5 20.5V5.25a1.5 1.5 0 0 1 1.5-1.5h11a1.5 1.5 0 0 1 1.5 1.5V20.5M2.75 20.5h18.5M5 9.5h4.5M14.5 9.5H19"/><rect x="9.5" y="7.25" width="5" height="4.5" rx="1.1"/><path d="M12 11.75v1.5"/><rect class="m" x="8.25" y="15.6" width="7.5" height="3.9" rx="1.1"/>',
	/** Trazer de fora para dentro: a seta pousa o registro na bandeja. */
	importar:
		'<path d="M12 3v9.75M7.75 8.75 12 13l4.25-4.25M3.75 14.5v4a2 2 0 0 0 2 2h12.5a2 2 0 0 0 2-2v-4"/><rect class="m" x="8" y="16" width="8" height="2.1" rx="1.05"/>',
	/** Dois reguladores. */
	config:
		'<path d="M3.5 7.5h17M3.5 16.5h17"/><circle class="m" cx="8.5" cy="7.5" r="2.75"/><circle class="m" cx="15.5" cy="16.5" r="2.75"/>',
	mais: '<circle class="m" cx="5.5" cy="12" r="1.75"/><circle class="m" cx="12" cy="12" r="1.75"/><circle class="m" cx="18.5" cy="12" r="1.75"/>',
	registrar: '<path d="M12 4.75v14.5M4.75 12h14.5"/>',

	// ── estados do rolo ────────────────────────────────────────────────────
	/** O carretel de lado: abas altas e só uma faixa fina de fio no miolo. */
	acabando:
		'<rect x="3.75" y="3.5" width="3" height="17" rx="1.5"/><rect x="17.25" y="3.5" width="3" height="17" rx="1.5"/><rect class="m" x="6.75" y="9.9" width="10.5" height="4.2" rx=".9"/><path d="M2 12h1.75M20.25 12H22" opacity=".6"/>',
	/** Gota: o filamento pode ter absorvido umidade. */
	umidade:
		'<path d="M12 3.25c3.2 3.6 6.25 7.1 6.25 10.9a6.25 6.25 0 0 1-12.5 0C5.75 10.35 8.8 6.85 12 3.25z"/><path class="m" d="M8.6 14.6h6.8a3.4 3.4 0 0 1-6.8 0z"/>',
	/** Embalagem fechada: rolo lacrado. */
	lacrado:
		'<path d="M4 8.25 12 3.75l8 4.5v7.5l-8 4.5-8-4.5zM4 8.25l8 4.5 8-4.5M12 12.75v7.5"/><path class="m" d="m7.6 6.2 8 4.5 1.9-1.05-8-4.5z"/>',

	// ── ações sobre o rolo ─────────────────────────────────────────────────
	/** O rolo em cima da balança. */
	pesar:
		'<circle cx="12" cy="4.9" r="2.15"/><path d="M6 8.5h12M12 8.5v2"/><rect x="3.75" y="10.5" width="16.5" height="9.75" rx="2.25"/><rect class="m" x="8.25" y="13.6" width="7.5" height="3.5" rx="1"/>',
	/** Calor subindo: secagem. */
	secar:
		'<path d="M7.25 3.25c-1.9 2.4 1.9 4.6 0 7M12 3.25c-1.9 2.4 1.9 4.6 0 7M16.75 3.25c-1.9 2.4 1.9 4.6 0 7"/><rect class="m" x="4" y="13.6" width="16" height="3.1" rx="1.55"/><path d="M6.5 20.25h11"/>',
	/** Pôr na impressora: a seta entra no encaixe. */
	carregar:
		'<path d="M3 12h10.25M9.5 8.25 13.25 12 9.5 15.75M14 3.75h4.25a2 2 0 0 1 2 2v12.5a2 2 0 0 1-2 2H14"/>',
	/** Tirar da impressora: a seta sai do encaixe. */
	retirar:
		'<path d="M16.75 12H3.25M7 8.25 3.25 12 7 15.75M13 3.75h5.25a2 2 0 0 1 2 2v12.5a2 2 0 0 1-2 2H13"/>',
	editar:
		'<path d="M4 20h4.2L19.4 8.8a2 2 0 0 0 0-2.8l-1.4-1.4a2 2 0 0 0-2.8 0L4 15.8zM13.4 6.6l4 4"/>',
	/** Guardar na caixa: encerrar o rolo. */
	encerrar:
		'<rect x="3" y="4" width="18" height="4.5" rx="1.25"/><path d="M4.75 8.5v9.5a2 2 0 0 0 2 2h10.5a2 2 0 0 0 2-2V8.5"/><rect class="m" x="9.25" y="11.6" width="5.5" height="2.1" rx="1.05"/>',
	reabrir: '<path d="M8 5 4 9l4 4M4 9h10.5a5.5 5.5 0 0 1 0 11H9"/>',
	excluir:
		'<path d="M4 7h16M9.5 7V5a1.25 1.25 0 0 1 1.25-1.25h2.5A1.25 1.25 0 0 1 14.5 5v2M6.25 7l.9 11.4a2 2 0 0 0 2 1.85h5.7a2 2 0 0 0 2-1.85L17.75 7M10 11v5.5M14 11v5.5"/>',

	// ── impressão e peça ───────────────────────────────────────────────────
	/** A peça: um bloco com a face de cima cheia. */
	peca: '<path class="m" d="M12 3.25 20 7.75 12 12.25 4 7.75z"/><path d="M4 7.75v8.5l8 4.5 8-4.5v-8.5M12 12.25v8.5"/>',
	/** Bloco tracejado: não há imagem guardada desta peça. */
	'sem-imagem':
		'<path stroke-dasharray="2.6 2.9" d="M12 3.25 20 7.75v8.5l-8 4.5-8-4.5v-8.5z"/><path d="M12 12.25v8.5M4 7.75l8 4.5 8-4.5" opacity=".55"/>',
	camadas:
		'<path class="m" d="M12 3.75 20.5 8 12 12.25 3.5 8z"/><path d="M3.5 12.25 12 16.5l8.5-4.25M3.5 16.25 12 20.5l8.5-4.25"/>',
	/** As paredes da peça: o contorno cheio, com o miolo vazio. */
	paredes:
		'<path class="m" fill-rule="evenodd" d="M6.5 3.75h11a2.75 2.75 0 0 1 2.75 2.75v11a2.75 2.75 0 0 1-2.75 2.75h-11a2.75 2.75 0 0 1-2.75-2.75v-11A2.75 2.75 0 0 1 6.5 3.75zm1.75 4.5v7.5h7.5v-7.5z"/>',
	/** O preenchimento: a casca em contorno e a trama cheia por dentro. */
	preenchimento:
		'<rect x="3.75" y="3.75" width="16.5" height="16.5" rx="2.75"/><path class="m" d="M7 10.9 10.9 7l1.35 1.35-3.9 3.9zM7 15.65 15.65 7 17 8.35 8.35 17zM11.75 15.65l3.9-3.9L17 13.1 13.1 17z"/>',
	sucesso: `${anel(9.25)}<path d="M7.9 12.4l2.85 2.85 5.35-5.9"/>`,
	falha: `${anel(9.25)}<path d="M9 9l6 6M15 9l-6 6"/>`,
	cancelada: `${anel(9.25)}<path d="M5.5 5.5l13 13"/>`,

	// ── parcelas do custo e finalidades ────────────────────────────────────
	energia: '<path d="M13.25 2.75 5.5 13.5h5l-1 7.75 8-11h-5.25z"/>',
	manutencao:
		'<path d="M14.9 4.1a4.75 4.75 0 0 0-5.6 6L3.9 15.5a2.3 2.3 0 0 0 3.25 3.25l5.4-5.4a4.75 4.75 0 0 0 6-5.6l-2.8 2.8-2.6-.65-.65-2.6z"/>',
	relogio: `${anel(9.25)}<path d="M12 7v5l3.25 2"/>`,
	estudio:
		'<rect x="3" y="6.75" width="12.5" height="10.5" rx="2.25"/><path d="M15.5 10.6 21 7.5v9l-5.5-3.1"/><circle class="m" cx="7.1" cy="10.6" r="1.25"/>',
	homelab:
		'<rect x="3.75" y="4.25" width="16.5" height="6.5" rx="1.75"/><rect x="3.75" y="13.25" width="16.5" height="6.5" rx="1.75"/><circle class="m" cx="7.4" cy="7.5" r="1.1"/><circle class="m" cx="7.4" cy="16.5" r="1.1"/><path d="M12.5 7.5h4M12.5 16.5h4"/>',
	conteudo:
		'<rect x="3.5" y="5" width="17" height="14" rx="3"/><path class="m" d="M10.2 9.1v5.8l5.1-2.9z"/>',
	pessoal: '<circle cx="12" cy="8" r="3.6"/><path d="M4.75 20.25a7.25 7.25 0 0 1 14.5 0"/>',
	outro: '<path d="M12 3.25 19.6 7.6v8.8L12 20.75 4.4 16.4V7.6z"/><circle cx="12" cy="12" r="2.75"/>',

	// ── utilitários ────────────────────────────────────────────────────────
	buscar: '<circle cx="10.75" cy="10.75" r="6.5"/><path d="M15.75 15.75 20.25 20.25"/>',
	filtrar: '<path d="M4 5.5h16l-6.25 7.25v5.5l-3.5 1.75v-7.25z"/>',
	grade:
		'<rect x="4" y="4" width="6.75" height="6.75" rx="1.6"/><rect x="13.25" y="4" width="6.75" height="6.75" rx="1.6"/><rect x="4" y="13.25" width="6.75" height="6.75" rx="1.6"/><rect x="13.25" y="13.25" width="6.75" height="6.75" rx="1.6"/>',
	lista:
		'<path d="M9 6.5h11.25M9 12h11.25M9 17.5h11.25"/><circle class="m" cx="4.75" cy="6.5" r="1.3"/><circle class="m" cx="4.75" cy="12" r="1.3"/><circle class="m" cx="4.75" cy="17.5" r="1.3"/>',
	voltar: '<path d="M19.5 12h-15M10.5 6l-6 6 6 6"/>',
	seta: '<path d="M4.5 12h15M13.5 6l6 6-6 6"/>',
	'chevron-direita': '<path d="M9.5 6l6 6-6 6"/>',
	'chevron-baixo': '<path d="M6 9.5l6 6 6-6"/>',
	fechar: '<path d="M6 6l12 12M18 6 6 18"/>',
	check: '<path d="M5 12.75 9.75 17.5 19 7.25"/>',
	alerta:
		'<path d="M12 3.75 21.25 19.75H2.75z"/><path d="M12 10v4.25"/><circle class="m" cx="12" cy="17" r="1.05"/>',
	info: `${anel(9.25)}<path d="M12 11.25v5.25"/><circle class="m" cx="12" cy="7.9" r="1.05"/>`,
	foto: '<rect x="3.5" y="5" width="17" height="14" rx="2.25"/><path d="M3.75 16.25 8 12l4 4 3-3 5.25 5.25"/><circle class="m" cx="8.6" cy="9.4" r="1.5"/>',
	nuvem:
		'<path d="M7.25 18.5a4.25 4.25 0 0 1-.7-8.45 5.75 5.75 0 0 1 11.1 1.2 3.7 3.7 0 0 1-.4 7.25z"/>',
	externo:
		'<path d="M13.75 4.5h5.75v5.75M19.5 4.5 11 13M10 6H6.5a2 2 0 0 0-2 2v9.5a2 2 0 0 0 2 2H16a2 2 0 0 0 2-2V14"/>',
	etiqueta:
		'<path d="M3.75 12.4V5.75a2 2 0 0 1 2-2h6.65a2 2 0 0 1 1.4.6l6.45 6.45a2 2 0 0 1 0 2.8l-6.25 6.25a2 2 0 0 1-2.8 0L4.35 13.8a2 2 0 0 1-.6-1.4z"/><circle class="m" cx="8.25" cy="8.25" r="1.4"/>',
	calendario:
		'<rect x="3.75" y="5.25" width="16.5" height="15" rx="2.25"/><path d="M3.75 10h16.5M8 3.25v3.5M16 3.25v3.5"/>'
} as const;

export type NomeIcone = keyof typeof ICONES;

/** O ícone de cada finalidade. Valor fora da lista cai em "outro". */
export const ICONE_DA_FINALIDADE: Record<string, NomeIcone> = {
	estudio: 'estudio',
	homelab: 'homelab',
	conteudo: 'conteudo',
	pessoal: 'pessoal',
	outro: 'outro'
};

/** O ícone de cada resultado de impressão. */
export const ICONE_DO_STATUS: Record<string, NomeIcone> = {
	sucesso: 'sucesso',
	falha: 'falha',
	cancelada: 'cancelada'
};

/** O ícone de cada alerta de rolo. */
export const ICONE_DO_ALERTA: Record<string, NomeIcone> = {
	acabando: 'acabando',
	umidade: 'umidade'
};
