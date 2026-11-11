<script lang="ts">
	import { enhance } from '$app/forms';
	import type { SubmitFunction } from '@sveltejs/kit';
	import Icone from './Icone.svelte';
	import { ICONE_DO_ALERTA } from '$lib/icones';
	import { gramasDeSaldo, pesoCurto } from '$lib/figura-rolo';

	/**
	 * Um aviso do rolo, no rolo.
	 *
	 * O aviso não é uma lista à parte da tela: é uma marca presa ao próprio
	 * rolo, que diz o que é ("Acabando", "Pode estar úmido") e, ao ser tocada,
	 * abre o porquê e a ação que resolve — pesar, registrar a secagem. Risco de
	 * umidade continua escrito como risco: o sistema sabe há quantos dias o rolo
	 * está aberto, não a umidade dele.
	 *
	 * O balão é um `popover` nativo: abre e fecha sem script, fecha com Esc e
	 * com toque fora. O script só o encosta no botão que o abriu.
	 */
	type Rolo = {
		id: number;
		codigo: string;
		restanteG: number;
		pesoLiquidoInicialG: number;
		diasSemSecar?: number | null;
		secagemRegistrada?: boolean;
	};
	let {
		rolo,
		tipo,
		aoResolver
	}: {
		rolo: Rolo;
		tipo: string;
		/** Chamado quando uma ação do balão dá certo, com a frase do que aconteceu. */
		aoResolver?: (mensagem: string) => void;
	} = $props();

	const id = $props.id();
	const NOME: Record<string, string> = { acabando: 'Acabando', umidade: 'Pode estar úmido' };
	const nome = $derived(NOME[tipo] ?? tipo);
	const icone = $derived(ICONE_DO_ALERTA[tipo] ?? 'alerta');

	let gatilho = $state<HTMLButtonElement>();
	let balao = $state<HTMLElement>();
	let enviando = $state(false);

	function encostar(evento: ToggleEvent) {
		if (evento.newState !== 'open' || !balao || !gatilho) return;
		// No celular o balão vira folha no pé da tela (CSS); não há o que encostar.
		if (window.innerWidth < 560) {
			balao.dataset.ancora = 'pe';
			return;
		}
		const g = gatilho.getBoundingClientRect();
		const largura = balao.offsetWidth;
		const altura = balao.offsetHeight;
		const x = Math.min(Math.max(12, g.left), window.innerWidth - largura - 12);
		const cabeEmbaixo = g.bottom + 8 + altura <= window.innerHeight - 12;
		const y = cabeEmbaixo ? g.bottom + 8 : Math.max(12, g.top - altura - 8);
		balao.style.left = `${x}px`;
		balao.style.top = `${y}px`;
		balao.dataset.ancora = 'botao';
	}
	function fechar() {
		if (balao?.matches(':popover-open')) balao.hidePopover();
	}

	const secar: SubmitFunction = () => {
		enviando = true;
		return async ({ result, update }) => {
			try {
				await update({ reset: false });
				if (result.type === 'success') {
					fechar();
					aoResolver?.(`Secagem de ${rolo.codigo} registrada.`);
				}
			} finally {
				enviando = false;
			}
		};
	};
</script>

<!-- O balão é fixo na janela; se a página rola, ele não acompanha o botão: fecha. -->
<svelte:window onscroll={fechar} onresize={fechar} />

<button
	type="button"
	class="aviso aviso--{tipo}"
	popovertarget={id}
	bind:this={gatilho}
	aria-label="{nome}: {rolo.codigo}. Ver o que fazer"
>
	<Icone nome={icone} tamanho={16} />{nome}
</button>

<div {id} popover class="balao" bind:this={balao} ontoggle={encostar}>
	<p class="balao__titulo aviso-texto aviso-texto--{tipo}"><Icone nome={icone} tamanho={20} />{nome}</p>
	{#if tipo === 'acabando'}
		<p>
			Restam {gramasDeSaldo(rolo.restanteG)} g{#if rolo.pesoLiquidoInicialG > 0}{' '}de {pesoCurto(
					rolo.pesoLiquidoInicialG
				)}{/if} em <span class="etiqueta">{rolo.codigo}</span>.
		</p>
		<div class="balao__acoes">
			<a class="acao acao--sinal acao--miuda" href="/rolos?detalhes={rolo.id}#pesar">
				<Icone nome="pesar" tamanho={16} />Pesar o rolo
			</a>
			<a class="acao acao--miuda" href="/rolos?detalhes={rolo.id}#detalhe-rolo">Abrir o rolo</a>
		</div>
	{:else if tipo === 'umidade'}
		<p>
			{#if rolo.diasSemSecar == null}
				<span class="etiqueta">{rolo.codigo}</span> está aberto há tempo demais sem secagem.
			{:else if rolo.secagemRegistrada}
				A última secagem de <span class="etiqueta">{rolo.codigo}</span> foi há {rolo.diasSemSecar} dias.
			{:else}
				<span class="etiqueta">{rolo.codigo}</span> está aberto há {rolo.diasSemSecar} dias, sem secagem
				registrada.
			{/if}
			Seque antes de usar.
		</p>
		<div class="balao__acoes">
			<form method="POST" action="/rolos?/secar" use:enhance={secar} data-envio-local>
				<input type="hidden" name="id" value={rolo.id} />
				<button class="acao acao--sinal acao--miuda" type="submit" disabled={enviando}>
					<Icone nome="secar" tamanho={16} />{enviando ? 'Registrando…' : 'Registrar secagem'}
				</button>
			</form>
			<a class="acao acao--miuda" href="/rolos?detalhes={rolo.id}#detalhe-rolo">Abrir o rolo</a>
		</div>
	{/if}
</div>
