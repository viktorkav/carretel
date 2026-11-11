<script lang="ts">
 import SeletorFilamento from '$lib/componentes/SeletorFilamento.svelte';
 import ChipFilamento from '$lib/componentes/ChipFilamento.svelte';
 import Icone from '$lib/componentes/Icone.svelte';
 import MiniaturaPeca from '$lib/componentes/MiniaturaPeca.svelte';
 import { pesoCurto } from '$lib/figura-rolo';
 import {onMount,untrack} from 'svelte';
 import type {SubmitFunction} from '@sveltejs/kit';
	import RenderPeca from '$lib/componentes/RenderPeca.svelte';
	import { enhance } from '$app/forms';
	import Entrada from '$lib/componentes/Entrada.svelte';
	import Escolha from '$lib/componentes/Escolha.svelte';
	import Estado from '$lib/componentes/Estado.svelte';
	import { page } from '$app/state';
	import { erroDeCampo } from '$lib/erro-campo';
	import { FINALIDADES } from '$lib/finalidade';
	import { ESTADO_DA_IMPRESSAO, FINALIDADE, dataCurta, duracaoCurta, frase, inicial, massa, reais } from '$lib/formato';
	import { PARAM, PERIODOS, STATUS, enderecoDoRecorte, textoDoRecorte } from '$lib/recorte';
	import { VISUALIZACOES, enderecoVisualizacao } from '$lib/visualizacao';

	let { data, form } = $props();

 let pronta=$state(false);onMount(()=>{pronta=true;});
 let marcadas=$state<number[]>(untrack(()=>form?.idsFilamentoLote ?? []));
 let roloLote=$state(untrack(()=>form?.roloFilamentoLote ?? ''));
 let recalcularLote=$state(untrack(()=>form?.recalcularFilamentoLote ?? false));
 let enviandoLote=$state(false);
 const foraDaPagina=$derived(marcadas.filter(id=>!data.impressoes.some(i=>i.id===id)));
 const destinoLote=$derived(data.rolosDoFiltro.find(r=>String(r.id)===roloLote));
 const paginaSelecionada=$derived(data.impressoes.length>0&&data.impressoes.every(i=>marcadas.includes(i.id)));
 // Navegar/filtros limpa seleção; um POST com erro mantém os itens para revisão.
 let ultimaUrl=untrack(()=>page.url.pathname+page.url.search);
 $effect(()=>{const url=page.url.pathname+page.url.search;if(url!==ultimaUrl){ultimaUrl=url;marcadas=[];}});
 const enviarLote:SubmitFunction=()=>{
  enviandoLote=true;
  return async({result,update})=>{try{await update({reset:false});if(result.type==='success')marcadas=[];}finally{enviandoLote=false;}};
 };
 function marcarPagina(){marcadas=paginaSelecionada?marcadas.filter(id=>!data.impressoes.some(i=>i.id===id)):[...new Set([...marcadas,...data.impressoes.map(i=>i.id)])];}

	// O que a action devolveu: a mensagem, o campo que a causou e o que foi
	// digitado. Sem o eco, uma vírgula errada em "gramas" apagava os outros onze
	// campos do formulário.
	const erro = $derived(erroDeCampo(form) ?? undefined);
	const digitado = $derived((form?.valores ?? {}) as Record<string, string>);

	// O subtotal do RECORTE, escrito no cabeçalho do card. É ele que transforma
	// a lista em instrumento: "14 impressões · R$ 63,20 · 512,3 g" responde uma
	// pergunta que catorze linhas na tela não respondem.
	const subtitulo = $derived(textoDoRecorte(data.recorte, data.total));

	// O filtro é um controle sobre a lista: numa base sem nenhuma impressão ele
	// seria um formulário para recortar o nada. Continua aparecendo quando o
	// recorte atual está vazio — é por ele que se sai de lá.
	const temFiltro = $derived(data.total.impressoes > 0 || data.recorte.filtrando);

	const paginas = $derived(data.pagina);

	// A exclusão de uma impressão importada acontece em /impressoes/[id] e
	// termina em `redirect(303)` para cá com o nome na URL. Sem ler o
	// parâmetro, a ação mais destrutiva do sistema não devolvia confirmação
	// nenhuma — a peça simplesmente sumia da lista.
	const excluida = $derived(page.url.searchParams.get('excluida'));

	// O alternador é feito de LINKS, não de botões com handler: a escolha é uma
	// URL, e o servidor é quem decide o que desenhar. Sem isso a preferência
	// dependeria de JavaScript, que nenhuma outra tela deste sistema exige.
	const alternador = $derived(
		VISUALIZACOES.map((v) => ({
			visualizacao: v,
			href: enderecoVisualizacao(page.url, v),
			atual: v === data.visualizacao
		}))
	);
