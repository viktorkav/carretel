<script lang="ts">
	import '../app.css';
	import favicon from '$lib/assets/favicon.svg';
	import { page } from '$app/state';
	import { tick } from 'svelte';
	import { afterNavigate, onNavigate } from '$app/navigation';
	import Icone from '$lib/componentes/Icone.svelte';
	import Marca from '$lib/componentes/Marca.svelte';
	import type { NomeIcone } from '$lib/icones';

	let { children } = $props();

	// "Filamentos" apontando para /rolos não é descuido. A entidade é o ROLO —
	// é o que tem preço, peso e código escrito no carretel —, mas a palavra que
	// o dono usa é "filamento", e foi na tela com esse nome que ele foi procurar
	// o preço. O código fala `rolo`, a interface fala filamento, e /filamentos
	// redireciona para cá.
	//
	// Os três primeiros são o dia a dia e ficam na barra do celular; os outros
	// três são de vez em quando e, no celular, moram em "Mais".
	const secoes: { href: string; nome: string; icone: NomeIcone; raro?: boolean }[] = [
		{ href: '/', nome: 'Início', icone: 'inicio' },
		{ href: '/impressoes', nome: 'Impressões', icone: 'impressoes' },
		{ href: '/rolos', nome: 'Filamentos', icone: 'filamentos' },
		{ href: '/impressoras', nome: 'Impressoras', icone: 'impressoras', raro: true },
		{ href: '/importar', nome: 'Importar', icone: 'importar', raro: true },
		{ href: '/config', nome: 'Configurações', icone: 'config', raro: true }
	];
	const diarias = secoes.filter((s) => !s.raro);
	const raras = secoes.filter((s) => s.raro);

	// A raiz casa com tudo em `startsWith`, então ela é comparada inteira. Sem
	// isso, "Início" ficaria marcado como atual em todas as telas.
	const atual = $derived(page.url.pathname);
	const ehAtual = $derived((href: string) =>
		href === '/' ? atual === '/' : atual === href || atual.startsWith(href + '/')
	);

	// A ação principal do produto mora na doca, sempre no mesmo lugar. Na
	// própria tela de registro ela não é link para si mesma: vira o estado
	// "você está aqui", e não entra como destino atual de "Impressões".
	const registrando = $derived(atual === '/impressoes/nova');
	const destinoAtual = $derived((href: string) => (registrando ? false : ehAtual(href)));
	const emRara = $derived(raras.some((s) => destinoAtual(s.href)));

	// "Mais", no celular: fecha ao navegar, ao tocar fora e com Esc.
	let mais = $state<HTMLDetailsElement>();
	function fecharMais(devolverFoco = false) {
		if (!mais?.open) return;
		mais.open = false;
		if (devolverFoco) mais.querySelector('summary')?.focus();
	}
	afterNavigate(() => fecharMais());

	// Trocar de tela com um esmaecer curto do palco (a doca fica parada), quando
	// o navegador sabe fazer isso e a pessoa não pediu menos movimento. Mudança
	// dentro da mesma tela (outro período, outro rolo aberto) não anima: ali o
	// que muda é um pedaço, e esmaecer a tela inteira só atrasaria a leitura.
	onNavigate((navegacao) => {
		if (!document.startViewTransition) return;
		if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
		if (navegacao.from?.route.id === navegacao.to?.route.id) return;
		return new Promise((resolver) => {
			document.startViewTransition(async () => {
				resolver();
				await navegacao.complete;
			});
		});
	});

	/**
	 * Trava visual do botão enviado — e **só** visual.
	 *
	 * Quem garante que dois toques não viram dois registros é o servidor (ver
	 * `$lib/server/envio`); isto aqui existe para o dedo receber resposta nos
	 * um a dois segundos em que a tela fica parada, que é o que faz alguém
	 * tocar de novo. Com o JavaScript desligado nada disto roda, e nada se
	 * perde: a trava que conta continua de pé.
	 *
	 * O `setTimeout(…, 0)` não é superstição: desabilitar o botão DENTRO do
	 * handler de submit pode tirar o `formaction` (`?/aferir`) do envio, porque
	 * é o botão que carrega o alvo da action. Deixando para o tique seguinte, a
	 * requisição já saiu com tudo.
	 */
	const TRAVADO = 'data-travado';
	/** Formulários enviados cuja resposta ainda não chegou. */
	const emEnvio = new Set<HTMLFormElement>();
	function travarEnviado(evento: SubmitEvent) {
		const formulario = evento.target;
		if (!(formulario instanceof HTMLFormElement) || formulario.hasAttribute('data-envio-local')) return;
		emEnvio.add(formulario);
		setTimeout(() => {
			// Um envio que terminou antes deste tique não trava: filtrar de novo com
			// os mesmos valores não busca nada, e a trava chegaria depois do fim.
			if (!emEnvio.has(formulario) || !formulario.isConnected) return;
			formulario.setAttribute('aria-busy', 'true');
			formulario.setAttribute(TRAVADO, '');
			for (const b of formulario.querySelectorAll<HTMLButtonElement>(
				'button[type="submit"], button:not([type])'
			)) {
				// Só o que ESTA trava desabilitou volta depois; um botão que já estava
				// desabilitado por outro motivo continua como estava.
				if (b.disabled) continue;
				b.disabled = true;
				b.setAttribute(TRAVADO, '');
			}
		}, 0);
	}

	/**
	 * A trava sai quando o envio termina.
	 *
	 * Ela era posta e nunca tirada: um formulário que continua na tela depois
	 * da resposta (pesagem recusada, correção recusada, custo salvo, filtro)
	 * ficava com o botão morto, e a pessoa corrigia o campo sem ter como enviar
	 * de novo. O fim de um envio aparece de três jeitos — a resposta da action
	 * (`page.form`), os dados recarregados (`page.data`) ou uma navegação — e
	 * qualquer um deles devolve os botões.
	 */
	function destravarEnviados() {
		emEnvio.clear();
		for (const f of document.querySelectorAll(`form[${TRAVADO}]`)) {
			f.removeAttribute('aria-busy');
			f.removeAttribute(TRAVADO);
			for (const b of f.querySelectorAll<HTMLButtonElement>(`button[${TRAVADO}]`)) {
				b.disabled = false;
				b.removeAttribute(TRAVADO);
			}
		}
	}
	$effect(() => {
		void page.form;
		void page.data;
		void page.status;
		void page.url;
		destravarEnviados();
	});
	afterNavigate(() => destravarEnviados());

	/**
	 * Uma recusa é dita onde ela se resolve.
	 *
	 * O envio é recusado com a pessoa lá embaixo, no botão; a mensagem ficava no
	 * topo, fora da tela, e nada parecia ter acontecido. Agora o foco vai para o
	 * campo marcado (abrindo a gaveta em que ele estiver), que tem a mensagem
	 * logo abaixo — e a folha de estilo tira a faixa do topo nesse caso, para a
	 * recusa não ser dita duas vezes. Sem campo marcado, o foco vai para a faixa.
	 * Sem script nada disso roda: a página chega pelo topo, com a faixa lá.
	 */
	let recusaJaMostrada: unknown = null;
	async function mostrarRecusa() {
		// A resposta chega à página em dois tempos (o `form` é esvaziado e depois
		// preenchido), então o campo marcado pode ainda não estar no documento no
		// primeiro quadro: espera-se por ele alguns quadros, não para sempre.
		for (let quadro = 0; quadro < 8; quadro += 1) {
			await tick();
			await new Promise((r) => requestAnimationFrame(r));
			const palco = document.getElementById('conteudo');
			const campo = palco?.querySelector<HTMLElement>('[aria-invalid="true"]');
			const alvo = campo ?? palco?.querySelector<HTMLElement>('.retorno--falha');
			if (!alvo) continue;
			for (let d = alvo.closest('details'); d; d = d.parentElement?.closest('details') ?? null) {
				d.open = true;
			}
			if (!campo) alvo.tabIndex = -1;
			alvo.focus({ preventScroll: true });
			alvo.scrollIntoView({
				block: 'center',
				behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth'
			});
			return;
		}
	}
	$effect(() => {
		document.documentElement.dataset.js = '';
		const retorno = page.form as { erro?: unknown } | null;
		if (!retorno || typeof retorno.erro !== 'string' || retorno === recusaJaMostrada) return;
		recusaJaMostrada = retorno;
		void mostrarRecusa();
	});
