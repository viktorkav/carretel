<script lang="ts">
	import CadastroFilamento from '$lib/componentes/CadastroFilamento.svelte';
	import Icone from '$lib/componentes/Icone.svelte';
	let { data, form } = $props();
</script>

<svelte:head><title>Cadastrar filamento · Carretel</title></svelte:head>
<header class="topo topo--peca">
	<a class="voltar" href="/rolos"><Icone nome="voltar" tamanho={16} />Filamentos</a>
	<h1>Cadastrar filamento</h1>
</header>
<CadastroFilamento itens={data.itens} envio={data.envio} selecionado={data.selecionado} {form} />
