/**
 * Busca no catálogo embarcado de filamentos.
 *
 * Módulo puro, sem banco e sem SvelteKit: recebe a lista e a consulta,
 * devolve os itens. Quem carrega o JSON é `./index.ts`.
 */

export interface ItemCatalogo {
	/** Chave estável. Código de cor da Bambu ("10300") na entrada com cor, e
	 *  o próprio código do filamento ("GFA00") na entrada sem cor. */
	id: string;
	/** `null` = a linha inteira, sem cor escolhida. Serve pro rolo de outra
	 *  marca rodando com perfil genérico e pros códigos sem tabela de cor. */
	cor: string | null;
	/** Termos extras de busca da cor: o nome em inglês (única língua que cobre
	 *  as 314 cores) mais o equivalente em português das palavras de cor dele.
	 *  Nunca é exibido nem gravado — só engorda o texto buscável. */
	corAlias: string | null;
	corHex: string | null;
	marca: string;
	/** Nome comercial da linha, como está no rótulo ("PLA Matte", "PETG HF"). */
	material: string;
	/** Polímero base ("PLA", "PETG"). Não vai pro cadastro; existe pra que
	 *  buscar "petg" ache "PETG-CF" e "HF" sem depender do nome comercial. */
	polimero: string | null;
	densidade: number;
	tempBico: number | null;
	tempMesa: number | null;
	codigoBambu: string;
	imagemUrl?: string;
	densidadeEstimada?: boolean;
	produtoUrl?: string;
	logoUrl?: string;
	fonteCatalogo?: 'bambu' | 'ofd' | 'manual';
	fonteUrl?: string;
	versaoFonte?: string;
	/** Códigos de produto usados apenas para reconciliar variantes Bambu. */
	codigosCorBambu?: string[];
}

export interface Catalogo {
	fonte: string;
	licencaFonte: string;
	commit: string;
	geradoEm: string;
	itens: ItemCatalogo[];
}

/**
 * Caixa baixa, sem acento, pontuação virando espaço. É o que faz "azul
 * celeste" achar "Azul-celeste" e "gfg99" achar "GFG99" — quem tem o rolo na
 * mão digita o que lê no rótulo, não o que está no JSON.
 *
 * **O `+` sobrevive, e isso é obrigatório.** A Bambu vende `PLA Silk` e
 * `PLA Silk+` (GFA05 e GFA06) nas mesmas seis cores, com densidades
 * diferentes — e o mesmo vale pra `PLA Tough` (1.26) e `PLA Tough+` (1.21).
 * Dobrando o `+`, os dois viravam a mesma chave de dedupe: um rolo de Silk+
 * era pendurado no filamento do Silk, herdava GFA05 no lugar de GFA06, e a
 * importação da nuvem chegando com GFA06 não achava mais nada. O `+` é a
 * única coisa no nome que separa os dois produtos.
 *
 * Na busca ele também ajuda: "silk" continua trazendo os dois (casa como
 * substring) e "silk+" passa a conseguir isolar o Silk+.
 */
export function normalizar(texto: string): string {
	return texto
		.normalize('NFD')
		.replace(/[\u0300-\u036f]/g, '')
		.toLowerCase()
		.replace(/[^a-z0-9+]+/g, ' ')
		.trim();
}

function textoBuscavel(i: ItemCatalogo): string {
	return normalizar(
		[i.marca, i.material, i.polimero ?? '', i.cor ?? '', i.corAlias ?? '', i.codigoBambu].join(' ')
	);
}

/**
 * Ordem de exibição. Três baldes:
 *   0 — a consulta inteira É o código Bambu do item (ele digitou "GFG99");
 *   1 — item com cor definida (o caso normal de rolo na mão);
 *   2 — item sem cor (a linha genérica, que é fallback).
 * Empate desempata por marca, material e cor, em pt-BR.
 */
function balde(i: ItemCatalogo, consulta: string): number {
	if (normalizar(i.codigoBambu) === consulta) return 0;
	return i.cor ? 1 : 2;
}

export interface ResultadoBusca {
	/** Só os que couberam no limite, já ordenados. */
	itens: ItemCatalogo[];
	/** Quantos casaram no total, incluindo os que ficaram de fora. */
	total: number;
	/** `true` quando sobrou item fora da lista — a tela precisa dizer isso, ou
	 *  o usuário conclui que o rolo dele não está no catálogo. */
	truncado: boolean;
}

export function buscarNoCatalogo(
	itens: ItemCatalogo[],
	consulta: string,
	limite = 20
): ResultadoBusca {
	const alvo = normalizar(consulta);
	if (!alvo) return { itens: [], total: 0, truncado: false };

	const termos = alvo.split(' ');
	const achados = itens.filter((i) => {
		const texto = textoBuscavel(i);
		// E, não OU: cada termo digitado tem que aparecer em algum campo.
		return termos.every((t) => texto.includes(t));
	});

	achados.sort((a, b) => {
		const d = balde(a, alvo) - balde(b, alvo);
		if (d !== 0) return d;
		return (
			a.marca.localeCompare(b.marca, 'pt-BR') ||
			a.material.localeCompare(b.material, 'pt-BR') ||
			(a.cor ?? '').localeCompare(b.cor ?? '', 'pt-BR')
		);
	});

	// Ordenar antes de cortar: cortar antes jogaria fora o item que o balde
	// teria posto em primeiro.
	return {
		itens: achados.slice(0, limite),
		total: achados.length,
		truncado: achados.length > limite
	};
}

/**
 * Marca + material + cor, normalizados. Duas linhas com a mesma chave são o
 * mesmo tipo de filamento, escritas diferente. Mora aqui, e não no módulo de
 * servidor, porque a validação do catálogo também precisa dela — e duas
 * implementações da mesma chave é como um `PLA Silk+` acaba pendurado no
 * `PLA Silk`.
 */
export function chaveFilamento(f: { marca: string; material: string; cor: string }): string {
	return [normalizar(f.marca), normalizar(f.material), normalizar(f.cor)].join('|');
}

/** Rótulo de uma linha de resultado. */
export function rotuloDoItem(i: ItemCatalogo): string {
	return [i.marca, i.material, i.cor].filter(Boolean).join(' · ');
}
