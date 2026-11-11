<script lang="ts">
	/**
	 * Rótulo + campo de entrada.
	 *
	 * O `<input>` NÃO leva classe: a Mesa estiliza `input`, `select` e
	 * `textarea` por seletor de elemento — campo de terminal, fundo `--campo`,
	 * voz de máquina, aresta de foco em matéria. Nada a compor aqui.
	 *
	 * O que sobra é o que se erra à mão em todo formulário: o `for`/`id` que
	 * amarra o rótulo ao campo, e a dica. A dica fica ABAIXO do campo, no
	 * padrão `.conexoes-hint` do admin do stream-tools, em vez de virar
	 * `placeholder` — assim ela não some quando se digita nem é confundida com
	 * valor preenchido.
	 */
	import type { ErroDeCampo } from '$lib/erro-campo';
	import { frase } from '$lib/formato';

	interface Props {
		rotulo: string;
		nome: string;
		dica?: string;
		type?: string;
		/**
		 * O erro que a action devolveu, se houver. Quando ele aponta para ESTE
		 * campo, o `<input>` recebe `aria-invalid` (que a Mesa já estiliza, com o
		 * anel em `--falha`, e que o Carretel não usava em lugar nenhum) e a
		 * mensagem é repetida logo abaixo dele.
		 *
		 * Repetir a mensagem aqui não é redundância: a versão do topo do
		 * formulário podia estar a 1.400 px do campo que a causou, e no celular
		 * ela simplesmente não estava na tela.
		 */
		erro?: ErroDeCampo;
		[chave: string]: unknown;
	}

	/**
	 * ── A regra dos campos numéricos deste projeto ──────────────────────────
	 *
	 * **Decimal → `type="text"` + `inputmode="decimal"`.
	 * Inteiro → `type="number"` + `inputmode="numeric"`.**
	 *
	 * O motivo só apareceu na integração das quatro frentes: os helpers de
	 * formulário passaram a aceitar VÍRGULA decimal (o sistema é em pt-BR, e
	 * quem digita a densidade de um PETG escreve `1,27`), e
	 * `<input type="number">` **recusa a vírgula na digitação** — o caractere
	 * nem entra no campo, e o que ele aceita varia com o idioma do sistema.
	 * Servidor aceitando e navegador não deixando digitar é um campo que só
	 * funciona por sorte.
	 *
	 * O precedente já estava no repositório: `preço` sempre foi texto com
	 * `inputmode="decimal"`, e era o único campo que entendia vírgula. Aqui ele
	 * vira a regra dos decimais: gramas, camada, densidade, pesos e a sobra
	 * final.
	 *
	 * **O teclado do celular continua numérico** — quem decide o teclado é
	 * `inputmode`, não `type`. `decimal` traz o separador; `numeric` traz só os
	 * dígitos, que é o certo para paredes, infill, temperatura, horas de vida
	 * útil e watts: meia parede e meio grau não existem, e ali `type="number"`
	 * ainda paga por si (setinhas e recusa de inteiro no próprio navegador).
	 *
	 * `step`, `min` e `max` saíram dos campos que viraram texto: em
	 * `type="text"` eles não fazem nada, e marcação morta mente sobre onde a
	 * validação mora. Ela mora no servidor — `resolverPesagem`,
	 * `validarSobraFinal`, `campoNumerico*` —, que é onde ela já era feita de
	 * verdade, e é o que continua valendo sem JavaScript.
	 *
	 * A Mesa estiliza `input[type="text"]` e `input[type="number"]` no MESMO
	 * seletor, então a troca não muda um pixel.
	 *
	 * `type` tem padrão EXPLÍCITO, e isso não é zelo: a Mesa estiliza campo por
	 * `input[type="text"]`, e seletor de atributo não casa com atributo
	 * ausente. Um `<input>` sem `type` chega cru do user-agent no meio de um
	 * formulário de terminal — o navegador assume texto, a folha não.
	 */
	let { rotulo, nome, dica, type = 'text', erro, ...resto }: Props = $props();

	const id = $props.id();
	const idDica = `${id}-dica`;
	const idErro = `${id}-erro`;

	const invalido = $derived(erro != null && erro.campo === nome);
	// A dica continua sendo anunciada junto do erro: uma diz o que o campo
	// espera, a outra diz o que deu errado, e as duas cabem no mesmo campo.
	const descrito = $derived(
		[invalido ? idErro : null, dica ? idDica : null].filter(Boolean).join(' ') || undefined
	);
</script>

<div class="crt-campo">
	<label class="rotulo" for={id}>{rotulo}</label>
	<input
		{id}
		{type}
		name={nome}
		aria-describedby={descrito}
		aria-invalid={invalido ? 'true' : undefined}
		{...resto}
	/>
	{#if invalido}
		<span class="crt-erro" id={idErro}>{frase(erro?.mensagem ?? '')}</span>
	{/if}
	{#if dica}
		<span class="crt-dica" id={idDica}>{dica}</span>
	{/if}
</div>
