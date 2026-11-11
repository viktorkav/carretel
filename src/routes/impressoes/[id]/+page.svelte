<script lang="ts">
	import { enhance } from '$app/forms';
	import { page } from '$app/state';
	import { untrack } from 'svelte';
	import { salvarESair } from '$lib/edicao';
	import Entrada from '$lib/componentes/Entrada.svelte';
	import Escolha from '$lib/componentes/Escolha.svelte';
	import Estado from '$lib/componentes/Estado.svelte';
	import FiguraRolo from '$lib/componentes/FiguraRolo.svelte';
	import Icone from '$lib/componentes/Icone.svelte';
	import MiniaturaPeca from '$lib/componentes/MiniaturaPeca.svelte';
	import RenderPeca from '$lib/componentes/RenderPeca.svelte';
	import SeletorFilamento from '$lib/componentes/SeletorFilamento.svelte';
	import { erroDeCampo } from '$lib/erro-campo';
	import { FINALIDADES } from '$lib/finalidade';
	import {
		ESTADO_DA_IMPRESSAO,
		FINALIDADE,
		comUnidade,
		dataHora,
		duracaoCurta,
		frase,
		inicial,
		massa,
		numero,
		paraCampoDataHora,
		paraCampoDecimal,
		paraCampoDuracao,
		reais
	} from '$lib/formato';
	import { ICONE_DA_FINALIDADE, type NomeIcone } from '$lib/icones';

	// A capa pode ser vista de dois jeitos: na cor do filamento (o padrão) ou
	// como foi guardada. O alternador só existe depois que a recoloração deu
	// certo uma vez: capa de várias cores, ou com fundo, não tem "outra versão".
	//
	// Os três estados são guardados COM o id da impressão a que pertencem. Abrir
	// outra impressão sem remontar a tela (o link de uma irmã do projeto) volta
	// tudo ao padrão sozinho, sem um efeito para "limpar" — que rodaria depois
	// de a imagem já ter avisado que foi recolorida, e apagaria o aviso.
	let originalDe = $state<number | null>(null);
	let aplicadaEm = $state<number | null>(null);
	let coloriuEm = $state<number | null>(null);
	let falhouEm = $state<number | null>(null);

	let { data, form } = $props();
	// $derived, não `const`: navegar de /impressoes/1 para /impressoes/2 troca o
	// `data` do mesmo componente sem remontá-lo. Mesmo motivo do painel.
	const i = $derived(data.impressao);

	// A ausência é argumento: parcela que dá zero NÃO aparece — nem como barra
	// de um pixel, nem como linha "R$ 0,00".
	const parcelas = $derived(
		(
			[
				{ nome: 'Filamento', icone: 'filamentos', cents: i.custoFilamentoCents },
				{ nome: 'Energia', icone: 'energia', cents: i.custoEnergiaCents },
				{ nome: 'Máquina', icone: 'impressoras', cents: i.custoDepreciacaoCents },
				{ nome: 'Manutenção', icone: 'manutencao', cents: i.custoManutencaoCents }
			] satisfies { nome: string; icone: NomeIcone; cents: number }[]
		).filter((p) => p.cents > 0)
	);

	const verOriginal = $derived(originalDe === i.id);
	const corAplicada = $derived(aplicadaEm === i.id);
	const podeColorir = $derived(coloriuEm === i.id);
	// O registro tem arquivo, mas o navegador não conseguiu abri-lo como imagem.
	const imagemFalhou = $derived(falhouEm === i.id);

	// Uma correção salva sai do modo de edição (ver `$lib/edicao`); o aviso vem
	// do retorno da action (sem JavaScript) ou do estado da navegação (com).
	const salva = $derived(
		form?.sucesso ? { recalculadas: form.recalculadas ?? 0 } : (page.state.correcaoSalva ?? null)
	);

	// O endereço da action leva junto o `editar`: sem JavaScript a página volta do
	// servidor NESSE endereço, e é por ele que uma correção recusada reabre a
	// folha com o que foi digitado. Salva, a folha sai — com ou sem script.
	const acabouDeSalvar = $derived(form?.sucesso === true && typeof form.recalculadas === 'number');
	const editando = $derived(data.editando && !acabouDeSalvar);

	// De onde veio a imagem, dito pelo que o registro sabe: importação da nuvem
	// traz a capa da tarefa; nos outros casos é só "a imagem do registro".
	const origemDaCapa = $derived(
		i.origem === 'nuvem' ? 'Capa que veio com a tarefa importada' : 'Imagem guardada neste registro'
	);

	const soma = $derived(parcelas.reduce((total, p) => total + p.cents, 0));

	// As três leituras do mesmo arquivo de projeto — ver o comentário do card e
	// `$lib/projeto`. `$derived` pelo mesmo motivo de `i`.
	const projeto = $derived(data.projeto);
	const quantasIrmas = $derived(
		projeto.mesmaPlate.length + projeto.outrasPlates.length + projeto.semIndice.length
	);

	const statusPossiveis = ['sucesso', 'falha', 'cancelada'];

	// O erro amarrado ao campo e o que foi digitado. Sem eles, uma duração mal
	// formatada devolvia os treze campos da edição vazios — e o usuário via um
	// formulário em branco no lugar do registro que estava corrigindo.
	const erro = $derived(erroDeCampo(form) ?? undefined);
	// O `form` é a união do que TODAS as actions desta rota devolvem, e as de
	// exclusão não têm `valores`. A leitura é estreita de propósito.
	const d = $derived(
		((form as unknown as { valores?: Record<string, string> } | null)?.valores ??
			{}) as Record<string, string>
	);
