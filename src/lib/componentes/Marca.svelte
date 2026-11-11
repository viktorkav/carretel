<script lang="ts">
	/**
	 * A marca: um C de filamento em volta do furo do carretel.
	 * É o carretel visto de frente e é a inicial do nome.
	 */
	let { tamanho = 30 }: { tamanho?: number } = $props();
</script>

<svg width={tamanho} height={tamanho} viewBox="0 0 32 32" aria-hidden="true" focusable="false">
	<path
		d="M24.67 9.23A11 11 0 1 0 24.67 22.77"
		fill="none"
		stroke="currentColor"
		stroke-width="5.2"
		stroke-linecap="round"
	/>
	<circle cx="16" cy="16" r="3.1" fill="currentColor" />
</svg>
