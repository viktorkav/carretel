<script lang="ts">
	import type { Snippet } from 'svelte';
	import AvisoRolo from './AvisoRolo.svelte';
	import FiguraRolo from './FiguraRolo.svelte';
	import Icone from './Icone.svelte';
	import { gramasDeSaldo, pesoCurto } from '$lib/figura-rolo';
	import { fracaoNaRegua } from '$lib/regua';

	/**
	 * Um rolo na prateleira: o objeto, o que ele é, quanto tem e o que pede.
	 *
	 * A ordem de leitura é a de quem olha a prateleira de verdade: primeiro o
	 * rolo e a cor, depois o material e o saldo, e por último o que está escrito
	 * nele (o código). Os avisos ficam presos a ele, cada um com a sua ação.
	 */
	type Rolo = {
		id: number;
		codigo: string;
		material: string;
		cor: string;
		corHex: string | null;
		status: string;
		pesoLiquidoInicialG: number;
		restanteG: number;
		alertas: string[];
		posicao?: number | null;
		diasSemSecar?: number | null;
		secagemRegistrada?: boolean;
	};
	let {
		rolo,
		regua,
		href,
		atual = false,
		aoResolver,
		children
	}: {
		rolo: Rolo;
		/** A régua da tela: ver `$lib/regua`. */
		regua: number;
		href: string;
		/** Este é o rolo aberto no detalhe ao lado. */
		atual?: boolean;
		aoResolver?: (mensagem: string) => void;
		/** Ação extra presa ao rolo (por exemplo, "Carregar aqui"). */
		children?: Snippet;
	} = $props();
</script>

<article class="rolo-item" class:rolo-item--atual={atual}>
	<a class="rolo-item__abrir" {href} aria-current={atual ? 'true' : undefined}>
		<FiguraRolo cor={rolo.corHex} fracao={fracaoNaRegua(rolo.restanteG, regua)} />
		<span class="rolo-item__nome"><b>{rolo.material}</b> {rolo.cor}</span>
		<span class="rolo-item__saldo">
			<strong class="num">{gramasDeSaldo(rolo.restanteG)}</strong><span class="num">g</span>
			{#if rolo.pesoLiquidoInicialG > 0}<small>de {pesoCurto(rolo.pesoLiquidoInicialG)}</small>{/if}
		</span>
	</a>
	<div class="rolo-item__marcas">
		<span class="etiqueta">{rolo.codigo}</span>
		{#if rolo.posicao}
			<span class="chip chip--plastico" title="Carregado na impressora, posição {rolo.posicao}">
				<Icone nome="impressoras" tamanho={14} />Posição {rolo.posicao}
			</span>
		{/if}
		{#if rolo.status === 'fechado'}
			<span class="chip"><Icone nome="lacrado" tamanho={14} />Lacrado</span>
		{/if}
		{#each rolo.alertas as tipo (tipo)}
			<AvisoRolo {rolo} {tipo} {aoResolver} />
		{/each}
	</div>
	{@render children?.()}
</article>
