<script lang="ts">
	import EstoqueFilamentos from '$lib/componentes/EstoqueFilamentos.svelte';
	import FiguraRolo from '$lib/componentes/FiguraRolo.svelte';
	import Icone from '$lib/componentes/Icone.svelte';
	import { ICONE_DO_ALERTA } from '$lib/icones';
	import { gramasDeSaldo, pesoCurto } from '$lib/figura-rolo';
	import { enhance } from '$app/forms';
	import { page } from '$app/state';
	import { salvarESair } from '$lib/edicao';
	import Entrada from '$lib/componentes/Entrada.svelte';
	import Escolha from '$lib/componentes/Escolha.svelte';
	import Estado from '$lib/componentes/Estado.svelte';
	import { centavosParaTexto } from '$lib/dinheiro';
	import { erroDeCampo } from '$lib/erro-campo';
	import {
		ALERTA,
		STATUS_ROLO,
		comUnidade,
		dataCurta,
		dataHora,
		frase,
		inicial,
		paraCampoDecimal,
		numero,
		reais
	} from '$lib/formato';
	import { fracaoNaRegua, reguaCompartilhada } from '$lib/regua';

	let { data, form } = $props();

	// O erro que a action devolveu, amarrado ao campo, e o que foi digitado. Sem
	// isso um preço com ponto no lugar da vírgula apagava os doze campos do
	// cadastro — e a mensagem aparecia no topo da página, longe do controle.
	const erro = $derived(erroDeCampo(form) ?? undefined);
	const digitado = $derived((form?.valores ?? {}) as Record<string, string>);

	/**
	 * De QUAL formulário veio o erro.
	 *
	 * O `form` do SvelteKit é a união de tudo que as actions desta página
	 * devolvem, e um campo que só existe num ramo não é visível pelo tipo. Esta
	 * leitura é estreita de propósito: só o dono do erro, e nada mais.
	 */
	const dono = $derived(form as unknown as { editandoId?: number; roloComErro?: number } | null);

	/**
	 * O erro da pesagem pertence a UM rolo — a tela lista todos, cada um com o
	 * seu formulário de pesagem. Sem o `roloComErro`, um peso recusado no rolo 2
	 * pintaria de vermelho o campo do rolo 1 também.
	 */
	const erroDaPesagem = $derived((roloId: number) =>
		dono?.roloComErro === roloId ? erro : undefined
	);

	/**
	 * A conversão viva entre os dois campos. É CONFORTO, e não a regra: quem
	 * decide é `resolverPesagem` no servidor, e a tela funciona igual sem
	 * JavaScript — é por isso que os dois campos podem chegar preenchidos.
	 *
	 * Uma casa decimal porque é a precisão que a coluna guarda e a que a balança
	 * de bancada entrega; mais casas só produziriam ruído no campo vizinho.
	 */
	function outroCampo(id: string) {
		return document.getElementById(id) as HTMLInputElement | null;
	}

	/**
	 * O vizinho é escrito com o MESMO separador que a pessoa acabou de usar.
	 *
	 * Desde que os campos decimais viraram `type="text"` (ver `Entrada.svelte`),
	 * a vírgula chega intacta ao servidor — e digitar `812,5` num campo para ver
	 * `562.5` aparecer no outro seria a tela contradizendo o que ela mesma
	 * aceita. Os dois valem no servidor; o que não vale é a incoerência na cara
	 * de quem digitou.
	 */
	function comoOUsuarioDigitou(n: number, original: string) {
		return original.includes(',') ? String(n).replace('.', ',') : String(n);
	}

	function converterDoBruto(r: { id: number; pesoCarretelG: number }, valor: string) {
		const alvo = outroCampo(`pesar-${r.id}`);
		if (!alvo) return;
		const n = Number(valor.replace(',', '.'));
		// Campo esvaziado esvazia o vizinho: deixar um número velho lá seria pior
		// que não converter — o servidor veria dois pesos brigando.
		if (!valor.trim() || !Number.isFinite(n) || !(r.pesoCarretelG > 0)) {
			alvo.value = '';
			return;
		}
		const liquido = Math.round((n - r.pesoCarretelG) * 10) / 10;
		alvo.value = liquido > 0 ? comoOUsuarioDigitou(liquido, valor) : '';
	}

	function converterDoLiquido(r: { id: number; pesoCarretelG: number }, valor: string) {
		const alvo = outroCampo(`bruto-${r.id}`);
		if (!alvo) return;
		const n = Number(valor.replace(',', '.'));
		if (!valor.trim() || !Number.isFinite(n) || !(r.pesoCarretelG > 0)) {
			alvo.value = '';
			return;
		}
		alvo.value = comoOUsuarioDigitou(Math.round((n + r.pesoCarretelG) * 10) / 10, valor);
	}

	/**
	 * O erro só marca campo do formulário a que ele pertence.
	 *
	 * A tela tem três formulários com nomes de campo repetidos (`preco`,
	 * `pesoInicial`) — a edição, o cadastro pelo catálogo e o cadastro manual.
	 * Sem esta separação, um erro de preço na edição pintaria de vermelho o
	 * campo `preco` dos outros dois, que o usuário nem tocou. Quem diz de onde
	 * veio é a própria action, no `editandoId`/`roloComErro`.
	 */
	const erroDaEdicao = $derived(dono?.editandoId ? erro : undefined);
	const digitadoDaEdicao = $derived(dono?.editandoId ? digitado : {});

	// ── integração `crit-leitura` × `encerrar` ────────────────────────────────
	// A `crit-leitura` desenhou a régua sobre `data.rolos`; a `encerrar` partiu
	// essa lista em `ativos` e `encerrados`. A régua continua sendo UMA e sobre
	// as duas: o card do rolo encerrado também desenha barra, e uma régua só dos
	// ativos faria a barra dele medir por outra escala — que é exatamente o
	// defeito que a régua compartilhada existe para matar.
	const todosOsRolos = $derived([...data.ativos, ...data.encerrados]);

	// A régua de TODAS as barras desta tela — ver `$lib/regua`. Cada rolo tinha
	// a sua, e o de 6 g em 20 g desenhava mais cheio que o de 391 g em 1 kg.
	const regua = $derived(reguaCompartilhada(todosOsRolos));

	// A prateleira responde "qual está acabando", então a ordem é essa: o
	// que tem menos gramas primeiro. Rolo encerrado fica fora — ele não é
	// estoque, e ocuparia justamente o topo da lista. A `encerrar` já separa os
	// dois no servidor (`estaEncerrado`), então aqui não há mais filtro por
	// status: duas leituras do mesmo predicado é como as duas divergem.
	const emEstoque = $derived(
		data.ativos.toSorted((a, b) => a.estoque.restanteG - b.estoque.restanteG)
	);

	// Há um detalhe aberto quando a URL pede um rolo (`?detalhes=`) ou quando
	// uma pesagem recusada precisa reaparecer no rolo que a causou.
	const temDetalhe = $derived(
		data.ativos.some((r) => r.id === data.detalheId || !!erroDaPesagem(r.id)) ||
			data.encerrados.some((r) => r.id === data.detalheId)
	);

	// Uma correção salva sai do modo de edição (ver `$lib/edicao`); o aviso vem
	// do retorno da action (sem JavaScript) ou do estado da navegação (com).
	const salva = $derived(
		form?.sucesso
			? { recalculadas: (form as { recalculadas?: number }).recalculadas ?? 0 }
			: (page.state.correcaoSalva ?? null)
	);

	// O retorno fala do gesto que deu certo. As mudanças que a pesagem faz além de
	// pesar ("peso inicial ajustado… · rolo aberto") viram frase, não lista com ponto no meio.
	const FEITO: Record<string, string> = {
		pesagem: 'Pesagem registrada.',
		secagem: 'Secagem registrada.',
		abertura: 'Rolo marcado como aberto.'
	};
	function emFrase(aviso: string) {
		const partes = aviso.split(' · ');
		const texto = partes.length > 1 ? `${partes.slice(0, -1).join(', ')} e ${partes.at(-1)}` : partes[0];
		return frase(texto);
	}
	const retorno = $derived(
		form?.erro
			? null
			: [form?.feito ? FEITO[form.feito] : '', form?.aviso ? emFrase(form.aviso) : '']
					.filter(Boolean)
					.join(' ') || null
	);

	// O endereço da action leva junto o `editar`: sem JavaScript a página volta do
	// servidor NESSE endereço, e é por ele que uma correção recusada reabre a
	// folha com o que foi digitado. Salva, a folha sai — com ou sem script.
	const acabouDeSalvar = $derived(
		form?.sucesso === true && typeof (form as { recalculadas?: number }).recalculadas === 'number'
	);
	const editando = $derived(acabouDeSalvar ? null : data.editando);
	const excluindo = $derived(data.excluindo);
	const pesagem = $derived(data.excluindoPesagem);
	const encerrando = $derived(data.encerrando);
	const reabrindo = $derived(data.reabrindo);

	const statusPossiveis = ['fechado', 'aberto', 'vazio', 'descartado'];

	/**
	 * A frase da comparação estimativa × balança.
	 *
	 * A informação não pode viver só nos três números da grade: "8 g, 5 g, −3 g"
	 * exige que o leitor saiba de cor para que lado o sinal aponta. A frase diz o
	 * que a diferença SIGNIFICA — se o fatiador está subestimando ou
	 * superestimando o consumo —, que é a única coisa que se leva para o próximo
	 * rolo.
	 */
	function fraseDoRendimento(r: {
		diferencaG: number;
		fracaoDoRolo: number;
		sentido: string;
	}): string {
		const quanto = comUnidade(Math.abs(r.diferencaG), 'g', 1);
		const fracao = `${numero(r.fracaoDoRolo * 100, 1)}% do rolo`;
		if (r.sentido === 'bateu') return 'A estimativa do fatiador bateu com a balança.';
		if (r.sentido === 'a-menos') {
			return `O rolo rendeu ${quanto} a menos que a estimativa (${fracao}); o fatiador subestima o consumo, e o estoque dos outros filamentos está otimista na mesma medida.`;
		}
		return `O rolo rendeu ${quanto} a mais que a estimativa (${fracao}); o fatiador superestima o consumo, e o estoque dos outros filamentos está pessimista na mesma medida.`;
	}
