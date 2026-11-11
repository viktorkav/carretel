<script lang="ts">
	import { normalizar } from '$lib/catalogo/busca';
	import { gramasDeSaldo, pesoCurto } from '$lib/figura-rolo';
	import { fracaoNaRegua, reguaCompartilhada } from '$lib/regua';
	import FiguraRolo from './FiguraRolo.svelte';
	import Icone from './Icone.svelte';

	let {
		rolos,
		selecionado = $bindable(''),
		erro
	}: {
		rolos: {
			ativoPosicao?: number;
			id: number;
			codigo: string;
			marca: string;
			material: string;
			cor: string;
			corHex: string | null;
			restanteG: number;
			pesoLiquidoInicialG: number;
		}[];
		selecionado?: string;
		erro?: string;
	} = $props();

	let busca = $state('');
	// A busca só aparece quando há rolo demais para achar com os olhos.
	const comBusca = $derived(rolos.length > 6);
	const regua = $derived(reguaCompartilhada(rolos));
	const encontrados = $derived(
		rolos.filter(
			(r) =>
				String(r.id) === selecionado ||
				normalizar([r.codigo, r.marca, r.material, r.cor].join(' ')).includes(normalizar(busca))
		)
	);
</script>

<!--
	Rádios de verdade, vestidos de rolo: Tab entra no grupo, as setas andam
	entre os rolos e o espaço escolhe, tudo do navegador, sem script. Cada opção
	é o objeto (na cor e no nível do cadastro), o que está escrito no carretel e
	o saldo com o denominador. O rolo que está na impressora leva a posição.
-->
<fieldset class="filamento-escolha">
	<legend>Qual filamento você usou?</legend>
	{#if comBusca}
		<label class="busca">
			<span class="so-leitor">Buscar nos meus filamentos</span>
			<input type="search" bind:value={busca} placeholder="Cor, tipo, marca ou código" />
		</label>
	{/if}
	{#if erro}<p class="cadastro-erro" role="alert" data-recusa="roloId">{erro}</p>{/if}
	{#if encontrados.length}
		<div class="filamento-opcoes">
			{#each encontrados as r (r.id)}
				<label class="filamento-opcao" class:selecionada={selecionado === String(r.id)}>
					<input type="radio" name="roloId" value={String(r.id)} bind:group={selecionado} required />
					<FiguraRolo cor={r.corHex} fracao={fracaoNaRegua(r.restanteG, regua)} />
					<span class="filamento-opcao__nome"><b>{r.material}</b> {r.cor}</span>
					<span class="filamento-opcao__saldo">
						<strong class="num">{gramasDeSaldo(r.restanteG)}</strong> g{#if r.pesoLiquidoInicialG > 0}<small
								>de {pesoCurto(r.pesoLiquidoInicialG)}</small
							>{/if}
					</span>
					<span class="filamento-opcao__marcas">
						<span class="etiqueta">{r.codigo}</span>
						{#if r.ativoPosicao}
							<span class="chip chip--plastico"><Icone nome="impressoras" tamanho={14} />Posição {r.ativoPosicao}</span>
						{/if}
					</span>
					<span class="filamento-opcao__marca" aria-hidden="true"><Icone nome="check" tamanho={16} /></span>
				</label>
			{/each}
		</div>
	{/if}
	{#if !rolos.length}
		<p class="vazio-estado"><Icone nome="filamentos" tamanho={36} />Nenhum filamento em estoque ainda.</p>
	{:else if !encontrados.length}
		<p class="nota">Nenhum filamento com essa busca.</p>
	{/if}
</fieldset>
