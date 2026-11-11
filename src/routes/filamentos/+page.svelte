<!--
	Nunca renderiza: o `load` redireciona para /rolos antes. Existe porque o
	SvelteKit exige um `+page.svelte` ao lado de um `+page.server.ts`, e o
	redirecionamento precisa acontecer no servidor para valer também sem
	JavaScript.
-->
<p>Redirecionando para os filamentos…</p>
