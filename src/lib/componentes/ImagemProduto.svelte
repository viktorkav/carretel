<script lang="ts">
	import { untrack } from 'svelte';
	import FiguraRolo from './FiguraRolo.svelte';

	/**
	 * A imagem de catálogo de um filamento.
	 *
	 * `src` pode ser a foto `https://` publicada pela fabricante ou um arquivo
	 * guardado na instalação (`/midia/catalogo/...`, ver
	 * `$lib/catalogo/imagem-local`). Quando não há imagem, ou quando ela não
	 * abre (sem internet, arquivo apagado), entra o rolo desenhado na cor do
	 * cadastro — e a legenda diz que aquilo é ilustração, para ninguém tomar o
	 * desenho por foto do produto.
	 */
	let { src, nome, cor = null }: { src?: string; nome: string; cor?: string | null } = $props();
	let falhou = $state(false);
	let carregada = $state(false);
	let imagem = $state<HTMLImageElement>();
	$effect(() => {
		src;
		falhou = false;
		carregada = untrack(() => Boolean(imagem?.complete && imagem.naturalWidth > 0));
	});
	const semFoto = $derived(!src || falhou);
</script>

<div class="produto-foto" class:produto-foto--figura={semFoto}>
	{#if src && !falhou}
		<img
			bind:this={imagem}
			{src}
			alt={nome}
			loading="lazy"
			class:carregada
			referrerpolicy="no-referrer"
			onload={() => (carregada = true)}
			onerror={() => (falhou = true)}
		/>
	{/if}
	{#if semFoto || !carregada}
		<FiguraRolo {cor} fracao={1} />
	{/if}
	{#if semFoto}<small>{cor ? 'Ilustração na cor cadastrada' : 'Sem foto'}</small>{/if}
</div>
