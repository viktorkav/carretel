<script lang="ts">
	import { tick } from 'svelte';
	import Icone from '$lib/componentes/Icone.svelte';
	import MiniaturaPeca from '$lib/componentes/MiniaturaPeca.svelte';
	import RoloNaPrateleira from '$lib/componentes/RoloNaPrateleira.svelte';
	import { pesoCurto } from '$lib/figura-rolo';
	import { FINALIDADE, dataCurta, inicial, massa, numero, reais } from '$lib/formato';
	import { ICONE_DA_FINALIDADE, ICONE_DO_STATUS } from '$lib/icones';
	import { reguaCompartilhada } from '$lib/regua';

	let { data } = $props();
	// $derived, não `const`: navegar entre /?dias=2, /?dias=7 etc. troca o
	// `data` do mesmo componente sem remontá-lo — uma referência capturada
	// uma vez só ficaria presa no período inicial.
	const r = $derived(data.resumo);

	const periodos = [
		{ dias: 2, nome: '2 dias' },
		{ dias: 7, nome: '7 dias' },
		{ dias: 30, nome: '30 dias' },
		{ dias: 365, nome: '1 ano' }
	];
	// Se `dias` na URL não bater com nenhuma opção (alguém editou o link à
	// mão), o texto ainda lê certo.
	const noPeriodo = $derived(
		data.dias === 365
			? 'no último ano'
			: `nos últimos ${periodos.find((p) => p.dias === data.dias)?.nome ?? `${data.dias} dias`}`
	);

	// As barras de finalidade são parte do total do período, que está escrito
	// logo acima delas: a régua é esse total, e a soma das barras fecha nele.
	const finalidades = $derived(
		Object.entries(r.porFinalidade)
			.map(([finalidade, cents]) => ({
				finalidade,
				nome: inicial(FINALIDADE[finalidade] ?? finalidade),
				total: cents,
				parte: r.custoTotalCents > 0 ? cents / r.custoTotalCents : 0,
				icone: ICONE_DA_FINALIDADE[finalidade] ?? 'outro'
			}))
			.sort((a, b) => b.total - a.total)
	);

	// O ESTOQUE é de agora: nada aqui depende de `data.dias`. A régua é a mesma
	// da tela de filamentos (o maior rolo), e é ela que decide quão cheio cada
	// carretel é desenhado.
	const regua = $derived(reguaCompartilhada(data.estoque));
	const restanteTotalG = $derived(data.estoque.reduce((soma, e) => soma + e.restanteG, 0));
	/** A prateleira do Início mostra os que acabam primeiro; o resto está em Filamentos. */
	const NA_PRATELEIRA = 8;
	const naPrateleira = $derived(data.estoque.slice(0, NA_PRATELEIRA));
	const plural = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`;

	// O que uma ação feita no próprio rolo acabou de fazer (ex.: secagem).
	let retorno = $state('');
	let avisoRetorno = $state<HTMLParagraphElement>();
	async function resolvido(mensagem: string) {
		retorno = mensagem;
		await tick();
		avisoRetorno?.focus();
	}
</script>

<h1 class="so-leitor">Início</h1>

<div class="inicio">
	<!-- ── ESTOQUE: o que há agora. Objetos soltos no estúdio; nenhum filtro manda aqui. ── -->
	<section class="inicio__estoque" aria-labelledby="titulo-estoque">
		<header class="topo">
			<h2 class="titulo-grande" id="titulo-estoque">Estoque</h2>
			{#if data.estoque.length > 0}
				<p class="topo__dado">
					{plural(data.estoque.length, 'rolo', 'rolos')}, {pesoCurto(restanteTotalG)}
				</p>
			{/if}
			<div class="topo__acoes">
				<a class="acao acao--miuda" href="/rolos/novo">
					<Icone nome="registrar" tamanho={16} />Cadastrar filamento
				</a>
			</div>
		</header>

		{#if retorno}
			<p class="retorno" role="status" tabindex="-1" bind:this={avisoRetorno}>
				<Icone nome="check" tamanho={18} />{retorno}
			</p>
		{/if}

		{#if data.estoque.length > 0}
			<ul class="prateleira">
				{#each naPrateleira as e (e.id)}
					<li>
						<RoloNaPrateleira
							rolo={e}
							{regua}
							href="/rolos?detalhes={e.id}#detalhe-rolo"
							aoResolver={resolvido}
						/>
					</li>
				{/each}
			</ul>
			{#if data.estoque.length > naPrateleira.length}
				<p>
					<a class="crt-link" href="/rolos">
						Ver os {data.estoque.length} rolos em Filamentos
					</a>
				</p>
			{/if}
		{:else}
			<div class="vazio-estado folha">
				<Icone nome="filamentos" tamanho={40} />
				<p>Nenhum filamento em estoque.</p>
				<a class="acao acao--sinal" href="/rolos/novo">Cadastrar o primeiro filamento</a>
			</div>
		{/if}
	</section>

	<!-- ── PERÍODO: uma folha, e o seletor é o topo dela. Só o que está na folha muda. ── -->
	<section class="periodo folha" aria-labelledby="titulo-periodo">
		<h2 class="so-leitor" id="titulo-periodo">Impressões {noPeriodo}</h2>
		<nav class="segmentos periodo__abas" aria-label="Período das impressões">
			{#each periodos as p (p.dias)}
				<a
					href="/?dias={p.dias}"
					aria-current={data.dias === p.dias ? 'true' : undefined}
					data-sveltekit-noscroll
				>
					{p.nome}
				</a>
			{/each}
		</nav>

		<p class="periodo__total">
			<strong class="num">{reais(r.custoTotalCents)}</strong>
			<span>custo total de {plural(r.totalImpressoes, 'impressão', 'impressões')}</span>
		</p>

		{#if r.totalImpressoes > 0}
			<dl class="periodo__numeros">
				<div>
					<dt><Icone nome="filamentos" tamanho={16} />Filamento</dt>
					<dd>{pesoCurto(r.gramas)}</dd>
				</div>
				<div>
					<dt><Icone nome="relogio" tamanho={16} />Máquina</dt>
					<dd>{numero(r.horas)} h</dd>
				</div>
				<div>
					<dt><Icone nome="sucesso" tamanho={16} />Sucesso</dt>
					<dd>{numero(r.taxaSucesso * 100, 0)}%</dd>
				</div>
				{#if r.gramasDesperdicadas > 0}
					<div>
						<dt><Icone nome="falha" tamanho={16} />Desperdício</dt>
						<dd>{pesoCurto(r.gramasDesperdicadas)}</dd>
					</div>
				{/if}
			</dl>

			<div class="periodo__bloco">
				<h3>Por finalidade</h3>
				<ul class="finalidades">
					{#each finalidades as f (f.finalidade)}
						<li>
							<Icone nome={f.icone} tamanho={20} />
							<span>{f.nome}</span>
							<span class="barra" aria-hidden="true"><span style:width="{f.parte * 100}%"></span></span>
							<strong>{reais(f.total)}</strong>
						</li>
					{/each}
				</ul>
				{#if r.rateioAtivo}
					<p class="nota">
						Com rateio: os {reais(r.custoDesperdicadoCents)} de falhas estão distribuídos entre as
						finalidades que deram certo. <a href="/config">Mudar em Configurações</a>
					</p>
				{/if}
			</div>

			<div class="periodo__bloco">
				<div class="periodo__bloco-topo">
					<h3>
						{#if r.totalImpressoes > data.recentes.length}
							As {data.recentes.length} peças mais recentes
						{:else}
							Peças
						{/if}
					</h3>
					<a href="/impressoes">Ver todas as impressões</a>
				</div>
				<ul class="pecas-lista">
					{#each data.recentes as i (i.id)}
						<li>
							<a href="/impressoes/{i.id}">
								<MiniaturaPeca id={i.id} temImagem={i.temImagem} cor={i.corHex} />
								<span class="pecas-lista__nome">
									{i.nomeLivre}
									<small>
										{dataCurta(i.inicioEm)}
										{#if i.status !== 'sucesso'}
											<span class="marca marca--{i.status === 'falha' ? 'falha' : 'atencao'}">
												<Icone nome={ICONE_DO_STATUS[i.status] ?? 'alerta'} tamanho={14} />{i.status ===
												'falha'
													? 'Falhou'
													: 'Cancelada'}
											</span>
										{/if}
									</small>
								</span>
								<span class="pecas-lista__g">{massa(i.gramas)}</span>
								<strong>{reais(i.custoTotalCents)}</strong>
							</a>
						</li>
					{/each}
				</ul>
			</div>
		{:else}
			<div class="vazio-estado">
				<Icone nome="impressoes" tamanho={36} />
				<p>Nenhuma impressão {noPeriodo}.</p>
				<a class="acao" href="/impressoes/nova">Registrar impressão</a>
			</div>
		{/if}
	</section>
</div>
