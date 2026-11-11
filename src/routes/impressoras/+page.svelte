<script lang="ts">
	import { enhance } from '$app/forms';
	import { page } from '$app/state';
	import { salvarESair } from '$lib/edicao';
	import Entrada from '$lib/componentes/Entrada.svelte';
	import FiguraRolo from '$lib/componentes/FiguraRolo.svelte';
	import Icone from '$lib/componentes/Icone.svelte';
	import { centavosParaTexto } from '$lib/dinheiro';
	import { erroDeCampo } from '$lib/erro-campo';
	import { comUnidade, frase, reais } from '$lib/formato';

	let { data, form } = $props();

	// O erro amarrado ao campo, e o que foi digitado. Os dois formulários desta
	// tela têm os MESMOS nomes de campo, então o erro só marca o formulário de
	// onde veio — quem diz é o `editandoId` da action.
	const erro = $derived(erroDeCampo(form) ?? undefined);
	const digitado = $derived((form?.valores ?? {}) as Record<string, string>);
	const dono = $derived(form as unknown as { editandoId?: number } | null);
	const erroDaEdicao = $derived(dono?.editandoId ? erro : undefined);
	const erroDoCadastro = $derived(dono?.editandoId ? undefined : erro);
	const digitadoDaEdicao = $derived(dono?.editandoId ? digitado : {});
	const digitadoDoCadastro = $derived(dono?.editandoId ? {} : digitado);

	// As horas de todas as máquinas, somadas das MESMAS horas que cada uma mostra.
	const horasDaBancada = $derived(data.impressoras.reduce((soma, i) => soma + i.horas, 0));
	const plural = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`;

	// Uma correção salva sai do modo de edição (ver `$lib/edicao`); o aviso vem
	// do retorno da action (sem JavaScript) ou do estado da navegação (com).
	const salva = $derived(
		form?.sucesso ? { recalculadas: form.recalculadas ?? 0 } : (page.state.correcaoSalva ?? null)
	);

	// O endereço da action leva junto o `editar`: sem JavaScript a página volta do
	// servidor NESSE endereço, e é por ele que uma correção recusada reabre a
	// folha com o que foi digitado. Salva, a folha sai — com ou sem script.
	const acabouDeSalvar = $derived(form?.sucesso === true && typeof form.recalculadas === 'number');
	const editando = $derived(acabouDeSalvar ? null : data.editando);
	const excluindo = $derived(data.excluindo);
	const impedimento = $derived(
		excluindo && (excluindo.dependentes.impressoes > 0 || excluindo.dependentes.manutencoes > 0)
	);
</script>

<header class="topo">
	<h1>Impressoras</h1>
	{#if data.impressoras.length > 0}
		<p class="topo__dado">
			{plural(data.impressoras.length, 'máquina', 'máquinas')}, {comUnidade(horasDaBancada, 'h')} de uso
		</p>
	{/if}
</header>

{#if form?.erro}
	<p class="retorno retorno--falha" role="alert"><Icone nome="falha" />{frase(form.erro)}</p>
{:else if salva}
	<p class="retorno" role="status">
		<Icone nome="sucesso" />{salva.recalculadas
			? `Impressora salva, com ${plural(salva.recalculadas, 'impressão recalculada', 'impressões recalculadas')}.`
			: 'Impressora salva.'}
	</p>
{/if}

{#if excluindo}
	<section class="folha confirmar" aria-labelledby="titulo-excluir">
		<h2 id="titulo-excluir">Excluir {excluindo.nome}?</h2>
		{#if impedimento}
			<p>
				{plural(excluindo.dependentes.impressoes, 'impressão depende', 'impressões dependem')} desta máquina{excluindo
					.dependentes.manutencoes > 0
					? `, e ${plural(excluindo.dependentes.manutencoes, 'manutenção', 'manutenções')} também`
					: ''}. Excluir apagaria a origem desse custo. Se ela saiu de uso, desmarque “Ativa” na
				edição.
			</p>
			<div class="crt-acoes">
				<a class="acao" href="/impressoras?editar={excluindo.id}"><Icone nome="editar" tamanho={18} />Editar</a>
				<a class="acao acao--fantasma" href="/impressoras">Voltar</a>
			</div>
		{:else}
			<p>Nenhuma impressão e nenhuma manutenção dependem dela. Não dá para desfazer.</p>
			<div class="crt-acoes">
				<form method="POST" action="?/excluir" use:enhance>
					<input type="hidden" name="id" value={excluindo.id} />
					<input type="hidden" name="confirmar" value="1" />
					<button class="acao acao--perigo" type="submit"><Icone nome="excluir" tamanho={18} />Excluir impressora</button>
				</form>
				<a class="acao acao--fantasma" href="/impressoras">Manter</a>
			</div>
		{/if}
	</section>
{/if}

{#if editando}
	<section class="folha" aria-labelledby="titulo-editar">
		<h2 id="titulo-editar">Corrigir {editando.nome}</h2>
		<form
			class="crt-corpo"
			method="POST"
			action="?/editar&editar={editando.id}"
			use:enhance={salvarESair(() => '/impressoras')}
		>
			<input type="hidden" name="id" value={editando.id} />

			<div class="crt-grade" style="--crt-min: 220px">
				<Entrada
					rotulo="nome"
					nome="nome"
					required
					value={digitadoDaEdicao.nome ?? editando.nome}
					erro={erroDaEdicao}
				/>
				<Entrada
					rotulo="modelo"
					nome="modelo"
					required
					value={digitadoDaEdicao.modelo ?? editando.modelo}
					erro={erroDaEdicao}
				/>
				<Entrada
					rotulo="apelido na Bambu"
					nome="apelidoBambu"
					value={digitadoDaEdicao.apelidoBambu ?? editando.apelidoBambu ?? ''}
					erro={erroDaEdicao}
					dica="Reconhece a máquina na importação."
				/>
				<Entrada
					rotulo="preço pago"
					nome="preco"
					inputmode="decimal"
					required
					value={digitadoDaEdicao.preco ?? centavosParaTexto(editando.precoCompraCents)}
					erro={erroDaEdicao}
					dica="Vira a depreciação. Use 0,00 se não souber."
				/>
				<Entrada
					rotulo="vida útil (horas)"
					nome="vidaUtilHoras"
					type="number"
					inputmode="numeric"
					required
					value={digitadoDaEdicao.vidaUtilHoras ?? editando.vidaUtilHoras}
					erro={erroDaEdicao}
				/>
				<Entrada
					rotulo="potência média (W)"
					nome="potenciaMediaW"
					type="number"
					inputmode="numeric"
					required
					value={digitadoDaEdicao.potenciaMediaW ?? editando.potenciaMediaW}
					erro={erroDaEdicao}
				/>
			</div>

			<label class="crt-opcao">
				<input type="checkbox" name="ativa" checked={editando.ativa} />
				<span>Ativa</span>
			</label>

			<!--
				O custo de cada impressão foi FIXADO no registro: corrigir o cadastro
				conserta o futuro e deixa o passado como estava. A decisão é de quem
				edita, caso a caso — erro de digitação pede recálculo, mudança real
				de preço não.
			-->
			{#if editando.impressoes > 0}
				<label class="crt-opcao">
					<input type="checkbox" name="recalcular" />
					<span>
						Recalcular o custo {editando.impressoes === 1
							? 'da impressão'
							: `das ${editando.impressoes} impressões`} desta máquina
						<small class="crt-dica">
							Usa este cadastro, a tarifa e o horímetro de hoje. Marque para corrigir erro de
							digitação; deixe em branco se o preço mudou de verdade.
						</small>
					</span>
				</label>
			{/if}

			<div class="crt-acoes">
				<button class="acao acao--sinal" type="submit">Salvar correção</button>
				<a class="acao acao--fantasma" href="/impressoras">Cancelar</a>
				<a class="acao acao--perigo acao--fim" href="/impressoras?excluir={editando.id}">
					<Icone nome="excluir" tamanho={18} />Excluir
				</a>
			</div>
		</form>
	</section>
{/if}

{#if data.impressoras.length === 0}
	<div class="vazio-estado">
		<img class="maquina__figura" src="/midia/impressora.webp" alt="" width="640" height="640" />
		<p>Nenhuma impressora cadastrada. É dela que saem o custo de energia e o de máquina.</p>
	</div>
{/if}

<!--
	Cada máquina é o objeto e os números dela: quanto já rodou sobre a vida útil
	(a régua é a DESTA máquina), o que ela custa por hora e o que está carregado
	nela agora.
-->
{#each data.impressoras as i (i.id)}
	<article class="maquina" aria-labelledby="maquina-{i.id}">
		<img class="maquina__figura" src="/midia/impressora.webp" alt="" width="640" height="640" />
		<div class="maquina__corpo">
			<header class="faixa">
				<h2 id="maquina-{i.id}">{i.nome}</h2>
				<span class="topo__dado">{i.modelo}{i.apelidoBambu ? `, ${i.apelidoBambu} na Bambu` : ''}</span>
				{#if !i.ativa}<span class="chip">Inativa</span>{/if}
				<a class="acao acao--miuda maquina__editar" href="/impressoras?editar={i.id}">
					<Icone nome="editar" tamanho={16} />Editar
				</a>
			</header>

			<div class="maquina__uso">
				<p class="maquina__horas">
					<strong class="num">{comUnidade(i.horas, 'h')}</strong>
					{#if i.vidaUtilHoras > 0}<span>de {comUnidade(i.vidaUtilHoras, 'h', 0)} de vida útil</span>{:else}<span>de uso</span>{/if}
				</p>
				{#if i.vidaUtilHoras > 0}
					<span class="barra" aria-hidden="true"><span style:width="{Math.min(100, (i.horas / i.vidaUtilHoras) * 100)}%"></span></span>
				{/if}
			</div>

			<dl class="fatos">
				<div>
					<dt><Icone nome="relogio" tamanho={18} />Custo por hora</dt>
					<dd>
						{#if i.vidaUtilHoras > 0}{reais(Math.round(i.precoCompraCents / i.vidaUtilHoras))}{:else}Sem vida útil{/if}
					</dd>
				</div>
				<div>
					<dt><Icone nome="energia" tamanho={18} />Potência média</dt>
					<dd>{i.potenciaMediaW} W</dd>
				</div>
				<div>
					<dt><Icone nome="etiqueta" tamanho={18} />Preço pago</dt>
					<dd>{reais(i.precoCompraCents)}</dd>
				</div>
			</dl>

			{#if i.ativa}
				<a class="maquina__rolos" href="/rolos">
					{#if i.carregados.length}
						<span class="maquina__rolos-figuras" aria-hidden="true">
							{#each i.carregados as c (c.posicao)}<FiguraRolo cor={c.corHex} fracao={c.fracao} />{/each}
						</span>
						<span>
							{#each i.carregados as c, n (c.posicao)}{n > 0 ? ', ' : ''}<b>{c.material}</b> {c.cor}{/each}
							<small>{plural(i.carregados.length, 'rolo carregado', 'rolos carregados')}</small>
						</span>
					{:else}
						<span class="encaixe__vago" aria-hidden="true"></span>
						<span>Nenhum rolo carregado <small>Carregar em Filamentos</small></span>
					{/if}
					<Icone nome="chevron-direita" tamanho={20} />
				</a>
			{/if}
		</div>
	</article>
{/each}

<details class="folha recolhivel" id="nova" open={!!erroDoCadastro || data.impressoras.length === 0}>
	<summary><Icone nome="registrar" tamanho={18} />Cadastrar impressora</summary>
	<form class="crt-corpo" method="POST" action="?/criar" use:enhance>
		<div class="crt-grade" style="--crt-min: 220px">
			<Entrada
				rotulo="nome"
				nome="nome"
				required
				value={digitadoDoCadastro.nome ?? ''}
				erro={erroDoCadastro}
				placeholder="Como você chama esta máquina"
			/>
			<Entrada
				rotulo="modelo"
				nome="modelo"
				required
				value={digitadoDoCadastro.modelo ?? ''}
				erro={erroDoCadastro}
				placeholder="A1, P1S, X1C"
			/>
			<Entrada
				rotulo="apelido na Bambu"
				nome="apelidoBambu"
				value={digitadoDoCadastro.apelidoBambu ?? ''}
				erro={erroDoCadastro}
				placeholder="Unit-01(A1)"
				dica="Reconhece a máquina na importação."
			/>
			<Entrada
				rotulo="preço pago"
				nome="preco"
				inputmode="decimal"
				value={digitadoDoCadastro.preco ?? ''}
				erro={erroDoCadastro}
				placeholder="1899,00"
			/>
			<Entrada
				rotulo="vida útil (horas)"
				nome="vidaUtilHoras"
				type="number"
				inputmode="numeric"
				value={digitadoDoCadastro.vidaUtilHoras ?? '5000'}
				erro={erroDoCadastro}
				dica="Com o preço, vira a depreciação por hora."
			/>
			<Entrada
				rotulo="potência média (W)"
				nome="potenciaMediaW"
				type="number"
				inputmode="numeric"
				value={digitadoDoCadastro.potenciaMediaW ?? '100'}
				erro={erroDoCadastro}
				dica="Vira o custo de energia."
			/>
		</div>
		<div class="crt-acoes">
			<button class="acao acao--sinal" type="submit">Salvar impressora</button>
		</div>
	</form>
</details>
