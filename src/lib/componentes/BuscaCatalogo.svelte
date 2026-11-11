<script lang="ts">
	import Estado from '$lib/componentes/Estado.svelte';
	import { rotuloDoItem, type ItemCatalogo } from '$lib/catalogo/busca';

	/**
	 * Busca no catálogo da Bambu — a peça que /filamentos e /rolos dividem.
	 *
	 * Veio da frente `catalogo` com marcação crua e classes sem folha
	 * (`.catalogo-busca`, `.catalogo-resultados`). Aqui ela passou a falar a
	 * Mesa: o campo é o `<input>` estilizado por elemento, a indisponibilidade
	 * é `marca` de estado (ponto + palavra escrita) em vez de parágrafo
	 * colorido, e a lista de resultados é a `.crt-lista` — nome genérico,
	 * porque a peça não é da tela de filamento nem da de rolo.
	 *
	 * A amostra de cor continua sendo artefato do mundo: é a cor física do
	 * rolo, presa a um ponto de 8px, SEMPRE com o nome escrito ao lado.
	 */

	type EstadoCatalogo =
		| { estado: 'ok' }
		| { estado: 'ausente' }
		| { estado: 'invalido'; erro: string };

	let {
		q,
		resultados,
		total,
		truncado,
		catalogo,
		selecionadoId = null
	}: {
		q: string;
		resultados: ItemCatalogo[];
		total: number;
		truncado: boolean;
		catalogo: EstadoCatalogo;
		selecionadoId?: string | null;
	} = $props();

	// Busca é GET de propósito: o resultado fica na URL, funciona sem
	// JavaScript e o botão de voltar do navegador desfaz a seleção.
	const link = (id: string) => `?q=${encodeURIComponent(q)}&item=${encodeURIComponent(id)}`;
</script>

{#if catalogo.estado === 'ausente'}
	<div class="crt-marcas">
		<Estado estado="atencao" nome="catálogo ainda não baixado" />
	</div>
	<p class="crt-dica">
		Ele é buscado dos perfis do Bambu Studio e guardado junto do banco. Dá pra baixar agora em
		<a class="crt-link" href="/config">Configuração</a>. Até lá, o cadastro manual continua
		funcionando.
	</p>
{:else if catalogo.estado === 'invalido'}
	<div class="crt-marcas">
		<Estado estado="falha" nome="catálogo reprovado na conferência" />
	</div>
	<p class="crt-dica">
		{catalogo.erro}. Baixe de novo em <a class="crt-link" href="/config">Configuração</a>. O
		cadastro manual continua funcionando.
	</p>
{:else}
	<form class="crt-acoes" method="GET">
		<div class="crt-campo" style="flex: 1 1 260px">
			<label class="rotulo" for="busca-catalogo">buscar no catálogo</label>
			<input
				id="busca-catalogo"
				type="search"
				name="q"
				value={q}
				placeholder="pla matte azul · petg generic · GFG99"
				autocomplete="off"
				aria-describedby="busca-catalogo-dica"
			/>
			<span class="crt-dica" id="busca-catalogo-dica">
				marca, material, cor ou o código da Bambu
			</span>
		</div>
		<button class="acao acao--traco" type="submit">Buscar</button>
	</form>

	{#if q && total === 0}
		<p class="crt-vazio">
			Nada no catálogo para "{q}". Dá pra cadastrar na mão no formulário abaixo.
		</p>
	{/if}

	{#if resultados.length > 0}
		{#if truncado}
			<!-- Sem este aviso, "pla" mostra 20 de 217 e o usuário conclui que o
			     rolo dele não está no catálogo. -->
			<p class="crt-dica">
				Mostrando {resultados.length} de {total}. Acrescente a cor ou o material para afunilar.
			</p>
		{:else}
			<p class="crt-dica">{total} {total === 1 ? 'resultado' : 'resultados'}.</p>
		{/if}

		<ul class="crt-lista">
			{#each resultados as i (i.id)}
				<li>
					<a
						class="crt-lista-item"
						href={link(i.id)}
						aria-current={i.id === selecionadoId ? 'true' : undefined}
					>
						{#if i.corHex}
							<i class="crt-amostra" style="background-color: {i.corHex}"></i>
						{/if}
						<span>{rotuloDoItem(i)}</span>
						{#if i.cor === null}
							<span class="crt-dica">cor a definir</span>
						{/if}
						<span class="crt-capsula">{i.codigoBambu}</span>
					</a>
				</li>
			{/each}
		</ul>
	{/if}
{/if}
