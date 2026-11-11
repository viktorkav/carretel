<script lang="ts">
	import { enhance } from '$app/forms';
	import Estado from '$lib/componentes/Estado.svelte';
	import Icone from '$lib/componentes/Icone.svelte';
	import { FINALIDADES } from '$lib/finalidade';
	import { FINALIDADE, dataHora, frase, inicial, numero } from '$lib/formato';

	let { data, form } = $props();

	// Grupos vêm da ação `buscar`. Cada grupo é um material+cor, e é nele que
	// mora a atribuição em lote.
	let grupos = $derived(form?.grupos ?? []);

	/**
	 * Três camadas de valor, da mais fraca para a mais forte:
	 *   1. sugestão do servidor (rolo aberto daquele material);
	 *   2. escolha feita no `select` do grupo;
	 *   3. escolha feita na linha.
	 *
	 * `ajustes` guarda SÓ a camada 3. É isso que mantém a promessa de que mexer
	 * numa linha não é desfeito pelo lote: aplicar um rolo ao grupo escreve na
	 * camada 2 e não encosta no que foi ajustado à mão. Para sobrescrever também
	 * essas, existe um botão explícito — e ele diz quantas vai atropelar.
	 *
	 * A FINALIDADE segue exatamente o mesmo desenho, com uma camada a mais no
	 * pé: o campo "vale para todas". A ordem, do mais forte ao mais fraco, é
	 * linha → grupo → sugestão do histórico → todas. A sugestão vem à frente do
	 * lote porque ela é evidência sobre AQUELA peça ("o MagicTray sempre foi
	 * homelab"), e o lote é o padrão de quem não tem evidência nenhuma.
	 *
	 * Essa ordem também é o que faz a tela funcionar igual sem JavaScript: a
	 * linha é submetida com o valor que o servidor desenhou, e linha em branco
	 * herda o campo do lote no próprio `lerEntradasDoFormulario`.
	 */
	let ajustes = $state<Record<string, { rolo?: string; impressora?: string; finalidade?: string }>>(
		{}
	);
	let ajusteDeGrupo = $state<Record<string, string>>({});
	let finalidadeDoGrupo = $state<Record<string, string>>({});
	let aceites = $state<Record<string, boolean>>({});
	/** Peso digitado nas peças que abortaram — a nuvem só sabe a estimativa cheia. */
	let pesos = $state<Record<string, string>>({});

	/**
	 * O botão "aplicar a de todas mesmo assim" liga esta chave. Ela é o que
	 * silencia as SUGESTÕES — os ajustes de linha e de grupo são apagados, mas a
	 * sugestão vem do servidor e não tem como ser apagada, só ignorada.
	 */
	let ignorarSugestoes = $state(false);

	// Zera tudo quando a lista muda (outra busca, outro conjunto de tarefas).
	let assinatura = $state('');
	$effect(() => {
		const atual = grupos.map((g: any) => `${g.chave}#${g.tarefas.length}`).join('|');
		if (atual === assinatura) return;
		assinatura = atual;
		ajustes = {};
		ajusteDeGrupo = {};
		finalidadeDoGrupo = {};
		aceites = {};
		pesos = {};
		ignorarSugestoes = false;
	});

	/**
	 * O que vai no campo de peso da peça abortada.
	 *
	 * Começa no rateio por tempo, que é SUGESTÃO declarada — o campo existe
	 * para ser corrigido pelo número da balança, e o texto ao lado diz por quê.
	 */
	function valorPeso(tarefa: any): string {
		const digitado = pesos[tarefa.taskId];
		if (digitado !== undefined) return digitado;
		return tarefa.gramasRateadas === null ? '' : String(tarefa.gramasRateadas);
	}

	function pesoResolvido(tarefa: any): boolean {
		const texto = valorPeso(tarefa).trim().replace(',', '.');
		const n = Number(texto);
		return texto !== '' && Number.isFinite(n) && n > 0;
	}

	function valorDoGrupo(grupo: any): string {
		return ajusteDeGrupo[grupo.chave] ?? (grupo.roloSugeridoId ? String(grupo.roloSugeridoId) : '');
	}

	function valorRolo(grupo: any, tarefa: any): string {
		if (!tarefa.importavel) return '';
		return ajustes[tarefa.taskId]?.rolo ?? valorDoGrupo(grupo);
	}

	function valorImpressora(tarefa: any): string {
		return (
			ajustes[tarefa.taskId]?.impressora ??
			(tarefa.impressoraSugeridaId ? String(tarefa.impressoraSugeridaId) : '')
		);
	}

	/**
	 * A finalidade da linha, resolvida pelas camadas. `''` significa "herda o
	 * campo do lote", e é resolvido no servidor — é por isso que a tela continua
	 * inteira sem JavaScript.
	 */
	function valorFinalidade(grupo: any, tarefa: any): string {
		const daLinha = ajustes[tarefa.taskId]?.finalidade;
		if (daLinha !== undefined) return daLinha;
		const doGrupo = finalidadeDoGrupo[grupo.chave];
		if (doGrupo) return doGrupo;
		if (ignorarSugestoes) return '';
		return tarefa.finalidadeSugerida ?? '';
	}

	function definir(taskId: string, campo: 'rolo' | 'impressora' | 'finalidade', valor: string) {
		ajustes[taskId] = { ...(ajustes[taskId] ?? {}), [campo]: valor };
	}

	function ajustadasNoGrupo(grupo: any) {
		return grupo.tarefas.filter((t: any) => ajustes[t.taskId]?.rolo !== undefined);
	}

	/** Descarta os ajustes de linha do grupo, deixando o valor do lote valer. */
	function soltarAjustes(grupo: any) {
		for (const t of grupo.tarefas) {
			if (ajustes[t.taskId]?.rolo === undefined) continue;
			const { rolo, ...resto } = ajustes[t.taskId];
			ajustes[t.taskId] = resto;
		}
	}

	/** Mesma pergunta do rolo, para a finalidade: o que o grupo atropelaria. */
	function finalidadesAjustadasNoGrupo(grupo: any) {
		return grupo.tarefas.filter((t: any) => ajustes[t.taskId]?.finalidade !== undefined);
	}

	function soltarFinalidades(grupo: any) {
		for (const t of grupo.tarefas) {
			if (ajustes[t.taskId]?.finalidade === undefined) continue;
			const { finalidade, ...resto } = ajustes[t.taskId];
			ajustes[t.taskId] = resto;
		}
	}

	/** Devolve o lote ao comando: apaga grupo, apaga linha e cala a sugestão. */
	function soltarTodasAsFinalidades() {
		for (const chave of Object.keys(finalidadeDoGrupo)) finalidadeDoGrupo[chave] = '';
		for (const taskId of Object.keys(ajustes)) {
			const { finalidade, ...resto } = ajustes[taskId];
			ajustes[taskId] = resto;
		}
		ignorarSugestoes = true;
	}

	function pronta(grupo: any, tarefa: any) {
		if (!tarefa.importavel) return false;
		if (tarefa.exigeConfirmacao && !aceites[tarefa.taskId]) return false;
		if (tarefa.exigePesoReal && !pesoResolvido(tarefa)) return false;
		return valorRolo(grupo, tarefa) !== '' && valorImpressora(tarefa) !== '';
	}

	let todas = $derived(grupos.flatMap((g: any) => g.tarefas.map((t: any) => ({ g, t }))));

	/**
	 * O LIGADO da bancada: a impressão EM ANDAMENTO — literalmente o LED da
	 * impressora ligada. A marca dela acende (casa + halo + pulso-do-ligado);
	 * todo o resto da tela fica apagado. O teto é UM ligado por tela (lei da
	 * mãe), por isso só a PRIMEIRA tarefa ainda imprimindo acende — com uma A1
	 * na bancada nunca há mais de uma, e se um dia houver duas máquinas, a
	 * segunda continua dizendo a mesma coisa por escrito, só sem o LED.
	 *
	 * A detecção é pelo texto que `parse.ts` escreve para o status 4 — só
	 * apresentação: nenhum contrato muda. Se o texto mudar lá, a marca volta a
	 * `atencao`, que é o estado seguro.
	 */
	const aindaImprimindo = (motivo: string | null | undefined) =>
		!!motivo && motivo.startsWith('ainda está imprimindo');
	let tarefaAcesa = $derived(
		todas.find(({ t }: any) => aindaImprimindo(t.problema))?.t.taskId ?? null
	);
	let puladaAcesa = $derived(
		(form?.resultado?.puladas ?? []).findIndex((p: any) => aindaImprimindo(p.motivo))
	);
	let prontas = $derived(todas.filter(({ g, t }: any) => pronta(g, t)).length);
	let aguardandoAceite = $derived(
		todas.filter(({ t }: any) => t.exigeConfirmacao && !aceites[t.taskId]).length
	);
	let aguardandoPeso = $derived(
		todas.filter(({ t }: any) => t.importavel && t.exigePesoReal && !pesoResolvido(t)).length
	);
	let semAtribuicao = $derived(
		todas.filter(
			({ g, t }: any) =>
				t.importavel &&
				!t.exigeConfirmacao &&
				(valorRolo(g, t) === '' || valorImpressora(t) === '')
		).length
	);

	/**
	 * Quantas linhas o campo "vale para todas" NÃO alcança hoje — por terem
	 * finalidade própria, sugerida pelo histórico ou escolhida à mão. É o mesmo
	 * aviso que o rolo já dava por grupo, aqui no nível do lote.
	 */
	let comFinalidadePropria = $derived(
		todas.filter(({ g, t }: any) => valorFinalidade(g, t) !== '').length
	);

	function horas(segundos: number | null) {
		if (segundos === null) return '—';
		return `${numero(segundos / 3600)} h`;
	}

	function dia(ms: number | null) {
		if (!ms) return '—';
		return dataHora(ms);
	}

	// `apelido` já vem montado pelo servidor com o código na frente
	// (`PLA-PRETO-01 · Bambu PLA Basic Preto`), que é o que distingue duas
	// compras iguais. Aqui só sobra o estado do rolo.
	function rotuloRolo(r: any) {
		return `${r.apelido} · ${r.status}`;
	}
