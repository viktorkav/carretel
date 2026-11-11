<script lang="ts">
 // Mantém o contrato das rotas; o resumo é apresentado sem simular um terminal.
 let { saida }: { comando: string; saida: string } = $props();
</script>
<p class="resumo-pagina">{saida}</p>
