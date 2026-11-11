<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { ErroDeCampo } from '$lib/erro-campo';
	import { frase } from '$lib/formato';

	/**
	 * Rótulo + `<select>`.
	 *
	 * O `<select>` também não leva classe: a Mesa já o desenha, inclusive a
	 * seta (SVG em data-URI, `appearance: none`). ⛔ Não se desenha um dropdown
	 * próprio.
	 *
	 * `vazio` é o estado vazio do próprio campo: quando não há o que escolher,
	 * o lugar diz o que falta em vez de mostrar uma caixa sem opção — que é o
	 * caminho para o usuário submeter um formulário que nunca ia poder salvar.
	 */
	interface Props {
		rotulo: string;
		nome: string;
		dica?: string;
		vazio?: Snippet;
		temOpcoes?: boolean;
		/**
		 * O campo pede mais largura do que a média da grade, porque os RÓTULOS
		 * das opções são longos (o filamento, que escreve código, marca,
		 * material e cor numa linha só). Sem isto o `<select>` herda a coluna
		 * média e o texto da opção escolhida perde o fim. Desenho em
		 * `.crt-campo--largo`, em app.css.
		 */
		largo?: boolean;
		/** Ver `Entrada.svelte`: o erro da action amarrado ao campo que o causou. */
		erro?: ErroDeCampo;
		children: Snippet;
		[chave: string]: unknown;
	}

	let {
		rotulo,
		nome,
		dica,
		vazio,
		temOpcoes = true,
		largo = false,
		erro,
		children,
		...resto
	}: Props = $props();

	const id = $props.id();
	const idDica = `${id}-dica`;
	const idErro = `${id}-erro`;

	const invalido = $derived(erro != null && erro.campo === nome);
	const descrito = $derived(
		[invalido ? idErro : null, dica ? idDica : null].filter(Boolean).join(' ') || undefined
	);
</script>

<div class="crt-campo {largo ? 'crt-campo--largo' : ''}">
	<label class="rotulo" for={id}>{rotulo}</label>
	{#if temOpcoes}
		<select
			{id}
			name={nome}
			aria-describedby={descrito}
			aria-invalid={invalido ? 'true' : undefined}
			{...resto}
		>
			{@render children()}
		</select>
		{#if invalido}
			<span class="crt-erro" id={idErro}>{frase(erro?.mensagem ?? '')}</span>
		{/if}
		{#if dica}
			<span class="crt-dica" id={idDica}>{dica}</span>
		{/if}
	{:else if vazio}
		{@render vazio()}
	{/if}
</div>
