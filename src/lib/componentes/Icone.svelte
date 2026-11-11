<script lang="ts">
	import { ICONES, type NomeIcone } from '$lib/icones';

	/**
	 * Um ícone da família (ver `$lib/icones`).
	 *
	 * Sem `rotulo` o ícone é decoração de um texto que já diz a mesma coisa, e
	 * some para o leitor de tela. Com `rotulo` ele É o texto: vira imagem com
	 * nome acessível. Não existe o caso do meio (ícone sozinho, sem nome).
	 */
	let {
		nome,
		tamanho = 20,
		rotulo,
		class: classe = ''
	}: { nome: NomeIcone; tamanho?: number; rotulo?: string; class?: string } = $props();
</script>

<svg
	class="icone {classe}"
	width={tamanho}
	height={tamanho}
	viewBox="0 0 24 24"
	role={rotulo ? 'img' : undefined}
	aria-label={rotulo}
	aria-hidden={rotulo ? undefined : 'true'}
	focusable="false"
>
	<!-- eslint-disable-next-line svelte/no-at-html-tags — texto fixo do próprio pacote -->
	{@html ICONES[nome]}
</svg>