</script>

<svelte:window
	onsubmitcapture={travarEnviado}
	onkeydown={(e) => {
		if (e.key === 'Escape') fecharMais(true);
	}}
	onpointerdown={(e) => {
		if (mais && e.target instanceof Node && !mais.contains(e.target)) fecharMais();
	}}
/>

<svelte:head>
	<link rel="icon" href={favicon} />
	<title>Carretel</title>
</svelte:head>

<!--
	Duas regiões: a doca e o palco. A doca é a mesma lista nos dois tamanhos; o
	que muda é onde ela fica (de pé à esquerda, deitada embaixo) e que, no
	celular, a ação de registrar entra no meio e os três destinos raros vão para
	"Mais". Cada variante só existe no tamanho dela (`so-largo`, `so-estreito`),
	então a ordem do Tab é sempre a ordem do que se vê.
-->
<a class="pular-conteudo" href="#conteudo">Pular para o conteúdo</a>
<div class="app">
	<header class="doca">
		<a class="doca__marca so-largo" href="/" aria-label="Carretel, início"><Marca /></a>
		<a
			class="doca__registrar so-largo"
			href="/impressoes/nova"
			aria-current={registrando ? 'page' : undefined}
		>
			<span class="doca__botao"><Icone nome="registrar" tamanho={26} /></span>
			Registrar impressão
		</a>
		<nav class="doca__nav" aria-label="Seções do Carretel">
			{#each diarias as s, n (s.href)}
				{#if n === 2}
					<a
						class="doca__registrar so-estreito"
						href="/impressoes/nova"
						aria-current={registrando ? 'page' : undefined}
					>
						<span class="doca__botao"><Icone nome="registrar" tamanho={26} /></span>
						<span class="so-leitor">Registrar impressão</span>
					</a>
				{/if}
				<a class="doca__item" href={s.href} aria-current={destinoAtual(s.href) ? 'page' : undefined}>
					<Icone nome={s.icone} tamanho={24} />{s.nome}
				</a>
			{/each}
			{#each raras as s, n (s.href)}
				<a
					class="doca__item so-largo"
					class:doca__item--fim={n === raras.length - 1}
					href={s.href}
					aria-current={destinoAtual(s.href) ? 'page' : undefined}
				>
					<Icone nome={s.icone} tamanho={24} />{s.nome}
				</a>
			{/each}
			<details class="doca__mais so-estreito" class:doca__mais--atual={emRara} bind:this={mais}>
				<summary class="doca__item"><Icone nome="mais" tamanho={24} />Mais</summary>
				<div class="doca__menu">
					{#each raras as s (s.href)}
						<a href={s.href} aria-current={destinoAtual(s.href) ? 'page' : undefined}>
							<Icone nome={s.icone} tamanho={22} />{s.nome}
						</a>
					{/each}
				</div>
			</details>
		</nav>
	</header>

	<main class="palco" id="conteudo" tabindex="-1">
		{@render children()}
	</main>
</div>