</script>

<header class="topo">
	<h1>Importar</h1>
	{#if data.jaImportadas > 0}
		<p class="topo__dado">
			{data.jaImportadas}
			{data.jaImportadas === 1 ? 'impressão veio' : 'impressões vieram'} da nuvem{data.ultimaImportacaoEm
				? `, a última em ${dia(data.ultimaImportacaoEm)}`
				: ''}
		</p>
	{/if}
</header>

{#if form?.erro}
	<p class="retorno retorno--falha" role="alert">
		<Icone nome="falha" />{frase(form.erro)}
		{#if form.motivo === 'token'}<a class="crt-link" href="/config">Trocar o token</a>{/if}
	</p>
{/if}

<!--
	As duas condições que travam a importação vêm ANTES do botão, e cada uma diz
	o que falta e onde resolver: um botão desabilitado sem motivo escrito é um
	beco.
-->
<section class="folha importar-inicio" aria-labelledby="titulo-buscar">
	<header class="faixa">
		<h2 id="titulo-buscar"><Icone nome="nuvem" />Histórico da Bambu</h2>
	</header>
	<ul class="requisitos">
		<li class:requisitos__falta={!data.temToken}>
			<Icone nome={data.temToken ? 'sucesso' : 'falha'} />
			{#if data.temToken}
				<span>Token da nuvem guardado</span>
			{:else}
				<span>Falta o token da nuvem</span>
				<a class="acao acao--miuda" href="/config">Colar o token em Configurações</a>
			{/if}
		</li>
		<li class:requisitos__falta={data.rolos.length === 0}>
			<Icone nome={data.rolos.length > 0 ? 'sucesso' : 'falha'} />
			{#if data.rolos.length > 0}
				<span>
					{data.rolos.length}
					{data.rolos.length === 1 ? 'filamento cadastrado' : 'filamentos cadastrados'} para atribuir
				</span>
			{:else}
				<span>Falta um filamento: é dele que sai o preço de cada peça</span>
				<a class="acao acao--miuda" href="/rolos/novo">Cadastrar filamento</a>
			{/if}
		</li>
	</ul>
	<!--
		Não é a ação principal da tela: ela só busca e prepara. Quem grava no
		banco é "Importar N impressões", no pé da conferência.
	-->
	<form class="crt-acoes" method="POST" action="?/buscar" use:enhance>
		<button class="acao acao--sinal" type="submit" disabled={!data.temToken}>
			<Icone nome="importar" tamanho={18} />Buscar histórico na nuvem
		</button>
		<span class="crt-dica">Nada é gravado nesta etapa.</span>
	</form>
</section>

<!--
	O passivo de capas. Este card só existe quando há passivo — resolvido, ele
	some, e a tela volta a ter dois passos em vez de três.
-->
{#if data.semCapa > 0}
	<section class="painel">
		<div class="painel__cabeca">
			<h2 class="painel__nome">Capas que faltam</h2>
		</div>
		<div class="crt-corpo">
			<div class="crt-marcas">
				<Estado
					estado="atencao"
					nome="{data.semCapa} {data.semCapa === 1
						? 'impressão importada está'
						: 'impressões importadas estão'} sem imagem"
				/>
			</div>

			<p class="crt-dica">
				Baixa só as imagens, sem reimportar: custo e filamento atribuído não mudam. Peça muito antiga
				pode já ter saído do histórico da nuvem; essa fica sem imagem.
			</p>

			{#if form?.capas}
				{@const c = form.capas}
				<div class="crt-marcas">
					<Estado
						estado={c.recuperadas > 0 ? 'ok' : 'atencao'}
						nome="{c.recuperadas} de {c.pendentes} capas baixadas"
						anuncia
					/>
					{#if c.semCapaNaNuvem > 0}
						<Estado
							estado="atencao"
							nome="{c.semCapaNaNuvem} sem capa disponível na nuvem; essas não voltam"
						/>
					{/if}
					{#if c.falharam > 0}
						<Estado estado="falha" nome="{c.falharam} falharam no download; dá para tentar de novo" />
					{/if}
				</div>
			{/if}

			<hr class="separador" />

			<form class="crt-acoes" method="POST" action="?/capas" use:enhance>
				<button class="acao acao--traco" type="submit" disabled={!data.temToken}>
					Baixar as capas que faltam
				</button>
			</form>
		</div>
	</section>
{/if}

<!--
	O passivo de plate e projeto. Mesmo desenho do card de capas, pela mesma
	razão: um dado que a nuvem tem e o banco não, resolvível no lugar. Resolvido,
	o card some.

	O texto declara o que a ação MEXE e o que ela NÃO MEXE, porque é a pergunta
	que se faz antes de clicar num botão que escreve no histórico — e a resposta
	é a diferença entre esta ação e "excluir e reimportar", que traria os campos
	e levaria junto a atribuição de rolo de cada linha.
-->
{#if data.semPlate > 0}
	<section class="painel">
		<div class="painel__cabeca">
			<h2 class="painel__nome">Plate e projeto que faltam</h2>
		</div>
		<div class="crt-corpo">
			<div class="crt-marcas">
				<Estado
					estado="atencao"
					nome="{data.semPlate} {data.semPlate === 1
						? 'impressão importada está'
						: 'impressões importadas estão'} sem a plate ou sem o projeto"
				/>
			</div>

			<p class="crt-dica">
				Com a plate e o projeto, impressões de mesmo nome passam a ser reconhecidas como a mesma peça
				ou como peças complementares.
			</p>
			<p class="crt-dica">
				<strong>Escreve</strong> só esses dois campos, e só onde estão vazios.
				<strong>Não mexe</strong> em custo, filamento, finalidade, gramas, duração, observações nem
				capa, e nada é excluído. Peça muito antiga pode já ter saído do histórico da nuvem; essa
				continua como "plate não identificada".
			</p>

			{#if form?.completou}
				{@const c = form.completou}
				<div class="crt-marcas">
					<Estado
						estado={c.completadas > 0 ? 'ok' : 'atencao'}
						nome="{c.completadas} de {c.pendentes} {c.completadas === 1
							? 'linha completada'
							: 'linhas completadas'}; {c.indices} plates, {c.projetos} projetos"
						anuncia
					/>
					{#if c.semDadoNaNuvem > 0}
						<Estado
							estado="atencao"
							nome="{c.semDadoNaNuvem} sem o dado na própria nuvem; arquivo seu não tem projeto"
						/>
					{/if}
					{#if c.semTarefaNaNuvem > 0}
						<Estado
							estado="atencao"
							nome="{c.semTarefaNaNuvem} não vieram na busca; essas não voltam"
						/>
					{/if}
				</div>
			{/if}

			<hr class="separador" />

			<form class="crt-acoes" method="POST" action="?/completar" use:enhance>
				<button class="acao acao--traco" type="submit" disabled={!data.temToken}>
					Completar a plate e o projeto
				</button>
			</form>
		</div>
	</section>
{/if}

{#if form?.gravou}
	<section class="painel">
		<div class="painel__cabeca">
			<h2 class="painel__nome">Resultado</h2>
		</div>
		<div class="crt-corpo">
			<div class="crt-grade" style="--crt-min: 150px">
				<div class="crt-campo">
					<span class="rotulo">gravadas</span>
					<span class="metadado">{form.resultado.gravadas}</span>
				</div>
				<div class="crt-campo">
					<span class="rotulo">já existiam</span>
					<span class="metadado">{form.resultado.duplicadas}</span>
				</div>
				<div class="crt-campo">
					<span class="rotulo">material</span>
					<span class="metadado">{Math.round(form.resultado.gramas)} g</span>
				</div>
				<div class="crt-campo">
					<span class="rotulo">máquina</span>
					<span class="metadado">{horas(form.resultado.duracaoS)}</span>
				</div>
			</div>
			<p class="crt-dica">A deduplicação é pelo id da tarefa na nuvem.</p>

			{#if form.resultado.recalculadasPorDensidade > 0 || form.resultado.comPesoDigitado > 0}
				<div class="crt-marcas">
					{#if form.resultado.recalculadasPorDensidade > 0}
						<Estado
							estado="materia"
							nome="{form.resultado.recalculadasPorDensidade} com o peso refeito pela densidade do rolo"
						/>
					{/if}
					{#if form.resultado.comPesoDigitado > 0}
						<Estado
							estado="materia"
							nome="{form.resultado.comPesoDigitado} abortada(s) com peso informado à mão"
						/>
					{/if}
				</div>
				<p class="crt-dica">
					O peso que a nuvem manda é calculado no fatiamento, com a densidade do PERFIL. Quando o rolo
					tem outra densidade, o comprimento de filamento refaz a conta. Cada impressão registra na
					observação de onde saiu o número dela.
				</p>
			{/if}

			{#if form.resultado.puladas.length > 0}
				<hr class="separador" />
				<span class="rotulo">não gravadas</span>
				<div class="crt-marcas">
					{#each form.resultado.puladas as p, i}
						<!-- a que ainda está imprimindo não é ressalva: é a coisa acesa
						     da bancada — o LED da impressora ligada (teto de um) -->
						<Estado estado={i === puladaAcesa ? 'ligado' : 'atencao'} nome="{p.nome}: {p.motivo}" />
					{/each}
				</div>
			{/if}

			<hr class="separador" />
			<p class="crt-dica">
				Rolo errado em alguma delas? Abra a impressão e use "excluir e liberar para reimportar". O
				custo é congelado no registro e não se conserta editando.
			</p>
		</div>
	</section>
{/if}

{#if form?.conferencia}
	{@const c = form.conferencia}
	<section class="painel">
		<div class="painel__cabeca">
			<h2 class="painel__nome">Conferência</h2>
		</div>
		<div class="crt-corpo">
			<div class="crt-marcas">
				<Estado
					estado={c.completa ? 'ok' : 'falha'}
					nome="{c.colhidas} tarefas lidas da nuvem{c.total !== null
						? ` de ${c.total} declaradas`
						: ''}"
				/>
				{#if !c.completa}
					<Estado
						estado="falha"
						nome="a leitura veio truncada; não chegou até uma página vazia"
					/>
				{/if}
				{#if c.total !== null && c.total !== c.colhidas}
					<Estado
						estado="atencao"
						nome="o total declarado ({c.total}) não bate com o lido ({c.colhidas})"
					/>
				{/if}
				{#if c.descartadas > 0}
					<Estado estado="atencao" nome="{c.descartadas} registros vieram sem id e foram descartados" />
				{/if}
				{#if c.pesoNuvemG !== null}
					<Estado
						estado={c.pesoDiverge ? 'atencao' : 'ok'}
						nome="{c.pesoColhidoG} g lidos contra {c.pesoNuvemG} g no total vitalício da conta"
					/>
				{:else}
					<Estado
						estado="atencao"
						nome="a conta não devolveu o total vitalício; sem ele não dá para conferir a leitura"
					/>
				{/if}
			</div>

			{#if c.pesoNuvemG !== null && c.pesoColhidoG !== null && c.pesoNuvemG > 0}
				{@const desvio = (c.pesoColhidoG - c.pesoNuvemG) / c.pesoNuvemG}
				<!-- preso em [1, 99]% para o fio de 2px não sumir sob o overflow
				     quando a leitura estoura o trilho: encostado na borda ainda é
				     visível, e a marca escrita acima já deu o veredito -->
				{@const posicao = Math.min(99, Math.max(1, (0.5 + desvio / 0.04) * 100))}
				<!--
					Tolerância: o valor dentro da faixa declarada. O trilho cobre ±2% do
					total da conta; a faixa central é o aceite de ±1% — a MESMA régua que
					o servidor já aplica em `pesoDiverge` —; o ponteiro é onde a leitura
					caiu. Cor nunca é canal único: os números estão escritos na marca
					acima e na cota abaixo, isto aqui é só a posição. Leitura fora do
					trilho encosta na borda, e a marca de atenção já disse o veredito.
				-->
				<div
					class="crt-tolerancia"
					role="img"
					aria-label="Leitura a {numero(Math.abs(desvio) * 100, 2)}% do total da conta, contra a faixa de aceite de 1%"
				>
					<span class="nome">leitura × conta</span>
					<div class="trilho">
						<i class="faixa"></i>
						<b class="ponteiro" style="left: {posicao}%"></b>
					</div>
					<span class="valor">faixa de aceite ±1%</span>
				</div>
			{/if}
			{#if c.deltaPesoG !== null}
				<!-- Reconciliação é cota, não diff: o que se mede é a distância. BEM do
				     sistema (elementos.css): `.cota__marca`/`.cota__fio` nos dois lados
				     do rótulo, não `<b>`/`<i>` nus; achado da Task 6 fix round 1, a
				     mesma armadilha ("o nome do contêiner bate, o contrato interno não")
				     reaparecia aqui, na única `.cota` que sobrou fora daquele conserto. -->
				<p class="cota">
					<b class="cota__marca"></b><i class="cota__fio"></i>
					<span class="cota__rotulo">
						Δ {numero(Math.abs(c.deltaPesoG))} g entre o lido e o somado pela conta
					</span>
					<i class="cota__fio"></i><b class="cota__marca"></b>
				</p>
			{/if}
			{#if c.pesoDiverge}
				<p class="crt-dica">
					A diferença passa de 1%: alguma tarefa da conta não veio nesta leitura. Buscar de novo antes
					de gravar é mais barato que descobrir o buraco no estoque depois.
				</p>
			{/if}

			{#if !c.completa}
				<p class="crt-dica">Não grave achando que é o histórico inteiro.</p>
			{/if}
			{#if c.total !== null && c.total !== c.colhidas}
				<p class="crt-dica">A leitura vale; o número declarado é que não é confiável.</p>
			{/if}
		</div>
	</section>
{/if}

{#if form?.buscou}
	<!-- Divisor DENTRO da tela que já tem o h1 do secao__titulo lá em cima: o
	     mesmo papel de `.stage-head h2` que app.css já documenta para
	     "Encerrados" em /rolos. Um único h1 por página. -->
	<div class="stage-head">
		<h2>Tarefas novas</h2>
		<span class="metadado secundaria">
			{form.jaImportadas} já importadas e ignoradas; {prontas} prontas para gravar{semAtribuicao > 0
				? `, ${semAtribuicao} sem rolo ou impressora`
				: ''}{aguardandoAceite > 0
				? `, ${aguardandoAceite} multimaterial aguardando aceite`
				: ''}{aguardandoPeso > 0 ? `, ${aguardandoPeso} abortada(s) esperando o peso real` : ''}
		</span>
	</div>

	{#if grupos.length === 0}
		<section class="painel">
			<p class="crt-vazio">Nada novo. O histórico da nuvem já está todo aqui.</p>
		</section>
	{:else}
		<form method="POST" action="?/gravar" use:enhance>
			<section class="painel">
				<div class="painel__cabeca">
					<h2 class="painel__nome">Vale para todas</h2>
				</div>
				<div class="crt-corpo">
					<div class="crt-grade" style="--crt-min: 240px; --crt-max: 320px">
						<div class="crt-campo">
							<label class="rotulo" for="finalidade">finalidade das que não têm a sua</label>
							<select id="finalidade" name="finalidade">
								{#each FINALIDADES as f (f)}
									<option value={f}>{inicial(FINALIDADE[f])}</option>
								{/each}
							</select>
							<span class="crt-dica">
								Vale só para as tarefas sem finalidade sugerida, de grupo ou de linha.
							</span>
						</div>
					</div>

					<!--
						O aviso do lote, irmão do que cada grupo já dá para o rolo. Em vez de
						o campo de cima atropelar em silêncio — que foi exatamente o defeito,
						onze impressões no mesmo balde —, ele DIZ quantas não alcança, e a
						sobrescrita passa a ser um clique declarado.
					-->
					{#if comFinalidadePropria > 0}
						<div class="crt-acoes">
							<span class="crt-dica">
								{comFinalidadePropria}
								{comFinalidadePropria === 1
									? 'tarefa já tem finalidade própria e continua'
									: 'tarefas já têm finalidade própria e continuam'} como está.
							</span>
							<button class="acao acao--traco acao--miuda" type="button" onclick={soltarTodasAsFinalidades}>
								Usar esta finalidade em todas mesmo assim
							</button>
						</div>
					{/if}

					<!--
						Era um checkbox "baixar as imagens das peças". Virou frase: a URL
						da capa vale uma hora, então desmarcar a caixa não adiava o
						download — cancelava. Um controle cuja única função é perder dado
						de forma irreversível não é escolha, é armadilha.
					-->
					<p class="crt-dica">
						As capas das peças são baixadas junto; uma capa que falhar não interrompe a importação.
					</p>
				</div>
			</section>

			{#each grupos as g (g.chave)}
				{@const ajustadas = ajustadasNoGrupo(g)}
				<section class="painel">
					<div class="painel__cabeca">
						<h2 class="painel__nome">{g.rotulo}</h2>
					</div>
					<div class="crt-corpo">
						{#if g.chave === 'sem-detalhamento'}
							<!-- Este grupo não é um material: é "a nuvem não disse qual". Pode
							     misturar PLA, PETG e ABS na mesma lista, então um rolo aplicado
							     em lote aqui erraria em bloco. Só escolha linha a linha. -->
							<div class="crt-marcas">
								<Estado estado="atencao" nome="sem detalhamento de filamento" />
							</div>
							<p class="crt-dica">
								Estas tarefas podem ser de materiais diferentes. Não há atribuição em lote aqui de
								propósito. Escolha o rolo de cada uma.
							</p>
						{:else}
							<div class="crt-grade" style="--crt-min: 260px; --crt-max: 420px">
								<div class="crt-campo">
									<label class="rotulo" for="grupo-{g.chave}">rolo para o grupo inteiro</label>
									<select
										id="grupo-{g.chave}"
										value={valorDoGrupo(g)}
										onchange={(e) => (ajusteDeGrupo[g.chave] = e.currentTarget.value)}
									>
										<option value="">escolher tarefa a tarefa</option>
										{#each data.rolos as r}
											<option value={String(r.id)}>{rotuloRolo(r)}</option>
										{/each}
									</select>
								</div>

								<!--
									A segunda camada da finalidade, no mesmo lugar e com a mesma
									forma da do rolo. Vazio devolve a decisão para a camada de baixo
									(a sugestão do histórico e, abaixo dela, o campo do lote) — não
									significa "outro".
								-->
								<div class="crt-campo">
									<label class="rotulo" for="finalidade-grupo-{g.chave}">
										finalidade para o grupo inteiro
									</label>
									<select
										id="finalidade-grupo-{g.chave}"
										value={finalidadeDoGrupo[g.chave] ?? ''}
										onchange={(e) => (finalidadeDoGrupo[g.chave] = e.currentTarget.value)}
									>
										<option value="">deixar cada uma com a sua</option>
										{#each FINALIDADES as f (f)}
											<option value={f}>{inicial(FINALIDADE[f])}</option>
										{/each}
									</select>
								</div>
							</div>

							{#if finalidadesAjustadasNoGrupo(g).length > 0}
								{@const n = finalidadesAjustadasNoGrupo(g).length}
								<div class="crt-acoes">
									<span class="crt-dica">
										{n}
										{n === 1 ? 'finalidade ajustada' : 'finalidades ajustadas'} à mão continuam como
										estão.
									</span>
									<button class="acao acao--traco acao--miuda" type="button" onclick={() => soltarFinalidades(g)}>
										Aplicar a finalidade do grupo também nelas
									</button>
								</div>
							{/if}

							{#if ajustadas.length > 0}
								<div class="crt-acoes">
									<span class="crt-dica">
										{ajustadas.length}
										{ajustadas.length === 1 ? 'linha ajustada' : 'linhas ajustadas'} à mão continuam
										como estão.
									</span>
									<button class="acao acao--traco acao--miuda" type="button" onclick={() => soltarAjustes(g)}>
										Aplicar o rolo do grupo também nelas
									</button>
								</div>
							{/if}

							{#if !g.roloSugeridoId}
								{#if g.encerradosCompativeis.length > 0}
									<!--
										A ausência de sugestão aqui NÃO é "não há rolo deste
										material" — há, e ele está encerrado. A frase genérica
										mandaria o dono cadastrar um rolo novo, que duplicaria o
										preço daquela compra. A saída certa é outra: reabrir o que
										foi encerrado cedo demais.
									-->
									<div class="crt-marcas">
										<Estado estado="atencao" nome="o filamento deste material está encerrado" />
									</div>
									<p class="crt-dica">
										{g.encerradosCompativeis.map((r) => r.apelido).join(', ')}: filamento encerrado
										não é sugerido nem aceito na importação, para não congelar custo de um rolo que já
										saiu de circulação. Se estas peças saíram mesmo dele, reabra em
										<a class="crt-link" href="/rolos">Filamentos</a> e busque de novo. Se não, escolha
										outro rolo à mão.
									</p>
								{:else}
									<div class="crt-marcas">
										<Estado estado="atencao" nome="nenhum rolo cadastrado bate com este material" />
									</div>
									<p class="crt-dica">
										Escolha à mão. Não sugerimos rolo de outro material de propósito: o custo sairia
										errado e ficaria congelado.
									</p>
								{/if}
							{/if}
						{/if}
					</div>

					<div class="crt-rolagem">
						<table>
							<thead>
								<tr>
									<th scope="col">peça</th>
									<th scope="col">início</th>
									<!-- números à direita: ver `.crt-num` em app.css -->
									<th class="crt-num" scope="col">duração</th>
									<th class="crt-num" scope="col">gramas</th>
									<th scope="col">status</th>
									<th scope="col">rolo</th>
									<th scope="col">impressora</th>
									<th scope="col">finalidade</th>
								</tr>
							</thead>
							<tbody>
								{#each g.tarefas as t (t.taskId)}
									<tr>
										<td>{t.nome}</td>
										<td class="metadado">{dia(t.inicioEm)}</td>
										<td class="metadado crt-num">{horas(t.duracaoS)}</td>
										<td class="metadado crt-num">
											{t.gramas} g{t.exigePesoReal ? ' (estimativa)' : ''}
										</td>
										<td class="metadado">{t.status ?? '—'}</td>
										{#if t.importavel}
											<td>
												<select
													name="rolo:{t.taskId}"
													aria-label="Rolo de {t.nome}"
													value={valorRolo(g, t)}
													onchange={(e) => definir(t.taskId, 'rolo', e.currentTarget.value)}
												>
													<option value="">não importar</option>
													{#each data.rolos as r}
														<option value={String(r.id)}>{rotuloRolo(r)}</option>
													{/each}
												</select>
											</td>
											<td>
												<select
													name="impressora:{t.taskId}"
													aria-label="Impressora de {t.nome}"
													value={valorImpressora(t)}
													onchange={(e) => definir(t.taskId, 'impressora', e.currentTarget.value)}
												>
													<option value="">escolher</option>
													{#each data.impressoras as i}
														<option value={String(i.id)}>{i.nome}</option>
													{/each}
												</select>
											</td>
											<td>
												<!--
													A terceira camada. O `name` é o que faz a escolha chegar ao
													servidor por LINHA — era este campo que não existia, e por
													isso as onze impressões reais entraram todas iguais.
												-->
												<select
													name="finalidade:{t.taskId}"
													aria-label="Finalidade de {t.nome}"
													value={valorFinalidade(g, t)}
													onchange={(e) => definir(t.taskId, 'finalidade', e.currentTarget.value)}
												>
													<option value="">a de todas</option>
													{#each FINALIDADES as f (f)}
														<option value={f}>{inicial(FINALIDADE[f])}</option>
													{/each}
												</select>
												{#if t.finalidadeSugerida && ajustes[t.taskId]?.finalidade === undefined && !finalidadeDoGrupo[g.chave] && !ignorarSugestoes}
													<span class="crt-dica">sugerida pelo histórico desta peça</span>
												{/if}
											</td>
										{:else}
											<td colspan="3">
												<!--
													`importavel` é literalmente `problema === null`, então aqui
													ele nunca é nulo — o fallback existe só porque o tipo não
													carrega essa amarra, e é o mesmo texto que
													`importacao.ts` usa ao pular a tarefa.
												-->
												<!-- a que ainda está imprimindo é o LIGADO da tela: o LED da
												     impressora rodando agora, aceso com a casa e o pulso -->
												<Estado
													estado={t.taskId === tarefaAcesa ? 'ligado' : 'atencao'}
													nome={t.problema ?? 'tarefa incompleta na nuvem'}
												/>
											</td>
										{/if}
									</tr>
									{#if t.importavel && t.exigePesoReal}
										<!--
											A peça abortou, e `weight` continua sendo a estimativa do
											fatiamento da peça INTEIRA — o campo é escrito no
											fatiamento, não medido na máquina (uma tarefa rodando
											havia 17 s já reportava 202,67 g). Gravar esse número
											tira do rolo material que continua no rolo, então o peso
											é pedido aqui.
										-->
										<tr>
											<td colspan="7">
												<div class="crt-campo">
													<label class="rotulo" for="peso-{t.taskId}">
														peso real de “{t.nome}” (g)
													</label>
													<input
														id="peso-{t.taskId}"
														name="gramas:{t.taskId}"
														type="text"
														inputmode="decimal"
														value={valorPeso(t)}
														oninput={(e) => (pesos[t.taskId] = e.currentTarget.value)}
														aria-describedby="peso-{t.taskId}-dica"
													/>
													<span class="crt-dica" id="peso-{t.taskId}-dica">
														{t.avisoPeso}. A sugestão acima é o peso da nuvem rateado pela fração
														de tempo que a máquina rodou. É aproximação grosseira, porque o
														consumo não é linear no tempo (parede externa, brim e primeiras
														camadas gastam mais por minuto que o corpo da peça). O número que
														vale é o da balança: pese o que saiu e digite aqui. Sem peso, esta
														tarefa não entra.
													</span>
												</div>
											</td>
										</tr>
									{/if}
									{#if t.exigeConfirmacao}
										<tr>
											<td colspan="8">
												<label class="crt-opcao">
													<input
														type="checkbox"
														name="confirmar:{t.taskId}"
														checked={aceites[t.taskId] ?? false}
														onchange={(e) => (aceites[t.taskId] = e.currentTarget.checked)}
													/>
													<span>Importar mesmo assim: {t.avisoConfirmacao}.</span>
												</label>
											</td>
										</tr>
									{/if}
								{/each}
							</tbody>
						</table>
					</div>
				</section>
			{/each}

			<!-- O único acao--sinal desta rota: é aqui que a importação grava no
			     banco de verdade, o mesmo papel que "Registrar"/"Salvar" cumprem
			     no pé do formulário longo de /impressoes e /impressoras. -->
			<div class="crt-acoes">
				<button class="acao acao--sinal acao--grande" type="submit" disabled={prontas === 0}>
					Importar {prontas} impressões
				</button>
			</div>
		</form>
	{/if}
{/if}
