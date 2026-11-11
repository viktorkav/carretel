<script lang="ts">
	import Icone from './Icone.svelte';

	/**
	 * O filamento citado dentro de uma linha: o carretelzinho com o enrolamento
	 * na cor do dado, o material e a cor por extenso. Substitui a bolinha de cor,
	 * que sozinha não dizia que aquilo era um rolo.
	 */
	let {
		material,
		cor,
		corHex,
		codigo
	}: { material: string; cor: string; corHex: string | null; codigo?: string } = $props();
</script>

<span class="fio-chip" style:--icone-material={corHex ?? 'var(--fio-sem-cor)'}>
	<Icone nome="filamentos" tamanho={18} /><span><b>{material}</b> {cor}</span>
	{#if codigo}<span class="etiqueta">{codigo}</span>{/if}
</span>
