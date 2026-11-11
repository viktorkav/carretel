<script lang="ts">
	import Icone from './Icone.svelte';
	import RenderPeca from './RenderPeca.svelte';

	/**
	 * A peça, pequena: a capa do registro na cor do filamento, ou — quando o
	 * registro não guarda imagem — o bloco tracejado que diz exatamente isso.
	 * Decorativa: o nome da peça vai em texto ao lado.
	 */
	let {
		id,
		temImagem,
		cor = null,
		class: classe = ''
	}: { id: number; temImagem: boolean; cor?: string | null; class?: string } = $props();
</script>

{#if temImagem}
	<RenderPeca class="peca-mini {classe}" src="/impressoes/{id}/imagem" alt="" {cor} compacta />
{:else}
	<span class="peca-mini peca-mini--vazia {classe}" aria-hidden="true">
		<Icone nome="sem-imagem" tamanho={22} />
	</span>
{/if}