</script>

<header class="topo">
	<h1>Filamentos</h1>
	<div class="topo__acoes">
		<!-- Link, não botão: o destino é uma tela, e funciona sem JavaScript. -->
		<a class="acao acao--sinal" href="/rolos/novo">
			<Icone nome="registrar" tamanho={18} />Cadastrar filamento
		</a>
	</div>
</header>
{#if form?.erro}
	<p class="retorno retorno--falha" role="alert"><Icone nome="falha" />{frase(form.erro)}</p>
{:else if retorno}
	<p class="retorno" role="status"><Icone nome="sucesso" />{retorno}</p>
{:else if salva}
	<p class="retorno" role="status">
		<Icone nome="sucesso" />{salva.recalculadas
			? `Filamento salvo, com ${salva.recalculadas} ${salva.recalculadas === 1 ? 'impressão recalculada' : 'impressões recalculadas'}.`
			: 'Filamento salvo.'}
	</p>
{/if}

{#if excluindo}
	<section class="folha confirmar" aria-labelledby="titulo-excluir">
		<h2 id="titulo-excluir">Excluir o filamento {excluindo.codigo}?</h2>
		{#if excluindo.dependentes.impressoes > 0}
			<p>
				{excluindo.dependentes.impressoes}
				{excluindo.dependentes.impressoes === 1 ? 'impressão saiu' : 'impressões saíram'} deste rolo, e
				o custo delas vem do preço dele. Se o rolo acabou, encerre em vez de excluir.
			</p>
			<div class="crt-acoes">
				<a class="acao" href="/rolos?encerrar={excluindo.id}"><Icone nome="encerrar" tamanho={18} />Encerrar</a>
				<a class="acao" href="/rolos?editar={excluindo.id}"><Icone nome="editar" tamanho={18} />Editar</a>
				<a class="acao acao--fantasma" href="/rolos">Voltar</a>
			</div>
		{:else}
			<p>
				Nenhuma impressão saiu dele.{excluindo.dependentes.afericoes > 0
					? ` ${excluindo.dependentes.afericoes === 1 ? 'A pesagem registrada é apagada' : `As ${excluindo.dependentes.afericoes} pesagens registradas são apagadas`} junto.`
					: ''} Não dá para desfazer.
			</p>
			<div class="crt-acoes">
				<form method="POST" action="?/excluir" use:enhance>
					<input type="hidden" name="id" value={excluindo.id} />
					<input type="hidden" name="confirmar" value="1" />
					<button class="acao acao--perigo" type="submit"><Icone nome="excluir" tamanho={18} />Excluir filamento</button>
				</form>
				<a class="acao acao--fantasma" href="/rolos">Manter</a>
			</div>
		{/if}
	</section>
{/if}

{#if pesagem}
	<section class="folha confirmar" aria-labelledby="titulo-pesagem">
		<h2 id="titulo-pesagem">Apagar a pesagem de {comUnidade(pesagem.pesoLiquidoG, 'g', 0)}?</h2>
		<p>
			Feita em {dataHora(pesagem.dataEm)}. O saldo parte sempre da pesagem mais recente: sem esta, ele
			passa a partir da anterior ou, se não houver outra, do peso inicial do cadastro, com todas as
			impressões descontadas.
		</p>
		<div class="crt-acoes">
			<form method="POST" action="?/apagarPesagem" use:enhance>
				<input type="hidden" name="id" value={pesagem.id} />
				<input type="hidden" name="confirmar" value="1" />
				<button class="acao acao--perigo" type="submit"><Icone nome="excluir" tamanho={18} />Apagar a pesagem</button>
			</form>
			<a class="acao acao--fantasma" href="/rolos?editar={pesagem.roloId}">Manter</a>
		</div>
	</section>
{/if}

{#if encerrando}
	<section class="folha" aria-labelledby="titulo-encerrar">
		<header class="rolo-detalhe__cabeca">
			<FiguraRolo
				cor={encerrando.corHex}
				fracao={encerrando.pesoLiquidoInicialG > 0
					? encerrando.sobraEstimadaG / encerrando.pesoLiquidoInicialG
					: 0}
			/>
			<div class="rolo-detalhe__id">
				<h2 id="titulo-encerrar"><b>Encerrar o filamento {encerrando.codigo}?</b></h2>
				<p>{encerrando.marca} {encerrando.material} {encerrando.cor}</p>
				<p class="rolo-detalhe__saldo">
					<strong class="num">{gramasDeSaldo(encerrando.sobraEstimadaG)}</strong><span class="num">g</span>
					<small>estimados de {pesoCurto(encerrando.pesoLiquidoInicialG)}</small>
				</p>
			</div>
		</header>
		<form class="crt-corpo" method="POST" action="?/encerrar&encerrar={encerrando.id}" use:enhance>
			<!--
				Encerrar com sobra GRAVA UMA PESAGEM, que é a base do saldo: a mesma
				escrita que o token de envio protege em `?/aferir`. Ver
				`$lib/server/envio`.
			-->
			<input type="hidden" name="envio" value={data.envio} />
			<input type="hidden" name="id" value={encerrando.id} />
			<input type="hidden" name="confirmar" value="1" />

			<!--
				Sem opção pré-marcada: as duas situações têm consequências diferentes
				no que o sistema passa a afirmar sobre o rolo, e um padrão aqui
				gravaria "não sobrou nada" num carretel com 800 g.
			-->
			<fieldset class="opcoes-icone">
				<legend>O que aconteceu</legend>
				<label>
					<input type="radio" name="motivo" value="acabou" required />
					<span><Icone nome="acabando" tamanho={18} />Acabou</span>
				</label>
				<label>
					<input type="radio" name="motivo" value="sobra" />
					<span><Icone nome="encerrar" tamanho={18} />Sobrou, mas não vou mais usar</span>
				</label>
			</fieldset>

			<div class="crt-grade" style="--crt-min: 240px; --crt-max: 340px">
				<Entrada
					rotulo="sobra na balança (g, sem o carretel)"
					nome="sobra"
					inputmode="decimal"
					dica="Se acabou, digite 0. Em branco, encerra sem pesagem."
				/>
			</div>
			<p class="nota">
				A sobra pesada vira a última pesagem do rolo e mostra quanto ele rendeu contra a estimativa. O
				rolo sai do registro de impressão, da importação e dos avisos{encerrando.impressoes === 0
					? ''
					: encerrando.impressoes === 1
						? '; a impressão dele continua no histórico'
						: `; as ${encerrando.impressoes} impressões dele continuam no histórico`}. Dá para reabrir
				depois.
			</p>

			<div class="crt-acoes">
				<button class="acao acao--sinal" type="submit"><Icone nome="encerrar" tamanho={18} />Encerrar o filamento</button>
				<a class="acao acao--fantasma" href="/rolos">Cancelar</a>
			</div>
		</form>
	</section>
{/if}

{#if reabrindo}
	<section class="folha" aria-labelledby="titulo-reabrir">
		<h2 id="titulo-reabrir">Reabrir o filamento {reabrindo.codigo}?</h2>
		<p>
			Ele volta para “{reabrindo.dataAbertura ? 'aberto' : 'lacrado'}” e reaparece no registro de
			impressão, na importação e nos avisos.
			{#if reabrindo.pesagemFinal}
				<!-- A pesagem final FICA: é medida real da balança, e reabrir corrige a intenção, não a medida. -->
				A pesagem final de <strong>{comUnidade(reabrindo.pesagemFinal.pesoLiquidoG, 'g', 1)}</strong>
				({dataHora(reabrindo.pesagemFinal.dataEm)}) continua sendo a base do saldo. Se o erro era a
				pesagem, apague-a em
				<a class="crt-link" href="/rolos?editar={reabrindo.id}">pesagens registradas</a>.
			{:else}
				Foi encerrado sem pesagem final, então o saldo volta a ser o estimado.
			{/if}
		</p>
		<div class="crt-acoes">
			<form method="POST" action="?/reabrir" use:enhance>
				<input type="hidden" name="id" value={reabrindo.id} />
				<input type="hidden" name="confirmar" value="1" />
				<button class="acao acao--sinal" type="submit"><Icone nome="reabrir" tamanho={18} />Reabrir o filamento</button>
			</form>
			<a class="acao acao--fantasma" href="/rolos">Cancelar</a>
		</div>
	</section>
{/if}

{#if editando}
	<section class="folha" aria-labelledby="titulo-editar">
		<header class="faixa">
			<h2 id="titulo-editar">Corrigir {editando.codigo}</h2>
			<span class="topo__dado">{editando.marca} {editando.material} {editando.cor}</span>
		</header>
		<form
			class="crt-corpo"
			method="POST"
			action="?/editar&editar={editando.id}"
			use:enhance={salvarESair(() => '/rolos')}
		>
			<input type="hidden" name="id" value={editando.id} />

			<div class="crt-grade" style="--crt-min: 220px">
				<Entrada
					rotulo="código"
					nome="codigo"
					required
					value={digitadoDaEdicao.codigo ?? editando.codigo}
					erro={erroDaEdicao}
					dica="É o que está escrito no carretel."
				/>
				<Entrada
					rotulo="marca"
					nome="marca"
					required
					value={digitadoDaEdicao.marca ?? editando.marca}
					erro={erroDaEdicao}
				/>
				<Entrada
					rotulo="material"
					nome="material"
					required
					value={digitadoDaEdicao.material ?? editando.material}
					erro={erroDaEdicao}
				/>
				<Entrada
					rotulo="cor"
					nome="cor"
					required
					value={digitadoDaEdicao.cor ?? editando.cor}
					erro={erroDaEdicao}
				/>
				<Entrada
					rotulo="cor (hex)"
					nome="corHex"
					value={digitadoDaEdicao.corHex ?? editando.corHex ?? ''}
					erro={erroDaEdicao}
					dica="É a cor em que o rolo e as peças aparecem."
				/>
				<Entrada
					rotulo="densidade"
					nome="densidade"
					inputmode="decimal"
					required
					value={digitadoDaEdicao.densidade ?? paraCampoDecimal(editando.densidade)}
					erro={erroDaEdicao}
				/>
				<Entrada
					rotulo="temperatura do bico (°C)"
					nome="tempBico"
					type="number"
					inputmode="numeric"
					value={digitadoDaEdicao.tempBico ?? editando.tempBico ?? ''}
					erro={erroDaEdicao}
					placeholder="Não informada"
				/>
				<Entrada
					rotulo="temperatura da mesa (°C)"
					nome="tempMesa"
					type="number"
					inputmode="numeric"
					value={digitadoDaEdicao.tempMesa ?? editando.tempMesa ?? ''}
					erro={erroDaEdicao}
					placeholder="Não informada"
				/>
				<Entrada
					rotulo="apelido"
					nome="apelido"
					value={digitadoDaEdicao.apelido ?? editando.apelido ?? ''}
					erro={erroDaEdicao}
				/>
				<Entrada
					rotulo="preço pago"
					nome="preco"
					inputmode="decimal"
					required
					value={digitadoDaEdicao.preco ?? centavosParaTexto(editando.precoPagoCents)}
					erro={erroDaEdicao}
					dica="Vira o custo de filamento. Use 0,00 se não souber."
				/>
				<Entrada
					rotulo="peso líquido inicial (g)"
					nome="pesoInicial"
					inputmode="decimal"
					required
					value={digitadoDaEdicao.pesoInicial ?? paraCampoDecimal(editando.pesoLiquidoInicialG)}
					erro={erroDaEdicao}
				/>
				<Entrada
					rotulo="peso do carretel (g)"
					nome="pesoCarretel"
					inputmode="decimal"
					required
					value={digitadoDaEdicao.pesoCarretel ?? paraCampoDecimal(editando.pesoCarretelG)}
					erro={erroDaEdicao}
					dica="Converte a pesagem bruta em líquida."
				/>
				<Entrada
					rotulo="fornecedor"
					nome="fornecedor"
					value={digitadoDaEdicao.fornecedor ?? editando.fornecedor ?? ''}
					erro={erroDaEdicao}
				/>

				<!--
					Correção de cadastro, não o caminho normal para tirar um rolo de
					circulação: encerrar e reabrir têm ação própria, que é onde a sobra
					é pesada. Um status recusado volta marcado, e o que foi escolhido
					sobrevive ao `fail`.
				-->
				<Escolha
					rotulo="situação"
					nome="status"
					erro={erroDaEdicao}
					dica="Para encerrar de verdade, use “Encerrar” no rolo: é lá que a sobra é pesada."
				>
					{#each statusPossiveis as s (s)}
						<option value={s} selected={s === (digitadoDaEdicao.status ?? editando.status)}>
							{inicial(STATUS_ROLO[s] ?? s)}
						</option>
					{/each}
				</Escolha>
			</div>

			<div class="crt-campo">
				<label class="rotulo" for="notas-{editando.id}">notas</label>
				<textarea id="notas-{editando.id}" name="notas" rows="2">{editando.notas ?? ''}</textarea>
			</div>

			<!--
				`codigoBambu` e `fonteCatalogo` não têm campo de propósito: o primeiro
				é a âncora que a importação da nuvem usa para achar este rolo.
			-->
			{#if editando.codigoBambu}
				<p class="nota">
					Código Bambu <strong>{editando.codigoBambu}</strong> ({editando.fonteCatalogo}): é por ele que a
					importação acha este filamento. Não é editável.
				</p>
			{/if}

			<!--
				O custo de filamento de cada impressão foi fixado com o preço deste rolo.
				Sem impressão nenhuma não há o que recalcular, e a pergunta não aparece.
			-->
			{#if editando.impressoes > 0}
				<label class="crt-opcao">
					<input type="checkbox" name="recalcular" />
					<span>
						Recalcular o custo {editando.impressoes === 1
							? 'da impressão'
							: `das ${editando.impressoes} impressões`} deste filamento
						<small class="crt-dica">
							Usa este cadastro, a tarifa e o horímetro de hoje. Marque para corrigir erro de
							digitação; deixe em branco se o rolo custou isso mesmo.
						</small>
					</span>
				</label>
			{/if}

			<div class="crt-acoes">
				<button class="acao acao--sinal" type="submit">Salvar correção</button>
				<a class="acao acao--fantasma" href="/rolos">Cancelar</a>
				<a class="acao acao--perigo acao--fim" href="/rolos?excluir={editando.id}">
					<Icone nome="excluir" tamanho={18} />Excluir
				</a>
			</div>
		</form>

		{#if editando.afericoes.length > 0}
			<div class="crt-corpo rolo-detalhe__bloco">
				<h3><Icone nome="pesar" />Pesagens registradas</h3>
				<div class="crt-rolagem">
					<table>
						<thead>
							<tr>
								<th scope="col">quando</th>
								<th class="crt-num" scope="col">peso líquido</th>
								<th scope="col">observação</th>
								<th scope="col" aria-label="ações"></th>
							</tr>
						</thead>
						<tbody>
							{#each editando.afericoes as a (a.id)}
								<tr>
									<td>{dataHora(a.dataEm)}</td>
									<td class="crt-num"><strong>{comUnidade(a.pesoLiquidoG, 'g', 0)}</strong></td>
									<td>{a.observacao ? inicial(a.observacao.replaceAll(' · ', ', ')) : '—'}</td>
									<td class="crt-num">
										<a class="acao acao--miuda acao--perigo" href="/rolos?editar={editando.id}&excluirPesagem={a.id}">
											<Icone nome="excluir" tamanho={16} />Apagar
										</a>
									</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
				<p class="nota">O saldo parte da primeira da lista. Apagar uma pesagem errada devolve a base para a anterior.</p>
			</div>
		{/if}
	</section>
{/if}

{#snippet ficha(r: {
	precoPagoCents: number;
	pesoLiquidoInicialG: number;
	pesoCarretelG: number;
	densidade: number;
	tempBico: number | null;
	tempMesa: number | null;
	codigoBambu: string | null;
	apelido: string | null;
	fornecedor: string | null;
	dataCompra: Date | null;
	dataAbertura: Date | null;
	dataUltimaSecagem: Date | null;
})}
	<dl class="ficha">
		<div><dt>Preço pago</dt><dd>{reais(r.precoPagoCents)}</dd></div>
		{#if r.pesoLiquidoInicialG > 0}
			<div>
				<dt>Custo por kg</dt>
				<dd>{reais(Math.round((r.precoPagoCents / r.pesoLiquidoInicialG) * 1000))}</dd>
			</div>
		{/if}
		<div><dt>Carretel vazio</dt><dd>{comUnidade(r.pesoCarretelG, 'g', 0)}</dd></div>
		<div><dt>Bico</dt><dd>{r.tempBico ? `${r.tempBico} °C` : 'não informado'}</dd></div>
		<div><dt>Mesa</dt><dd>{r.tempMesa ? `${r.tempMesa} °C` : 'não informada'}</dd></div>
		<div><dt>Densidade</dt><dd>{numero(r.densidade, 2)} g/cm³</dd></div>
		{#if r.dataCompra}<div><dt>Comprado em</dt><dd>{dataCurta(r.dataCompra)}</dd></div>{/if}
		{#if r.dataAbertura}<div><dt>Aberto em</dt><dd>{dataCurta(r.dataAbertura)}</dd></div>{/if}
		{#if r.dataUltimaSecagem}<div><dt>Seco em</dt><dd>{dataCurta(r.dataUltimaSecagem)}</dd></div>{/if}
		{#if r.fornecedor}<div><dt>Fornecedor</dt><dd>{r.fornecedor}</dd></div>{/if}
		{#if r.apelido}<div><dt>Apelido</dt><dd>{r.apelido}</dd></div>{/if}
		{#if r.codigoBambu}<div><dt>Código Bambu</dt><dd>{r.codigoBambu}</dd></div>{/if}
	</dl>
{/snippet}

<!-- A foto do catálogo, quando existe: é a imagem do PRODUTO, à parte da figura do rolo.
     Se o arquivo não abrir, o bloco some e a figura do rolo continua respondendo pela cor. -->
{#snippet fotoDoCatalogo(r: { imagemUrl?: string; marca: string; material: string; cor: string })}
	{#if r.imagemUrl}
		<figure class="foto-catalogo">
			<img
				src={r.imagemUrl}
				alt="{r.marca} {r.material} {r.cor}, imagem do catálogo"
				loading="lazy"
				referrerpolicy="no-referrer"
				onerror={(e) => ((e.currentTarget as HTMLImageElement).closest('figure')!.hidden = true)}
			/>
			<figcaption>Imagem do catálogo</figcaption>
		</figure>
	{/if}
{/snippet}

<div class="lista-detalhe" class:lista-detalhe--aberto={temDetalhe}>
	{#if temDetalhe}
		<aside class="lista-detalhe__detalhe" aria-label="Detalhes do filamento">
			{#each data.ativos.filter((r) => r.id === data.detalheId || !!erroDaPesagem(r.id)) as r (r.id)}
				{@const carregado = data.carregados.find((c) => c.roloId === r.id)}
				<section class="folha rolo-detalhe" id="detalhe-rolo" aria-labelledby="nome-do-rolo-{r.id}">
					<div class="rolo-detalhe__topo">
						<a class="voltar" href="/rolos"><Icone nome="voltar" tamanho={16} />Todos os filamentos</a>
					</div>

					<div class="rolo-detalhe__cabeca">
						<FiguraRolo cor={r.corHex} fracao={fracaoNaRegua(r.estoque.restanteG, regua)} />
						<div class="rolo-detalhe__id">
							<h2 id="nome-do-rolo-{r.id}"><b>{r.material}</b> {r.cor}</h2>
							<p>{r.marca}</p>
							<p class="rolo-detalhe__marcas">
								<span class="etiqueta">{r.codigo}</span>
								<span class="chip">
									{#if r.status === 'fechado'}<Icone nome="lacrado" tamanho={14} />{/if}{inicial(
										STATUS_ROLO[r.status] ?? r.status
									)}
								</span>
							</p>
							<p class="rolo-detalhe__saldo">
								<strong class="num">{gramasDeSaldo(r.estoque.restanteG)}</strong><span class="num">g</span>
								{#if r.pesoLiquidoInicialG > 0}
									<small>
										de {pesoCurto(r.pesoLiquidoInicialG)}, {numero(r.estoque.percentual * 100, 0)}%
									</small>
								{/if}
							</p>
							<p class="nota">
								{#if r.estoque.baseEm}
									Pesado em {dataCurta(r.estoque.baseEm)}
								{:else}
									Nunca pesado: o saldo é a estimativa do fatiador
								{/if}
							</p>
						</div>
					</div>

					<!-- Os avisos deste rolo, cada um com a ação que o resolve. -->
					{#each r.alertas as a (a.tipo)}
						<div class="aviso-faixa aviso-faixa--{a.tipo}">
							<Icone nome={ICONE_DO_ALERTA[a.tipo] ?? 'alerta'} tamanho={22} />
							{#if a.tipo === 'acabando'}
								<p><strong>Acabando.</strong> Pese para confirmar quanto ainda há no carretel.</p>
								<a class="acao acao--miuda" href="#pesar">Pesar</a>
							{:else if a.tipo === 'umidade'}
								<p>
									<strong>Pode estar úmido.</strong>
									{#if r.diasSemSecar == null}
										Seque antes de usar.
									{:else if r.secagemRegistrada}
										A última secagem foi há {r.diasSemSecar} dias; seque antes de usar.
									{:else}
										Aberto há {r.diasSemSecar} dias, sem secagem registrada; seque antes de usar.
									{/if}
								</p>
								<form method="POST" action="?/secar" use:enhance>
									<input type="hidden" name="id" value={r.id} />
									<button class="acao acao--miuda" type="submit">Registrar secagem</button>
								</form>
							{:else}
								<p><strong>{ALERTA[a.tipo] ?? a.tipo}</strong></p>
							{/if}
						</div>
					{/each}

					<!-- Pesar: a operação de rotina deste rolo, sempre à mão. -->
					<form class="rolo-detalhe__bloco" id="pesar" method="POST" action="?/aferir" use:enhance>
						<h3><Icone nome="pesar" tamanho={20} />Pesar</h3>
						<input type="hidden" name="envio" value={data.envio} />
						<input type="hidden" name="roloId" value={r.id} />
						<div class="rolo-detalhe__dupla">
							<div class="crt-campo">
								<label class="rotulo" for="bruto-{r.id}">Rolo inteiro na balança (g)</label>
								<input
									id="bruto-{r.id}"
									name="pesoBrutoG"
									type="text"
									inputmode="decimal"
									value={erroDaPesagem(r.id) ? (digitado.pesoBrutoG ?? '') : ''}
									aria-invalid={erroDaPesagem(r.id)?.campo === 'pesoBrutoG' ? 'true' : undefined}
									aria-describedby="bruto-{r.id}-dica"
									oninput={(e) => converterDoBruto(r, e.currentTarget.value)}
								/>
								<span class="crt-dica" id="bruto-{r.id}-dica">
									com o carretel de {comUnidade(r.pesoCarretelG, 'g', 0)}
								</span>
							</div>
							<div class="crt-campo">
								<label class="rotulo" for="pesar-{r.id}">ou só o filamento (g)</label>
								<input
									id="pesar-{r.id}"
									name="pesoLiquidoG"
									type="text"
									inputmode="decimal"
									value={erroDaPesagem(r.id) ? (digitado.pesoLiquidoG ?? '') : ''}
									aria-invalid={erroDaPesagem(r.id)?.campo === 'pesoLiquidoG' ? 'true' : undefined}
									aria-describedby="pesar-{r.id}-dica"
									oninput={(e) => converterDoLiquido(r, e.currentTarget.value)}
								/>
								<span class="crt-dica" id="pesar-{r.id}-dica">calculado a partir do rolo inteiro</span>
							</div>
						</div>
						<label class="crt-opcao">
							<input type="checkbox" class="check-quadrado" name="ajustarInicial" />
							<span>Ajustar o peso inicial se a pesagem passar dele</span>
						</label>
						{#if erroDaPesagem(r.id)}
							<p class="cadastro-erro" role="alert">{frase(erroDaPesagem(r.id)?.mensagem ?? '')}</p>
						{/if}
						<button class="acao acao--sinal" type="submit">Registrar pesagem</button>
					</form>

					<!-- Na impressora: onde este rolo está, e pôr ou tirar. -->
					<div class="rolo-detalhe__bloco">
						<h3><Icone nome="impressoras" tamanho={20} />Na impressora</h3>
						{#if carregado}
							<form class="rolo-detalhe__linha" method="POST" action="?/desativar" use:enhance>
								<input type="hidden" name="impressoraId" value={carregado.impressoraId} />
								<input type="hidden" name="posicao" value={carregado.posicao} />
								<p>
									Carregado em
									<strong>
										{data.impressoras.find((i) => i.id === carregado.impressoraId)?.nome ?? 'impressora'}
									</strong>, posição {carregado.posicao}.
								</p>
								<button class="acao acao--miuda" type="submit">
									<Icone nome="retirar" tamanho={16} />Retirar
								</button>
							</form>
						{:else if data.impressoras.length === 0}
							<p class="nota"><a href="/impressoras">Cadastre uma impressora</a> para carregar este rolo.</p>
						{:else}
							<form class="rolo-detalhe__carregar" method="POST" action="?/ativar" use:enhance>
								<input type="hidden" name="roloId" value={r.id} />
								{#if data.impressoras.length > 1}
									<label class="campo">
										Impressora
										<select name="impressoraId">
											{#each data.impressoras as i (i.id)}<option value={i.id}>{i.nome}</option>{/each}
										</select>
									</label>
								{:else}
									<input type="hidden" name="impressoraId" value={data.impressoras[0].id} />
								{/if}
								<fieldset class="posicoes">
									<legend>Posição</legend>
									{#each [1, 2, 3, 4] as n (n)}
										{@const ocupante = data.carregados.find(
											(c) => c.posicao === n && c.impressoraId === data.impressoras[0].id
										)}
										<label title={ocupante ? 'Ocupada: carregar aqui troca o rolo' : undefined}>
											<input type="radio" name="posicao" value={n} checked={n === 1} />
											<span>{n}{#if ocupante}<i class="so-leitor"> (ocupada)</i>{/if}</span>
										</label>
									{/each}
								</fieldset>
								<button class="acao acao--miuda" type="submit">
									<Icone nome="carregar" tamanho={16} />Carregar
								</button>
							</form>
						{/if}
					</div>

					<div class="rolo-detalhe__acoes">
						{#if r.status === 'fechado'}
							<form method="POST" action="?/abrir" use:enhance>
								<input type="hidden" name="id" value={r.id} />
								<button class="acao" type="submit">Abrir o lacre</button>
							</form>
						{/if}
						{#if !r.alertas.some((a) => a.tipo === 'umidade')}
							<form method="POST" action="?/secar" use:enhance>
								<input type="hidden" name="id" value={r.id} />
								<button class="acao" type="submit"><Icone nome="secar" tamanho={18} />Registrar secagem</button>
							</form>
						{/if}
						<a class="acao" href="/rolos?editar={r.id}"><Icone nome="editar" tamanho={18} />Editar</a>
						<a class="acao" href="/rolos?encerrar={r.id}"><Icone nome="encerrar" tamanho={18} />Encerrar</a>
					</div>

					{@render ficha(r)}
					{#if r.notas}<p class="rolo-detalhe__notas">{r.notas}</p>{/if}
					{@render fotoDoCatalogo(r)}
					<p><a class="crt-link" href="/impressoes?rolo={r.id}">Ver as impressões deste rolo</a></p>
				</section>
			{/each}

			{#each data.encerrados.filter((r) => r.id === data.detalheId) as r (r.id)}
				<section class="folha rolo-detalhe" id="detalhe-rolo" aria-labelledby="nome-do-rolo-{r.id}">
					<div class="rolo-detalhe__topo">
						<a class="voltar" href="/rolos"><Icone nome="voltar" tamanho={16} />Todos os filamentos</a>
					</div>
					<div class="rolo-detalhe__cabeca">
						<FiguraRolo cor={r.corHex} fracao={fracaoNaRegua(r.estoque.restanteG, regua)} />
						<div class="rolo-detalhe__id">
							<h2 id="nome-do-rolo-{r.id}"><b>{r.material}</b> {r.cor}</h2>
							<p>{r.marca}</p>
							<p class="rolo-detalhe__marcas">
								<span class="etiqueta">{r.codigo}</span>
								<span class="chip"><Icone nome="encerrar" tamanho={14} />{inicial(STATUS_ROLO[r.status] ?? r.status)}</span>
							</p>
							<p class="rolo-detalhe__saldo">
								<strong class="num">{gramasDeSaldo(r.estoque.restanteG)}</strong><span class="num">g</span>
								{#if r.pesoLiquidoInicialG > 0}<small>de sobra, de {pesoCurto(r.pesoLiquidoInicialG)}</small>{/if}
							</p>
						</div>
					</div>

					<div class="rolo-detalhe__bloco">
						<h3><Icone nome="pesar" tamanho={20} />Estimativa e balança</h3>
						{#if r.rendimento.ok}
							{@const rend = r.rendimento.rendimento}
							<dl class="ficha">
								<div><dt>Sobra estimada</dt><dd>{comUnidade(rend.estimadaG, 'g', 1)}</dd></div>
								<div><dt>Sobra na balança</dt><dd>{comUnidade(rend.realG, 'g', 1)}</dd></div>
								<div>
									<dt>Diferença</dt>
									<dd>{rend.diferencaG > 0 ? '+' : ''}{comUnidade(rend.diferencaG, 'g', 1)}</dd>
								</div>
							</dl>
							<p class="nota">{fraseDoRendimento(rend)}</p>
							{#if !rend.relevante}
								<Estado estado="atencao" nome="rolo pequeno demais para tirar conclusão" />
								<p class="nota">
									Com {comUnidade(r.pesoLiquidoInicialG, 'g', 0)} de rolo, essa diferença cabe no erro da
									balança e na purga do bico.
								</p>
							{/if}
						{:else if r.rendimento.motivo === 'sem-pesagem'}
							<p class="nota">
								Encerrado sem pesagem final: não dá para dizer quanto este rolo rendeu contra a
								estimativa do fatiador. Pesar antes de encerrar é a única hora em que as duas contas
								se encontram.
							</p>
						{:else}
							<p class="nota">
								Este filamento voltou a imprimir depois da última pesagem, então a comparação ficou
								para trás. Pese de novo e encerre para ter o número deste ciclo.
							</p>
						{/if}
					</div>

					<div class="rolo-detalhe__acoes">
						<a class="acao" href="/rolos?reabrir={r.id}"><Icone nome="reabrir" tamanho={18} />Reabrir</a>
						<a class="acao" href="/rolos?editar={r.id}"><Icone nome="editar" tamanho={18} />Editar</a>
					</div>
					{@render ficha(r)}
					{#if r.notas}<p class="rolo-detalhe__notas">{r.notas}</p>{/if}
					{@render fotoDoCatalogo(r)}
					<p><a class="crt-link" href="/impressoes?rolo={r.id}">Ver as impressões deste rolo</a></p>
				</section>
			{/each}
		</aside>
	{/if}
	<div class="lista-detalhe__lista">
		<EstoqueFilamentos rolos={emEstoque} historico={data.encerrados} impressoras={data.impressoras} carregados={data.carregados} detalheId={data.detalheId} {regua} />
	</div>
</div>
