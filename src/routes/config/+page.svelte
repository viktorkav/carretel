<script lang="ts">
	import { enhance } from '$app/forms';
	import { manterCampos } from '$lib/edicao';
	import Entrada from '$lib/componentes/Entrada.svelte';
	import Estado from '$lib/componentes/Estado.svelte';
	import Icone from '$lib/componentes/Icone.svelte';
	import { centavosParaTexto } from '$lib/dinheiro';
	import { dataHora, frase } from '$lib/formato';

	let { data, form } = $props();
</script>

<header class="topo">
	<h1>Configurações</h1>
</header>

<!--
	A ordem importa: `baixarCatalogo` e `salvarToken` devolvem `sucesso` JUNTO do
	aviso específico, então os avisos são lidos ANTES do `sucesso` genérico —
	senão baixar o catálogo ou mexer no token escreveria só "salvo".
-->
{#if form?.erroCatalogo}
	<p class="retorno retorno--falha" role="alert"><Icone nome="falha" />{frase(form.erroCatalogo)}</p>
{:else if form?.avisoCatalogo}
	<p class="retorno" role="status"><Icone nome="sucesso" />{frase(form.avisoCatalogo)}</p>
{:else if form?.avisoToken}
	<p class="retorno" role="status"><Icone nome="sucesso" />{frase(form.avisoToken)}</p>
{:else if form?.avisoTarifa}
	<p class="retorno retorno--atencao" role="status"><Icone nome="alerta" />{frase(form.avisoTarifa)}</p>
{:else if form?.sucesso}
	<p class="retorno" role="status"><Icone nome="sucesso" />Configurações salvas.</p>
{/if}

<div class="ajustes">
	<section class="folha" aria-labelledby="titulo-custo">
		<header class="faixa">
			<h2 id="titulo-custo"><Icone nome="energia" />Custo</h2>
		</header>
		<!-- `manterCampos`: sem reiniciar o formulário, a tarifa e a caixa continuam mostrando o que ficou salvo. -->
		<form class="crt-corpo" method="POST" action="?/salvar" use:enhance={manterCampos}>
			<div class="crt-grade" style="--crt-min: 240px; --crt-max: 320px">
				<Entrada
					rotulo="tarifa de energia (R$/kWh)"
					nome="tarifa"
					inputmode="decimal"
					value={centavosParaTexto(data.config.tarifaKwhCents)}
					dica="Em branco mantém o valor atual."
				/>
			</div>
			<label class="crt-opcao">
				<input type="checkbox" name="rateioFalhas" checked={data.config.rateioFalhas} />
				<span>
					Ratear o desperdício das falhas no total do período
					<small class="crt-dica">
						O custo das falhas é distribuído entre as finalidades que deram certo. O custo de cada
						peça não muda.
					</small>
				</span>
			</label>
			<div class="crt-acoes">
				<button class="acao acao--sinal" type="submit">Salvar custo</button>
			</div>
		</form>
	</section>

	<section class="folha" aria-labelledby="titulo-catalogo">
		<header class="faixa">
			<h2 id="titulo-catalogo"><Icone nome="filamentos" />Catálogo de filamentos</h2>
			{#if data.catalogo.estado === 'ok'}
				<Estado
					estado="ok"
					nome="{data.biblioteca.itens} {data.biblioteca.itens === 1 ? 'opção' : 'opções'} de {data
						.biblioteca.marcas} {data.biblioteca.marcas === 1 ? 'marca' : 'marcas'}"
				/>
			{:else if data.catalogo.estado === 'ausente'}
				<Estado estado="atencao" nome="ainda não baixado" />
			{:else}
				<Estado estado="falha" nome="baixado, mas reprovado na conferência" />
			{/if}
		</header>
		{#if data.catalogo.estado === 'ok'}
			<details class="detalhes-rolo">
				<summary>Fontes do catálogo</summary>
				<p class="nota">
					Catálogo base Bambu com {data.catalogo.itens} referências, atualizado em {data.catalogo
						.geradoEm} (commit {data.catalogo.commit.slice(0, 12)}). Derivado de {data.catalogo.fonte},
					sob licença {data.catalogo.licenca}. O arquivo fica em {data.catalogo.caminho}.
				</p>
			</details>
		{:else if data.catalogo.estado === 'ausente'}
			<p class="nota">
				O cadastro de filamento pela embalagem funciona sem ele. O arquivo iria para {data.catalogo
					.caminho}.
			</p>
		{:else}
			<p class="nota">{data.catalogo.erro}</p>
		{/if}
		<form class="crt-acoes" method="POST" action="?/baixarCatalogo" use:enhance>
			<button class="acao" type="submit">
				<Icone nome="importar" tamanho={18} />{data.catalogo.estado === 'ok'
					? 'Atualizar catálogo'
					: 'Baixar catálogo'}
			</button>
			<span class="crt-dica">Busca opções e imagens novas na internet.</span>
		</form>
	</section>

	<section class="folha" aria-labelledby="titulo-nuvem">
		<header class="faixa">
			<h2 id="titulo-nuvem"><Icone nome="nuvem" />Nuvem da Bambu</h2>
			{#if data.temTokenNuvem}
				<Estado estado="ok" nome="token guardado" />
			{:else}
				<Estado estado="atencao" nome="sem token" />
			{/if}
		</header>
		{#if data.temTokenNuvem}
			<p class="nota">
				{data.ultimaImportacaoEm
					? `Última importação em ${dataHora(data.ultimaImportacaoEm)}.`
					: 'Nenhuma importação ainda.'}
				<a class="crt-link" href="/importar">Importar histórico</a>
			</p>
		{:else}
			<p class="nota">Sem o token não há importação da nuvem; o registro manual cobre tudo.</p>
		{/if}
		<form class="crt-corpo" method="POST" action="?/salvarToken" use:enhance>
			<div class="crt-grade" style="--crt-min: 240px; --crt-max: 380px">
				<Entrada
					rotulo="token da Cloud API"
					nome="tokenNuvem"
					type="password"
					autocomplete="off"
					placeholder="Cole o token aqui"
					dica="Vale cerca de um ano. Depois de salvo, não é mais exibido."
				/>
			</div>
			{#if data.temTokenNuvem}
				<label class="crt-opcao">
					<input type="checkbox" name="remover" />
					<span>Remover o token guardado</span>
				</label>
			{/if}
			<div class="crt-acoes">
				<button class="acao" type="submit">Salvar token</button>
			</div>
		</form>
	</section>
</div>