</script>

<header class="topo">
	<h1>Impressões</h1>
	<p class="topo__dado">
		{#if data.total.impressoes > 0}
			{data.total.impressoes}
			{data.total.impressoes === 1 ? 'impressão' : 'impressões'}{data.recorte.filtrando
				? ' no filtro'
				: ''}, {reais(data.total.custoTotalCents)}, {pesoCurto(data.total.gramas)}
		{:else}
			{subtitulo}
		{/if}
	</p>
	{#if data.impressoes.length > 0}
		<div class="topo__acoes">
			<!--
				O alternador é um par de LINKS, não de botões: a troca funciona sem
				JavaScript, fica no histórico e pode ser mandada por link. `aria-current`
				diz qual está valendo; o ícone repete o desenho de cada visão.
			-->
			<div class="crt-visao" role="group" aria-label="Como ver as impressões">
				{#each alternador as a (a.visualizacao)}
					<a class="crt-visao-item" href={a.href} aria-current={a.atual ? 'true' : undefined}>
						<Icone nome={a.visualizacao === 'grade' ? 'grade' : 'lista'} tamanho={18} /><span
							class="texto-largo">{a.visualizacao === 'grade' ? 'Grade' : 'Lista'}</span
						>
					</a>
				{/each}
			</div>
		</div>
	{/if}
</header>
{#if excluida}
	<div class="secao">
		<Estado estado="ok" nome="“{excluida}” excluída. Ela volta na próxima importação." anuncia />
	</div>
{/if}

<section class="impressoes">
	{#if temFiltro}
		<!--
			`method="GET"`, sem action e sem `use:enhance`: filtrar é navegar. O
			recorte vai para a URL, o que dá de graça o link compartilhável, o
			"voltar" do navegador e a página 2 sabendo de qual recorte ela é.
		-->
		<details class="folha recolhivel" open={data.recorte.filtrando}>
			<summary>
				<Icone nome="filtrar" tamanho={18} />Filtrar
				{#if data.recorte.filtrando}<span class="chip chip--plastico">filtros ativos</span>{/if}
			</summary>
			<form class="crt-corpo crt-filtro" method="GET">
				<div class="crt-grade" style="--crt-min: 170px">
					<Entrada
						rotulo="peça"
						nome={PARAM.busca}
						type="search"
						value={data.recorte.busca}
						dica="Qualquer pedaço do nome."
					/>
					<Escolha rotulo="período" nome={PARAM.periodo}>
						{#each PERIODOS as p (p.valor)}
							<option value={p.valor} selected={p.valor === data.recorte.periodo}>{inicial(p.nome)}</option>
						{/each}
					</Escolha>
					<Escolha rotulo="finalidade" nome={PARAM.finalidade}>
						<option value="todas" selected={data.recorte.finalidade === 'todas'}>Todas</option>
						{#each FINALIDADES as f (f)}
							<option value={f} selected={f === data.recorte.finalidade}>{inicial(FINALIDADE[f])}</option>
						{/each}
					</Escolha>
					<Escolha rotulo="status" nome={PARAM.status}>
						<option value="todos" selected={data.recorte.status === 'todos'}>Todos</option>
						{#each STATUS as st (st)}
							<option value={st} selected={st === data.recorte.status}>{inicial(st)}</option>
						{/each}
					</Escolha>
					<Escolha rotulo="filamento" nome={PARAM.rolo}>
						<option value="" selected={data.recorte.roloId === null}>Todos</option>
						{#each data.rolosDoFiltro as r (r.id)}
							<option value={r.id} selected={r.id === data.recorte.roloId}>
								{r.material} {r.cor}, {r.marca} ({r.codigo})
							</option>
						{/each}
					</Escolha>
				</div>
				<div class="crt-acoes">
					<button class="acao acao--sinal" type="submit">Filtrar</button>
					{#if data.recorte.filtrando}
						<a class="acao" href="/impressoes">Limpar filtros</a>
					{/if}
				</div>
			</form>
		</details>
	{/if}

 <form class="impressoes__lote" method="POST" action="?/filamentoEmLote" use:enhance={enviarLote} data-envio-local>
 {#if !data.impressoes.length && form?.sucessoFilamentoLote}<p class="retorno" role="status"><Icone nome="sucesso" />{form.sucessoFilamentoLote}</p>{/if}
 {#if data.impressoes.length}
 <details class="folha recolhivel ajustes-massa" open={marcadas.length>0 || !!form?.erroFilamentoLote || !!form?.sucessoFilamentoLote}><summary><Icone nome="filamentos" tamanho={18} /><span>Trocar o filamento<span class="texto-largo">{' '}de várias impressões</span></span>{#if marcadas.length}<span class="chip chip--plastico" aria-live="polite">{marcadas.length} {marcadas.length === 1 ? 'selecionada' : 'selecionadas'}</span>{/if}</summary>
 <section class="ajuste-lote" aria-labelledby="titulo-ajuste-lote">
  <h3 class="so-leitor" id="titulo-ajuste-lote">Trocar o filamento de várias impressões</h3>
  {#if form?.erroFilamentoLote}<p class="cadastro-erro" role="alert">{frase(form.erroFilamentoLote)}</p>{:else if form?.sucessoFilamentoLote}<p class="retorno" role="status"><Icone nome="sucesso" />{form.sucessoFilamentoLote}</p>{/if}
  <div class="ajuste-lote-selecao"><button type="button" class="acao acao--miuda" disabled={!pronta || enviandoLote} onclick={marcarPagina}>{paginaSelecionada?'Desmarcar esta página':'Selecionar esta página'}</button><button type="button" class="acao acao--miuda" disabled={!pronta || enviandoLote} onclick={()=>marcadas=[...data.idsDoRecorte]}>Selecionar as {data.total.impressoes} do filtro</button><button type="button" class="acao acao--miuda acao--fantasma" disabled={!pronta || enviandoLote || !marcadas.length} onclick={()=>marcadas=[]}>Limpar seleção</button></div>
  <SeletorFilamento rolos={data.rolosDoFiltro} nome="roloLote" rotulo="Filamento que foi usado" bind:value={roloLote} disabled={enviandoLote}/>
  <label class="crt-opcao"><input type="checkbox" name="recalcularLote" bind:checked={recalcularLote} disabled={enviandoLote}/><span>Recalcular também os custos das impressões alteradas</span></label>
  <p class="crt-dica">{recalcularLote?'O recálculo usa os preços e tarifas de hoje, incluindo energia, máquina e manutenção.':'Os custos já registrados ficam como estão.'} Rolos encerrados também podem ser escolhidos, para corrigir impressões antigas.</p>
  {#if destinoLote && marcadas.length}<p class="ajuste-lote-resumo">Atribuir <strong>{destinoLote.material} {destinoLote.cor}</strong> ({destinoLote.codigo}) a <strong>{marcadas.length} {marcadas.length === 1 ? 'impressão' : 'impressões'}</strong>.</p>{/if}
  <button type="submit" class="acao acao--sinal" name="escopo" value="marcadas" disabled={enviandoLote || (pronta && (!marcadas.length || !roloLote))}>{enviandoLote?'Aplicando…':'Atribuir filamento às selecionadas'}</button>
  <noscript><p>Marque as caixas das peças abaixo e volte aqui para aplicar.</p><button type="submit" class="acao" name="escopo" value="todas">Atribuir às {data.total.impressoes} impressões deste filtro</button></noscript>
 </section>
 </details>
 {/if}
 {#each data.idsDoRecorte as id (id)}<input type="hidden" name="listada" value={id}/>{/each}
 {#each foraDaPagina as id (id)}<input type="hidden" name="marcada" value={id}/>{/each}

	{#if data.total.impressoes === 0 && data.recorte.filtrando}
		<div class="vazio-estado folha">
			<Icone nome="filtrar" tamanho={36} />
			<p>Nenhuma impressão com estes filtros.</p>
			<a class="acao" href="/impressoes">Ver todas</a>
		</div>
	{:else if data.impressoes.length === 0}
		<div class="vazio-estado folha">
			<Icone nome="impressoes" tamanho={40} />
			<p>Nenhuma impressão registrada ainda.</p>
			<a class="acao acao--sinal" href="/impressoes/nova">Registrar a primeira impressão</a>
		</div>
	{:else if data.visualizacao === 'grade'}
		<!--
			GRADE. Para achar uma peça pelo que ela É: a imagem dela, na cor do
			filamento em que saiu. A caixa de seleção só aparece enquanto "Trocar o
			filamento de várias impressões" está aberto; fora disso a grade é só
			para olhar e abrir.
		-->
		<ul class="pecas-grade">
			{#each data.impressoes as i (i.id)}
				<li class="peca-cartao" class:peca-marcada={marcadas.includes(i.id)}>
     <label class="peca-marcar"><input class="check-quadrado" type="checkbox" name="marcada" value={i.id} bind:group={marcadas} disabled={enviandoLote} aria-label="Selecionar {i.nomeLivre}, impressão {i.id}"/><span>Selecionar</span></label>
					<a class="peca-cartao__abrir" href="/impressoes/{i.id}">
						{#if i.temImagem}
							<RenderPeca class="peca-cartao__figura" src="/impressoes/{i.id}/imagem" alt="" cor={i.filamento?.corHex} />
						{:else}
							<span class="peca-cartao__figura peca-cartao__figura--vazia" aria-hidden="true">
								<Icone nome="sem-imagem" tamanho={44} />
								<span>Sem imagem</span>
							</span>
						{/if}
						<span class="peca-cartao__nome">{i.nomeLivre}</span>
						{#if i.filamento}
							<ChipFilamento material={i.filamento.material} cor={i.filamento.cor} corHex={i.filamento.corHex} />
						{:else}
							<span class="nota">Filamento não associado</span>
						{/if}
						<span class="peca-cartao__pe">
							<span>{dataCurta(i.inicioEm)}</span>
							{#if i.status !== 'sucesso'}<Estado estado={ESTADO_DA_IMPRESSAO[i.status]} nome={i.status} />{/if}
							<strong>{reais(i.custoTotalCents)}</strong>
						</span>
					</a>
				</li>
			{/each}
		</ul>
	{:else}
		<!-- LISTA. Para comparar e para reclassificar: colunas alinhadas, uma linha por impressão. -->
		<div class="folha">
		<div class="crt-rolagem">
			<table>
				<thead>
					<tr>
						<th scope="col" aria-label="selecionar"></th>
						<th scope="col" aria-label="imagem"></th>
						<th scope="col">peça</th><th class="col-larga" scope="col">filamento</th>
						<th class="col-larga" scope="col">data</th>
						<th class="crt-num col-larga" scope="col">gramas</th>
						<th class="crt-num col-larga" scope="col">duração</th>
						<th class="col-larga" scope="col">resultado</th>
						<th class="crt-num" scope="col">custo</th>
					</tr>
				</thead>
				<tbody>
					{#each data.impressoes as i (i.id)}
						<tr>
							<td>
								<label class="crt-alvo">
									<input
										class="check-quadrado"
										type="checkbox"
										name="marcada"
										value={i.id}
										bind:group={marcadas}
          disabled={enviandoLote}
          aria-label="Selecionar {i.nomeLivre}, impressão {i.id}"
									/>
								</label>
							</td>
							<td><MiniaturaPeca id={i.id} temImagem={i.temImagem} cor={i.filamento?.corHex} class="peca-mini--linha" /></td>
							<td class="col-peca">
								<a class="crt-link" href="/impressoes/{i.id}">{i.nomeLivre}</a>
								<!-- no celular as colunas viram esta linha, embaixo do nome -->
								<small class="linha-estreita">
									{#if i.filamento}<ChipFilamento material={i.filamento.material} cor={i.filamento.cor} corHex={i.filamento.corHex} />{/if}
									<span>{dataCurta(i.inicioEm)}, {massa(i.gramas)}</span>
									{#if i.status !== 'sucesso'}<Estado estado={ESTADO_DA_IMPRESSAO[i.status]} nome={i.status} />{/if}
								</small>
							</td>
							<td class="col-larga">{#if i.filamento}<ChipFilamento material={i.filamento.material} cor={i.filamento.cor} corHex={i.filamento.corHex} codigo={i.filamento.codigo} />{:else}<span class="nota">Não associado</span>{/if}</td>
							<td class="col-larga">{dataCurta(i.inicioEm)}</td>
							<td class="crt-num col-larga">{massa(i.gramas)}</td>
							<td class="crt-num col-larga">{duracaoCurta(i.duracaoS)}</td>
							<td class="col-larga"><Estado estado={ESTADO_DA_IMPRESSAO[i.status]} nome={i.status} /></td>
							<td class="crt-num"><strong>{reais(i.custoTotalCents)}</strong></td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>

		<!--
			Reclassificar finalidade. Mora na LISTA, junto das caixas de seleção.
			`formaction` troca a action deste formulário para este par de botões.
		-->
		<div class="crt-corpo reclassificar">
			{#if form?.erroLote}
				<Estado estado="falha" nome={frase(form.erroLote)} anuncia />
			{:else if form?.sucessoLote !== undefined}
				<Estado
					estado="ok"
					nome="{form.sucessoLote} {form.sucessoLote === 1
						? 'impressão reclassificada'
						: 'impressões reclassificadas'} como {FINALIDADE[form.finalidadeLote]}"
					anuncia
				/>
			{/if}
			<div class="crt-acoes">
				<div class="crt-campo" style="flex: 1 1 220px">
					<label class="rotulo" for="finalidade-lote">Mudar a finalidade para</label>
					<select id="finalidade-lote" name="finalidadeLote">
						{#each FINALIDADES as f (f)}
							<option value={f}>{inicial(FINALIDADE[f])}</option>
						{/each}
					</select>
				</div>
				<button class="acao" type="submit" formaction="?/finalidadeEmLote" name="escopo" value="marcadas">
					Aplicar às marcadas
				</button>
				<button class="acao" type="submit" formaction="?/finalidadeEmLote" name="escopo" value="todas">
					{data.total.impressoes === 1
						? 'Aplicar à única deste filtro'
						: `Aplicar às ${data.total.impressoes} deste filtro`}
				</button>
			</div>
			<p class="crt-dica">
				Mudar a finalidade não recalcula o custo, que fica como foi registrado.
			</p>
		</div>
		</div>
	{/if}
 </form>

	{#if paginas.totalPaginas > 1}
		<nav class="crt-paginas" aria-label="Páginas da lista">
			{#if paginas.pagina > 1}
				<a class="acao acao--miuda" href={enderecoDoRecorte(page.url, { pagina: paginas.pagina - 1 })}>
					<Icone nome="voltar" tamanho={16} />Anteriores
				</a>
			{/if}
			<span class="metadado">Página {paginas.pagina} de {paginas.totalPaginas}</span>
			{#if paginas.pagina < paginas.totalPaginas}
				<a class="acao acao--miuda" href={enderecoDoRecorte(page.url, { pagina: paginas.pagina + 1 })}>
					Seguintes<Icone nome="seta" tamanho={16} />
				</a>
			{/if}
		</nav>
	{/if}
</section>

<div id="nova"></div>