</script>

<header class="topo topo--peca">
	<a class="voltar" href="/impressoes"><Icone nome="voltar" tamanho={16} />Impressões</a>
	<h1>{i.nomeLivre}</h1>
	<span class="topo__estado"><Estado estado={ESTADO_DA_IMPRESSAO[i.status]} nome={i.status} /></span>
	{#if !editando}
		<div class="topo__acoes">
			<a class="acao" href="/impressoes/{i.id}?editar"><Icone nome="editar" tamanho={18} />Editar</a>
		</div>
	{/if}
</header>

{#if form?.erro}
	<p class="retorno retorno--falha" role="alert"><Icone nome="falha" />{frase(form.erro)}</p>
{:else if salva}
	<p class="retorno" role="status">
		<Icone nome="sucesso" />{salva.recalculadas
			? 'Impressão salva, com o custo recalculado.'
			: 'Impressão salva. O custo ficou como estava.'}
	</p>
{/if}

<div class="peca">
	<!--
		A peça é a primeira coisa da tela: é o que se reconhece antes de ler. O
		`src` aponta para o id da impressão, nunca para o arquivo; o caminho no
		disco não chega ao HTML. Sem imagem, o lugar dela fica vago e diz por quê.
	-->
	<figure class="peca__palco">
		{#if data.temImagem}
			<RenderPeca
				class="peca__figura"
				src="/impressoes/{i.id}/imagem"
				alt="{i.nomeLivre}{corAplicada ? `, na cor ${data.rolo?.cor}` : ''}"
				cor={data.rolo?.corHex}
				original={verOriginal}
				onestado={(estado) => {
					// Só escreve, e lê o id fora do rastreio: este retorno roda
					// dentro do efeito do componente da imagem.
					const id = untrack(() => i.id);
					aplicadaEm = estado === 'aplicada' ? id : null;
					if (estado === 'aplicada') coloriuEm = id;
					falhouEm = estado === 'falhou' ? id : null;
				}}
			/>
			{#if podeColorir && data.rolo && !imagemFalhou}
				<div class="peca__versao segmentos" role="group" aria-label="Como ver a imagem">
					<button
						type="button"
						aria-pressed={!verOriginal}
						style:--icone-material={data.rolo.corHex}
						onclick={() => (originalDe = null)}
					>
						<Icone nome="filamentos" tamanho={18} />{data.rolo.cor}
					</button>
					<button type="button" aria-pressed={verOriginal} onclick={() => (originalDe = i.id)}>
						<Icone nome="foto" tamanho={18} />Como foi guardada
					</button>
				</div>
			{/if}
			<figcaption>
				{#if imagemFalhou}
					O arquivo de imagem deste registro existe, mas não abre como imagem.
				{:else if corAplicada}
					Prévia na cor do filamento. Brilho e textura reais variam.
				{:else if podeColorir}
					{origemDaCapa}.
				{:else if !data.rolo}
					{origemDaCapa}. <a class="crt-link" href="/impressoes/{i.id}?editar">Associar um filamento</a> mostra
					a peça na cor dele.
				{:else if !data.rolo.corHex}
					{origemDaCapa}. <a class="crt-link" href="/rolos?editar={data.rolo.id}">Cadastrar a cor do filamento</a>
					mostra a peça nessa cor.
				{:else}
					{origemDaCapa}. Imagem com várias cores ou com fundo fica como veio.
				{/if}
			</figcaption>
		{:else}
			<div class="peca__figura peca__figura--vazia">
				<Icone nome="sem-imagem" tamanho={56} />
				{#if data.semCapa === 'sem-imagem'}
					<strong>Sem imagem</strong>
					{#if i.origem === 'nuvem'}
						<span>
							A capa não veio na importação.
							<a class="crt-link" href="/importar">Importar</a> busca a que falta, sem mexer no custo.
						</span>
					{:else}
						<span>Este registro não guarda imagem da peça.</span>
					{/if}
				{:else}
					<strong>A imagem não abre</strong>
					<span>
						O registro aponta para um arquivo que não está disponível.{#if i.origem === 'nuvem'}
							Excluir e importar de novo traz a capa de volta.{/if}
					</span>
				{/if}
			</div>
		{/if}
	</figure>

	<div class="peca__dados">
		{#if data.excluindo}
			<section class="folha confirmar" aria-labelledby="titulo-excluir">
				<h2 id="titulo-excluir">Excluir esta impressão?</h2>
				<p>
					Ela sai do histórico e do horímetro da máquina, e o saldo do rolo é refeito sem ela. Não dá
					para desfazer.
				</p>
				<div class="crt-acoes">
					<form method="POST" action="?/excluir" use:enhance>
						<input type="hidden" name="confirmar" value="1" />
						<button class="acao acao--perigo" type="submit"><Icone nome="excluir" tamanho={18} />Excluir impressão</button>
					</form>
					<a class="acao acao--fantasma" href="/impressoes/{i.id}">Manter</a>
				</div>
			</section>
		{/if}

		{#if editando}
			<section class="folha" aria-labelledby="titulo-editar">
				<h2 id="titulo-editar">Corrigir o registro</h2>
				<form
					class="crt-corpo"
					method="POST"
					action="?/editar&editar"
					use:enhance={salvarESair(() => `/impressoes/${i.id}`)}
				>
					<div class="crt-grade" style="--crt-min: 210px">
						<Entrada rotulo="peça" nome="nomeLivre" required value={d.nomeLivre ?? i.nomeLivre} {erro} />

						<Escolha
							rotulo="impressora"
							nome="impressoraId"
							required
							temOpcoes={data.impressoras.length > 0}
							{erro}
						>
							{#each data.impressoras as im (im.id)}
								<option value={im.id} selected={(d.impressoraId ?? String(i.impressoraId)) === String(im.id)}>
									{im.nome}
								</option>
							{/each}
						</Escolha>

						<SeletorFilamento rolos={data.rolos} value={d.roloId ?? String(i.roloId)} required {erro} />

						<Entrada
							rotulo="início"
							nome="inicioEm"
							type="datetime-local"
							required
							value={d.inicioEm ?? paraCampoDataHora(i.inicioEm)}
							{erro}
						/>
						<Entrada
							rotulo="duração"
							nome="duracao"
							inputmode="decimal"
							required
							value={d.duracao ?? paraCampoDuracao(i.duracaoS)}
							{erro}
							dica="3,6h, 3:36 ou 215 (minutos)"
						/>
						<Entrada
							rotulo="gramas"
							nome="gramas"
							inputmode="decimal"
							required
							value={d.gramas ?? paraCampoDecimal(i.gramas)}
							{erro}
						/>

						<Escolha rotulo="resultado" nome="status" {erro}>
							{#each statusPossiveis as s (s)}
								<option value={s} selected={s === (d.status ?? i.status)}>{inicial(s)}</option>
							{/each}
						</Escolha>

						<Entrada
							rotulo="motivo da falha"
							nome="motivoFalha"
							value={d.motivoFalha ?? i.motivoFalha ?? ''}
							{erro}
						/>
						<Escolha rotulo="finalidade" nome="finalidade" {erro}>
							{#each FINALIDADES as f (f)}
								<option value={f} selected={f === (d.finalidade ?? i.finalidade)}>{inicial(FINALIDADE[f])}</option>
							{/each}
						</Escolha>
						<Entrada
							rotulo="camada (mm)"
							nome="camadaMm"
							inputmode="decimal"
							value={d.camadaMm ?? paraCampoDecimal(i.camadaMm)}
							{erro}
						/>
						<Entrada
							rotulo="paredes"
							nome="paredes"
							type="number"
							inputmode="numeric"
							value={d.paredes ?? i.paredes ?? ''}
							{erro}
						/>
						<Entrada
							rotulo="infill (%)"
							nome="infillPct"
							type="number"
							inputmode="numeric"
							value={d.infillPct ?? i.infillPct ?? ''}
							{erro}
						/>
					</div>
					<Entrada
						rotulo="observações"
						nome="observacoes"
						value={d.observacoes ?? i.observacoes ?? ''}
						{erro}
					/>

					<!--
						Mudar as gramas ou o rolo reposiciona o saldo sozinho, porque o
						restante é derivado a cada leitura. O custo NÃO: ele foi fixado no
						registro, e só é reescrito quando a pessoa pede.
					-->
					<label class="crt-opcao">
						<input type="checkbox" name="recalcular" />
						<span>
							Recalcular o custo com os valores de hoje
							<small class="crt-dica">
								Usa o preço atual do rolo e da máquina, a tarifa e o horímetro de agora. Sem marcar, o
								custo fica como foi registrado.
							</small>
						</span>
					</label>

					<div class="crt-acoes">
						<button class="acao acao--sinal" type="submit">Salvar correção</button>
						<a class="acao acao--fantasma" href="/impressoes/{i.id}">Cancelar</a>
						<a class="acao acao--perigo acao--fim" href="/impressoes/{i.id}?excluir">
							<Icone nome="excluir" tamanho={18} />Excluir
						</a>
					</div>
				</form>
			</section>
		{:else}
			<section class="folha custo" aria-labelledby="titulo-custo">
				<h2 class="so-leitor" id="titulo-custo">Custo</h2>
				<p class="custo__total">
					<strong class="num">{reais(i.custoTotalCents)}</strong>
					<span>custo desta impressão</span>
				</p>
				{#if parcelas.length === 0}
					<p class="nota">
						Registrada sem preço de rolo, sem tarifa de energia e sem preço de compra da impressora.
					</p>
				{:else}
					<!--
						As parcelas na MESMA régua, que é o total. Parcela que dá zero não
						aparece: nem como barra de um pixel, nem como linha "R$ 0,00".
					-->
					<ul class="custo__partes">
						{#each parcelas as p (p.nome)}
							<li>
								<Icone nome={p.icone} tamanho={20} />
								<span>{p.nome}</span>
								<span class="barra" aria-hidden="true"><span style:width="{(p.cents / soma) * 100}%"></span></span>
								<strong>{reais(p.cents)}</strong>
								<small>{numero((p.cents / soma) * 100, 0)}%</small>
							</li>
						{/each}
					</ul>
				{/if}
				<p class="nota">Valor fixado no registro. Editar permite recalcular com os preços de hoje.</p>
			</section>

			<!-- O rolo que pagou por esta peça: o objeto, o nome e o código escrito no carretel. -->
			{#if data.rolo}
				<a class="peca__rolo" href="/rolos?detalhes={data.rolo.id}">
					<FiguraRolo cor={data.rolo.corHex} fracao={data.nivelDoRolo} />
					<span class="peca__rolo-nome">
						<span><b>{data.rolo.material}</b> {data.rolo.cor}</span>
						<small>{data.rolo.marca} <span class="etiqueta">{data.rolo.codigo}</span></small>
					</span>
					<span class="peca__rolo-g"><strong class="num">{massa(i.gramas)}</strong><small>nesta peça</small></span>
					<Icone nome="chevron-direita" tamanho={20} />
				</a>
			{:else}
				<p class="peca__rolo peca__rolo--ausente">
					<Icone nome="filamentos" tamanho={28} />
					<span class="peca__rolo-nome">
						<span>Filamento não encontrado</span>
						<small><a class="crt-link" href="/impressoes/{i.id}?editar">Associar um filamento</a></small>
					</span>
					<span class="peca__rolo-g"><strong class="num">{massa(i.gramas)}</strong><small>nesta peça</small></span>
				</p>
			{/if}

			{#if i.status === 'falha' && i.motivoFalha}
				<p class="retorno retorno--falha"><Icone nome="falha" />{i.motivoFalha}</p>
			{/if}

			<dl class="fatos">
				<div>
					<dt><Icone nome="calendario" tamanho={18} />Início</dt>
					<dd>{dataHora(i.inicioEm)}</dd>
				</div>
				<div>
					<dt><Icone nome="relogio" tamanho={18} />Duração</dt>
					<dd>{duracaoCurta(i.duracaoS)}</dd>
				</div>
				<div>
					<dt><Icone nome="impressoras" tamanho={18} />Impressora</dt>
					<dd>{data.impressora?.nome ?? 'Não encontrada'}</dd>
				</div>
				<div>
					<dt><Icone nome={ICONE_DA_FINALIDADE[i.finalidade] ?? 'outro'} tamanho={18} />Finalidade</dt>
					<dd>{inicial(FINALIDADE[i.finalidade] ?? i.finalidade)}</dd>
				</div>
				{#if i.camadaMm}
					<div>
						<dt><Icone nome="camadas" tamanho={18} />Camada</dt>
						<dd>{comUnidade(i.camadaMm, 'mm', 2)}</dd>
					</div>
				{/if}
				{#if i.paredes}
					<div>
						<dt><Icone nome="paredes" tamanho={18} />Paredes</dt>
						<dd>{i.paredes}</dd>
					</div>
				{/if}
				{#if i.infillPct}
					<div>
						<dt><Icone nome="preenchimento" tamanho={18} />Preenchimento</dt>
						<dd>{i.infillPct}%</dd>
					</div>
				{/if}
				<div>
					<dt><Icone nome={i.origem === 'nuvem' ? 'nuvem' : 'editar'} tamanho={18} />Registro</dt>
					<dd>{i.origem === 'nuvem' ? 'Importado da nuvem' : i.origem === 'ocr' ? 'Lido de uma foto' : 'Manual'}</dd>
				</div>
			</dl>

			{#if i.observacoes}
				<p class="peca__obs">{i.observacoes}</p>
			{/if}
		{/if}
	</div>
</div>

<!--
	MESMO ARQUIVO DE PROJETO, em até três leituras e sem total. Ver `$lib/projeto`.

	- A MESMA PLATE de novo é comparável: mesmo conteúdo, mesmo custo esperado.
	  A distância entre as rodadas é a leitura de retrabalho.
	- OUTRAS PLATES do mesmo projeto são complementares: lado a lado, com massa
	  e custo de cada uma, e NENHUM total.
	- Sem índice de plate não se inventa parentesco.
-->
{#if quantasIrmas > 0}
	<section class="folha" aria-labelledby="titulo-projeto">
		<header class="faixa">
			<h2 id="titulo-projeto">Do mesmo arquivo</h2>
			<span class="topo__dado">
				{quantasIrmas}
				{quantasIrmas === 1 ? 'outra impressão' : 'outras impressões'}
			</span>
		</header>

		{#if projeto.mesmaPlate.length > 0}
			<div class="crt-corpo">
				<h3>Mesma plate ({projeto.plateAtual})</h3>
				{#if projeto.variacao}
					<Estado
						estado={projeto.variacao.pct !== null && projeto.variacao.pct > 0 ? 'atencao' : 'ok'}
						nome="entre {reais(projeto.variacao.menorCents)} e {reais(projeto.variacao.maiorCents)}{projeto.variacao.pct !== null
							? `, ${numero(projeto.variacao.pct, 1)}% de variação`
							: ''} em {projeto.variacao.comparaveis} rodadas concluídas"
					/>
					<p class="nota">Rodadas que falharam ficam fora da variação, e os custos não são somados.</p>
				{/if}
			</div>
			{@render tabelaDeIrmas(projeto.mesmaPlate)}
		{/if}

		{#if projeto.outrasPlates.length > 0}
			<div class="crt-corpo">
				<h3>Outras plates do projeto</h3>
				<p class="nota">Peças complementares, não tentativas da mesma. Os custos não são somados.</p>
			</div>
			{@render tabelaDeIrmas(projeto.outrasPlates)}
		{/if}

		{#if projeto.semIndice.length > 0}
			<div class="crt-corpo">
				<h3>Plate não identificada</h3>
				<p class="nota">
					{#if projeto.plateAtual === null}
						Esta impressão não guarda qual plate rodou.
					{:else}
						Estas impressões não guardam qual plate rodou.
					{/if}
					<a class="crt-link" href="/importar">Importar</a> completa esse dado buscando na nuvem.
				</p>
			</div>
			{@render tabelaDeIrmas(projeto.semIndice)}
		{/if}
	</section>
{/if}

{#snippet tabelaDeIrmas(
	linhas: {
		corHex?: string | null;
		id: number;
		nomeLivre: string;
		inicioEm: number;
		gramas: number;
		custoTotalCents: number;
		status: 'sucesso' | 'falha' | 'cancelada';
		temImagem: boolean;
		indicePlate: number | null;
	}[]
)}
	<div class="crt-rolagem">
		<table>
			<thead>
				<tr>
					<th scope="col" aria-label="imagem"></th>
					<th scope="col">quando</th>
					<th scope="col">plate</th>
					<th class="crt-num" scope="col">gramas</th>
					<th class="crt-num" scope="col">custo</th>
					<th scope="col">resultado</th>
				</tr>
			</thead>
			<tbody>
				{#each linhas as irma (irma.id)}
					<tr>
						<td><MiniaturaPeca id={irma.id} temImagem={irma.temImagem} cor={irma.corHex} class="peca-mini--linha" /></td>
						<td><a class="crt-link" href="/impressoes/{irma.id}">{dataHora(irma.inicioEm)}</a></td>
						<td class="secundaria">
							{irma.indicePlate === null ? 'Não identificada' : `Plate ${irma.indicePlate}`}
						</td>
						<td class="crt-num">{massa(irma.gramas)}</td>
						<td class="crt-num"><strong>{reais(irma.custoTotalCents)}</strong></td>
						<td><Estado estado={ESTADO_DA_IMPRESSAO[irma.status]} nome={irma.status} /></td>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>
{/snippet}

{#if i.origem === 'nuvem'}
	<section class="folha" aria-labelledby="titulo-nuvem">
		<header class="faixa">
			<h2 id="titulo-nuvem"><Icone nome="nuvem" />Importada da nuvem</h2>
			<span class="topo__dado">tarefa {i.taskIdNuvem}</span>
		</header>
		<p class="nota">
			Se o rolo atribuído estiver errado, editar não conserta o custo já fixado: exclua e importe de
			novo com o rolo certo. A tarefa continua na nuvem.
		</p>
		<!--
			`confirm` é só uma segunda chance para quem tem JavaScript; a confirmação
			que vale é o campo `confirmar`, lido pelo servidor.
		-->
		<form class="crt-acoes" method="POST" action="?/excluirDaNuvem" use:enhance>
			<input type="hidden" name="confirmar" value="sim" />
			<button
				class="acao acao--perigo"
				type="submit"
				onclick={(e) => {
					if (!confirm(`Excluir "${i.nomeLivre}"? Ela volta a aparecer na próxima importação.`)) {
						e.preventDefault();
					}
				}}><Icone nome="excluir" tamanho={18} />Excluir e liberar para reimportar</button
			>
		</form>
	</section>
{/if}
