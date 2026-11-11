<script lang="ts">
	import NovaImpressao from '$lib/componentes/NovaImpressao.svelte';
	let { data, form } = $props();
</script>

<svelte:head><title>Registrar impressão · Carretel</title></svelte:head>
<header class="topo topo--registro"><h1>Registrar impressão</h1></header>
<NovaImpressao {data} {form} />
