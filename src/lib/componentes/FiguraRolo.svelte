<script lang="ts">
	import { nivelDoRolo } from '$lib/figura-rolo';

	/**
	 * O rolo como objeto: um render de produto com o enrolamento na COR DO DADO.
	 *
	 * São duas camadas por nível (`static/midia/rolo`): o `corpo`, que é o
	 * carretel preto e neutro, e o `fio`, um mapa de luz em cinza cujo alfa diz
	 * onde há filamento. A cor não está em arquivo nenhum: é o `corHex` do rolo,
	 * pintado por baixo do mapa e misturado em `hard-light` — cinza médio devolve
	 * a cor exata, sombra escurece, brilho clareia. Por isso um branco continua
	 * branco, um preto continua tendo relevo, e nenhuma cor é "parecida".
	 *
	 * É ilustração do rolo cadastrado, não foto do fabricante. A foto de
	 * catálogo, quando existe, é outra coisa e aparece à parte.
	 *
	 * Decorativa: quem usa escreve material, cor e saldo em texto ao lado.
	 *
	 * As imagens NÃO levam `decoding="async"`: com ele o navegador pode pintar o
	 * quadro antes de decodificar as camadas, e o que aparece por um instante é
	 * só a máscara cheia de cor, uma silhueta chapada no lugar do rolo.
	 */
	let {
		cor,
		fracao,
		class: classe = ''
	}: {
		/** `corHex` do cadastro; `null` desenha fio em cinza cru. */
		cor: string | null | undefined;
		/** Massa restante sobre a régua da tela (0 a 1). Ver `$lib/regua`. */
		fracao: number | null | undefined;
		class?: string;
	} = $props();

	const nivel = $derived(nivelDoRolo(fracao));
	const valida = $derived(!!cor && /^#[0-9a-f]{6}$/i.test(cor));
</script>

<span
	class="rolo-fig {classe}"
	class:rolo-fig--sem-cor={!valida}
	style:--cor={valida ? cor : undefined}
	data-nivel={nivel}
	aria-hidden="true"
>
	<img
		class="rolo-fig__corpo"
		src="/midia/rolo/n{nivel}-corpo.webp"
		alt=""
		width="512"
		height="512"
	/>
	{#if nivel < 8}
		<span class="rolo-fig__fio" style:--mapa="url(/midia/rolo/n{nivel}-fio.webp)">
			<img src="/midia/rolo/n{nivel}-fio.webp" alt="" width="512" height="512" />
		</span>
	{/if}
</span>
