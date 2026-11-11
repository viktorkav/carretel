<script lang="ts">
 import { enhance } from '$app/forms';
 import { invalidateAll } from '$app/navigation';
 import { tick, untrack } from 'svelte';
 import type { SubmitFunction } from '@sveltejs/kit';
 import type { ItemCatalogo } from '$lib/catalogo/busca';
 import CadastroFilamento from './CadastroFilamento.svelte';
 import EscolherFilamento from './EscolherFilamento.svelte';
 import FiguraRolo from './FiguraRolo.svelte';
 import Icone from './Icone.svelte';
 import { pesoCurto } from '$lib/figura-rolo';
 import { FINALIDADES } from '$lib/finalidade';
 import { FINALIDADE, comUnidade, dataHora, duracaoCurta, frase, inicial, massa, reais } from '$lib/formato';
 import { ICONE_DA_FINALIDADE, ICONE_DO_STATUS, type NomeIcone } from '$lib/icones';
 import { preverSaldo, type BaseDaPrevia } from '$lib/previa-saldo';

 /** O que a action `criar` devolve no sucesso: o registro gravado e o saldo do rolo antes e depois. */
 type Registro = { id: number; nomeLivre: string; gramas: number; duracaoS: number; status: string; finalidade: string; custoFilamentoCents: number; custoEnergiaCents: number; custoDepreciacaoCents: number; custoManutencaoCents: number; custoTotalCents: number };
 type Saldo = { roloId: number; codigo: string; marca: string; material: string; cor: string; corHex: string | null; pesoLiquidoInicialG: number; antesG: number; depoisG: number; entrouNoSaldo?: boolean; inicioEm?: number; pesagemEm?: number | null };
 type Resposta = { erro?: string; campo?: string; valores?: Record<string, string>; sucesso?: boolean; aviso?: string; registro?: Registro; saldo?: Saldo | null };
 let { data, form }: { data: {
  envio: string; envioFilamento: string; itens: ItemCatalogo[];
  carregados: {impressoraId:number;roloId:number;posicao:number}[];
  impressoras: { id: number; nome: string }[];
  rolos: { id: number; codigo: string; marca: string; material: string; cor: string; corHex: string | null; restanteG: number; precoPagoCents: number; pesoLiquidoInicialG: number; previa: BaseDaPrevia; pesagemTexto: string | null }[];
 }; form?: Resposta | null } = $props();
 function sugerido(impressora: string) { const ativos = data.carregados.filter(a => String(a.impressoraId) === impressora); return ativos.length === 1 ? String(ativos[0].roloId) : ''; }
 let valores = $state({ nomeLivre: '', impressoraId: untrack(() => data.impressoras.length === 1 ? String(data.impressoras[0].id) : ''), roloId: untrack(() => data.impressoras.length === 1 ? sugerido(String(data.impressoras[0].id)) : ''), gramas: '', duracao: '', inicioEm: '', status: 'sucesso', motivoFalha: '', camadaMm: '', paredes: '', infillPct: '', finalidade: 'outro', ...untrack(() => form?.valores ?? {}) });
 let resposta = $state<Resposta | null>(untrack(() => form ?? null));
 let enviando = $state(false);
 let aberto = $state(false);
 let dialogo: HTMLDialogElement;
 let tituloResultado = $state<HTMLHeadingElement>();
 let avisoErro = $state<HTMLParagraphElement>();
 const ativos = $derived(data.carregados.filter(a => String(a.impressoraId) === valores.impressoraId));
 const rolosOrdenados = $derived(data.rolos.map(r => ({...r,ativoPosicao:ativos.find(a => a.roloId === r.id)?.posicao})).sort((a,b) => (a.ativoPosicao ?? 99) - (b.ativoPosicao ?? 99)));
 const rolo = $derived(data.rolos.find(r => String(r.id) === valores.roloId));
 const impressora = $derived(data.impressoras.find(i => String(i.id) === valores.impressoraId));
 const gramas = $derived(Number(valores.gramas.replace(',', '.')));
 const gramasValidas = $derived(valores.gramas.trim() !== '' && Number.isFinite(gramas) && gramas > 0);
 const detalhesComErro = $derived(['inicioEm','camadaMm','paredes','infillPct'].includes(resposta?.campo ?? ''));
 // O que falta para o botão valer: dito por extenso, em vez de um botão cinza mudo.
 const pendencia = $derived(!data.impressoras.length ? 'Cadastre uma impressora para registrar.' : !data.rolos.length ? 'Cadastre um filamento para registrar.' : '');
 // Prévia do saldo pela regra do servidor (`$lib/previa-saldo`): só baixa a
 // impressão que começa DEPOIS da última pesagem do rolo. Quando não dá para
 // afirmar daqui, a conferência diz que não sabe em vez de prometer um número.
 const previa = $derived(rolo && gramasValidas ? preverSaldo(rolo.previa, gramas, valores.inicioEm) : null);
 const consumoSuperaSaldo = $derived(!!rolo && previa?.efeito === 'baixa' && rolo.previa.baseG - (rolo.previa.consumidoG + gramas) < 0);
 // O saldo é guardado com uma casa decimal: inteiro aparece sem casas, o resto com uma.
 const g = (v: number) => comUnidade(v, 'g', Number.isInteger(v) ? 0 : 1);
 // O consumo pode ter centésimos (o fatiador informa assim); "0,04 g" não pode virar "0,0 g".
 const gConsumo = (v: number) => massa(v);
 /**
  * Por que o saldo ficou como ficou, na tela de resultado. A causa vem dos
  * dados que o servidor devolve (`entrouNoSaldo`, as duas datas), nunca de
  * "antes é igual a depois": saldo igual também acontece com rolo já em zero
  * e com consumo menor que a precisão do saldo.
  */
 function explicacaoDoSaldo(saldo: Saldo, reg: Registro): string | null {
  if (saldo.entrouNoSaldo === false) {
   if (saldo.inicioEm === undefined || saldo.pesagemEm == null) return 'Esta impressão ficou no histórico e no custo, mas não entrou na conta do saldo deste rolo.';
   return `Esta impressão não baixou o saldo: o início dela (${dataHora(saldo.inicioEm)}) não é posterior à última pesagem do rolo (${dataHora(saldo.pesagemEm)}), e o saldo parte sempre da pesagem mais recente. Ela continua no histórico e no custo.`;
  }
  if (saldo.entrouNoSaldo === true && saldo.antesG === saldo.depoisG) {
   if (saldo.antesG === 0) return `O rolo já estava em 0 g, e o saldo não fica abaixo de zero. O consumo de ${gConsumo(reg.gramas)} foi registrado e entra no custo. Se ainda há filamento no carretel, pese o rolo para corrigir o saldo.`;
   return `O consumo de ${gConsumo(reg.gramas)} é menor que a precisão do saldo, que é guardado com uma casa decimal. Ele foi registrado e entra na conta do rolo.`;
  }
  if (saldo.entrouNoSaldo === true && saldo.depoisG === 0 && reg.gramas > saldo.antesG) return `O consumo registrado (${gConsumo(reg.gramas)}) é maior que o saldo que havia (${g(saldo.antesG)}). O saldo não fica abaixo de zero; se ainda há filamento no carretel, pese o rolo.`;
  if (saldo.antesG === saldo.depoisG) return 'O saldo deste rolo não mudou com este registro.';
  return null;
 }
 // As recusas do servidor vêm em caixa baixa ("gramas é obrigatório"); na tela a frase começa com maiúscula.
 const mensagemErro = $derived(resposta?.erro ? frase(resposta.erro) : '');
 const fracao = (g: number, total: number) => total > 0 ? Math.min(1, Math.max(0, g / total)) : null;
 // O rolo desenhado na conferência já aparece como vai ficar: no nível de depois, quando a impressão baixa o saldo.
 const fracaoNaConferencia = $derived(rolo ? fracao(previa?.efeito === 'baixa' ? previa.depoisG : rolo.restanteG, rolo.pesoLiquidoInicialG) : null);
 const RESULTADOS: { valor: string; nome: string }[] = [{ valor: 'sucesso', nome: 'Concluída' }, { valor: 'falha', nome: 'Falhou' }, { valor: 'cancelada', nome: 'Cancelada' }];
 /** As parcelas do custo que o servidor devolveu, com o ícone de cada uma. Parcela zerada não vira linha. */
 function parcelasDe(reg: Registro): { nome: string; detalhe?: string; icone: NomeIcone; cents: number }[] {
  return [
   { nome: 'Filamento', detalhe: gConsumo(reg.gramas), icone: 'filamentos' as const, cents: reg.custoFilamentoCents },
   { nome: 'Energia', detalhe: duracaoCurta(reg.duracaoS), icone: 'energia' as const, cents: reg.custoEnergiaCents },
   { nome: 'Máquina', icone: 'impressoras' as const, cents: reg.custoDepreciacaoCents },
   { nome: 'Manutenção', icone: 'manutencao' as const, cents: reg.custoManutencaoCents }
  ].filter((p, n) => n === 0 || p.cents > 0);
 }
 // A recusa vale para o que foi enviado. Assim que a pessoa mexe no campo
 // recusado, a mensagem e a marca de inválido saem: erro velho ao lado de
 // valor novo é um estado que não existe.
 function limparErro(evento: Event) {
  const alvo = evento.target;
  if (!resposta?.erro || !(alvo instanceof HTMLElement)) return;
  if (!resposta.campo || alvo.getAttribute('name') === resposta.campo) resposta = null;
 }
 async function abrirCadastro() { aberto = true; await tick(); dialogo.showModal(); }
 async function cadastrado(id: number) { await invalidateAll(); valores.roloId = String(id); dialogo.close(); }
 // A recusa é dita uma vez. Quando o campo recusado está na tela com a
 // mensagem ao lado, é lá que ela fica — e a do topo do formulário sai. Só
 // vale com script: sem ele a página volta do servidor pelo topo, e é lá que
 // a mensagem precisa estar.
 let recusaNoCampo = $state(false);
 const salvar: SubmitFunction = () => {
  enviando = true; resposta = null; recusaNoCampo = false;
  return async ({ result }) => {
   enviando = false;
   if (result.type === 'success' || result.type === 'failure') resposta = result.data as Resposta;
   else resposta = { erro: 'Não foi possível registrar. Confira sua conexão e tente novamente.' };
   // Toda recusa com campo tem a mensagem ao lado dele; a do topo já nasce
   // fora, para não piscar. Se o campo não estiver na tela, ela volta.
   recusaNoCampo = !!resposta?.erro && !!resposta.campo;
   // O foco acompanha o que mudou na tela: o título do resultado, ou o
   // primeiro campo recusado (e, sem campo, a própria mensagem de erro).
   await tick();
   if (resposta?.sucesso) tituloResultado?.focus();
   else if (resposta?.erro) {
    const campo = resposta.campo ? document.querySelector<HTMLElement>(`.registro [name="${resposta.campo}"]`) : null;
    const aoLado = !!campo && !!document.querySelector(`.registro [data-recusa="${resposta.campo}"]`);
    if (recusaNoCampo !== aoLado) { recusaNoCampo = aoLado; await tick(); }
    const alvo = campo ?? avisoErro;
    // Ao centro da janela, e não na borda: no celular a doca cobre o pé da tela.
    alvo?.focus({ preventScroll: true });
    alvo?.scrollIntoView({ block: 'center', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
   }
  };
 };
</script>

<!-- A recusa do servidor, repetida junto do campo que a causou: a do topo pode estar fora da tela. -->
{#snippet erroDo(campo: string)}{#if resposta?.erro && resposta.campo === campo}<span class="crt-erro" id="erro-{campo}" data-recusa={campo}>{mensagemErro}</span>{/if}{/snippet}

{#if resposta?.sucesso}
 {@const reg = resposta.registro}
 {@const saldo = resposta.saldo}
 <!--
  O resultado: o que custou e como o rolo ficou. Os números são os que o
  servidor devolveu; nada aqui é refeito no navegador.
 -->
 <section class="recibo" aria-labelledby="titulo-resultado">
  <header class="recibo__topo">
   <p class="recibo__status" role="status"><Icone nome="sucesso" tamanho={22} />Impressão registrada</p>
   <h2 id="titulo-resultado" tabindex="-1" bind:this={tituloResultado}>{reg?.nomeLivre ?? valores.nomeLivre}</h2>
   {#if reg}
    <p class="recibo__meta">
     <span><Icone nome={ICONE_DA_FINALIDADE[reg.finalidade] ?? 'outro'} tamanho={18} />{inicial(FINALIDADE[reg.finalidade] ?? reg.finalidade)}</span>
     <span><Icone nome={ICONE_DO_STATUS[reg.status] ?? 'info'} tamanho={18} />{reg.status === 'sucesso' ? 'Concluída' : reg.status === 'falha' ? 'Falhou' : inicial(reg.status)}</span>
    </p>
   {/if}
   {#if resposta.aviso}<p>{frase(resposta.aviso)}</p>{/if}
  </header>
  {#if reg}
   {@const total = reg.custoTotalCents}
   <div class="recibo__corpo">
    <div class="recibo__parte folha custo">
     <h3 class="so-leitor">Custo desta impressão</h3>
     <p class="custo__total"><strong class="num">{reais(total)}</strong><span>custo total</span></p>
     <ul class="custo__partes custo__partes--recibo">
      {#each parcelasDe(reg) as p (p.nome)}
       <li>
        <Icone nome={p.icone} tamanho={20} />
        <span>{p.nome}{#if p.detalhe}{' '}<small>{p.detalhe}</small>{/if}</span>
        <span class="barra" aria-hidden="true"><span style:width="{total > 0 ? (p.cents / total) * 100 : 0}%"></span></span>
        <strong>{reais(p.cents)}</strong>
       </li>
      {/each}
     </ul>
    </div>
    {#if saldo}
     {@const f = fracao(saldo.depoisG, saldo.pesoLiquidoInicialG)}
     {@const explicacao = explicacaoDoSaldo(saldo, reg)}
     <div class="recibo__parte recibo__rolo-bloco">
      <h3 class="so-leitor">Saldo do rolo</h3>
      <FiguraRolo cor={saldo.corHex} fracao={f} />
      <div class="recibo__rolo-dados">
       <p class="recibo__saldo">{#if saldo.antesG !== saldo.depoisG}<s aria-label="antes: {g(saldo.antesG)}">{g(saldo.antesG)}</s><i aria-hidden="true">→</i>{/if}<span class="num" aria-label="agora: {g(saldo.depoisG)}">{g(saldo.depoisG)}</span>{#if saldo.antesG === saldo.depoisG}<small>sem mudança</small>{/if}</p>
       <p class="recibo__rolo"><span><b>{saldo.material}</b> {saldo.cor}</span><span class="etiqueta">{saldo.codigo}</span></p>
       {#if f !== null}<p class="nota">{g(saldo.depoisG)} de {pesoCurto(saldo.pesoLiquidoInicialG)} neste rolo.</p>{/if}
       {#if explicacao}<p class="recibo__explica">{explicacao}</p>{/if}
      </div>
     </div>
    {/if}
   </div>
  {:else if !resposta.aviso}
   <p>{valores.nomeLivre} já está no seu histórico.</p>
  {/if}
  <div class="recibo__acoes">
   {#if reg}<a class="acao acao--sinal acao--grande" href="/impressoes/{reg.id}"><Icone nome="peca" />Abrir esta impressão</a>{/if}
   <a class="acao {reg ? '' : 'acao--sinal'} acao--grande" href="/impressoes"><Icone nome="impressoes" />Ver impressões</a>
   {#if saldo}<a class="acao acao--grande" href="/rolos?detalhes={saldo.roloId}#detalhe-rolo"><Icone nome="filamentos" />Conferir o rolo</a>{/if}
   <a class="acao acao--fantasma acao--grande" href="/impressoes/nova" data-sveltekit-reload><Icone nome="registrar" />Registrar outra</a>
  </div>
 </section>
{:else}
 <form class="registro" method="POST" action="?/criar" use:enhance={salvar} data-envio-local aria-busy={enviando} oninput={limparErro} onchange={limparErro}>
  <input type="hidden" name="envio" value={data.envio} />
  <div class="registro__campos folha">
   {#if resposta?.erro && !recusaNoCampo}<p class="cadastro-erro" role="alert" tabindex="-1" bind:this={avisoErro}>{mensagemErro}</p>{/if}

   <section class="registro__grupo" aria-labelledby="grupo-peca">
    <h2 class="so-leitor" id="grupo-peca">A peça</h2>
    <div class="registro__dupla">
     <label>Nome da peça<input type="text" name="nomeLivre" bind:value={valores.nomeLivre} placeholder="Ex.: suporte para fone" required aria-invalid={resposta?.campo === 'nomeLivre' ? 'true' : undefined} aria-describedby={resposta?.campo === 'nomeLivre' ? 'erro-nomeLivre' : undefined} />{@render erroDo('nomeLivre')}</label>
     <label>Impressora<select name="impressoraId" bind:value={valores.impressoraId} onchange={(e) => valores.roloId = sugerido(e.currentTarget.value)} required aria-invalid={resposta?.campo === 'impressoraId' ? 'true' : undefined}><option value="">Escolha a impressora</option>{#each data.impressoras as i}<option value={String(i.id)}>{i.nome}</option>{/each}</select>{@render erroDo('impressoraId')}</label>
    </div>
    {#if !data.impressoras.length}<p class="nota">Ainda não há impressora. <a class="crt-link" href="/impressoras">Cadastrar impressora</a></p>{/if}
   </section>

   <section class="registro__grupo">
    <EscolherFilamento rolos={rolosOrdenados} bind:selecionado={valores.roloId} erro={resposta?.campo === 'roloId' ? mensagemErro : undefined} />
    <button type="button" class="acao acao--miuda novo-filamento-inline" onclick={abrirCadastro}><Icone nome="registrar" tamanho={16} />Cadastrar novo filamento</button>
    <noscript><p><a class="crt-link" href="/rolos/novo" target="_blank">Cadastrar filamento em outra aba</a> e atualizar esta página antes de preencher.</p></noscript>
   </section>

   <section class="registro__grupo" aria-labelledby="grupo-consumo">
    <h2 class="so-leitor" id="grupo-consumo">Consumo e resultado</h2>
    <div class="registro__dupla">
     <label>Filamento usado (g)<input type="text" inputmode="decimal" name="gramas" bind:value={valores.gramas} placeholder="82,5" required aria-invalid={resposta?.campo === 'gramas' ? 'true' : undefined} aria-describedby={resposta?.campo === 'gramas' ? 'erro-gramas' : undefined} />{@render erroDo('gramas')}</label>
     <label>Duração<input type="text" name="duracao" bind:value={valores.duracao} placeholder="1:30" /><small>Horas:minutos, ou o total em minutos.</small></label>
    </div>
    <!-- Resultado e finalidade são escolhas de poucas opções: ficam à vista, com o ícone de cada uma, em vez de dentro de uma lista. -->
    <fieldset class="opcoes-icone">
     <legend>Resultado</legend>
     {#each RESULTADOS as r (r.valor)}
      <label><input type="radio" name="status" value={r.valor} bind:group={valores.status} /><span><Icone nome={ICONE_DO_STATUS[r.valor] ?? 'info'} tamanho={18} />{r.nome}</span></label>
     {/each}
    </fieldset>
    {#if valores.status === 'falha'}<label>Motivo da falha<input type="text" name="motivoFalha" bind:value={valores.motivoFalha} placeholder="Opcional" /></label>{:else}<noscript><label>Motivo da falha (se aplicável)<input type="text" name="motivoFalha" value={valores.motivoFalha} /></label></noscript>{/if}
    <fieldset class="opcoes-icone" aria-describedby={resposta?.campo === 'finalidade' ? 'erro-finalidade' : undefined}>
     <legend>Finalidade</legend>
     {#each FINALIDADES as f (f)}
      <label><input type="radio" name="finalidade" value={f} bind:group={valores.finalidade} /><span><Icone nome={ICONE_DA_FINALIDADE[f] ?? 'outro'} tamanho={18} />{inicial(FINALIDADE[f])}</span></label>
     {/each}
     {@render erroDo('finalidade')}
    </fieldset>
    <details class="cadastro-detalhes" open={detalhesComErro}>
     <summary>Data e parâmetros</summary>
     <div class="registro__dupla">
      <label>Início<input type="datetime-local" name="inicioEm" bind:value={valores.inicioEm} aria-invalid={resposta?.campo === 'inicioEm' ? 'true' : undefined} aria-describedby={resposta?.campo === 'inicioEm' ? 'erro-inicioEm' : undefined} />{@render erroDo('inicioEm')}<small>Em branco significa agora.</small></label>
      <label>Camada (mm)<input type="text" inputmode="decimal" name="camadaMm" bind:value={valores.camadaMm} aria-invalid={resposta?.campo === 'camadaMm' ? 'true' : undefined} aria-describedby={resposta?.campo === 'camadaMm' ? 'erro-camadaMm' : undefined} />{@render erroDo('camadaMm')}</label>
      <label>Paredes<input type="number" inputmode="numeric" name="paredes" bind:value={valores.paredes} aria-invalid={resposta?.campo === 'paredes' ? 'true' : undefined} aria-describedby={resposta?.campo === 'paredes' ? 'erro-paredes' : undefined} />{@render erroDo('paredes')}</label>
      <label>Preenchimento (%)<input type="number" inputmode="numeric" name="infillPct" bind:value={valores.infillPct} aria-invalid={resposta?.campo === 'infillPct' ? 'true' : undefined} aria-describedby={resposta?.campo === 'infillPct' ? 'erro-infillPct' : undefined} />{@render erroDo('infillPct')}</label>
     </div>
    </details>
   </section>
  </div>

  <!--
   A conferência: o que está prestes a ser gravado, lido de volta enquanto se
   preenche, com o rolo já desenhado como vai ficar. O custo de filamento e o
   saldo depois são contas do navegador sobre os dados do rolo escolhido; o
   custo completo e o saldo de verdade vêm do servidor, na tela de resultado.
  -->
  <aside class="conferencia" aria-labelledby="titulo-conferencia">
   <h2 class="so-leitor" id="titulo-conferencia">Conferência</h2>
   <div class="conferencia__rolo">
    {#if rolo}
     <FiguraRolo cor={rolo.corHex} fracao={fracaoNaConferencia} />
     <div>
      <p class="conferencia__fio"><span><b>{rolo.material}</b> {rolo.cor}</span> <span class="etiqueta">{rolo.codigo}</span></p>
      <p class="conferencia__saldo">
       {#if previa?.efeito === 'baixa' && previa.depoisG !== rolo.restanteG}<span class="transicao"><s>{g(rolo.restanteG)}</s> <i aria-hidden="true">→</i> <b class="num">{g(previa.depoisG)}</b></span>
       {:else if previa?.efeito === 'baixa' || previa?.efeito === 'nao-baixa'}<span class="transicao"><b class="num">{g(rolo.restanteG)}</b> <small>não muda</small></span>
       {:else if previa}<span class="transicao"><small>saldo calculado ao registrar</small></span>
       {:else}<span class="transicao"><b class="num">{g(rolo.restanteG)}</b>{#if rolo.pesoLiquidoInicialG > 0}{' '}<small>de {pesoCurto(rolo.pesoLiquidoInicialG)}</small>{/if}</span>{/if}
      </p>
     </div>
    {:else}
     <span class="encaixe__vago" aria-hidden="true"></span>
     <p class="vazio">Filamento não escolhido</p>
    {/if}
   </div>
   <dl>
    <div><dt>Peça</dt><dd class:vazio={!valores.nomeLivre.trim()}>{valores.nomeLivre.trim() || 'sem nome ainda'}</dd></div>
    <div><dt>Impressora</dt><dd class:vazio={!impressora}>{impressora?.nome ?? 'não escolhida'}</dd></div>
    <div><dt>Consumo</dt><dd class:vazio={!gramasValidas}>{gramasValidas ? gConsumo(gramas) : 'não informado'}{#if gramasValidas && valores.duracao.trim()}{' em '}{valores.duracao.trim()}{/if}</dd></div>
    {#if rolo && previa}
     <div class="conferencia__dado"><dt>Filamento nesta peça</dt><dd class="num">{reais(Math.round(gramas * rolo.precoPagoCents / rolo.pesoLiquidoInicialG))}</dd></div>
    {/if}
   </dl>
   {#if rolo && previa}
    <!-- aria-live: a explicação muda quando a data de início muda, longe do campo. -->
    <div class="conferencia__avisos" aria-live="polite">
     {#if previa.efeito === 'nao-baixa'}
      <p class="crt-dica">O início informado não é posterior à última pesagem deste rolo{#if rolo.pesagemTexto}{' '}({rolo.pesagemTexto}){/if}. O saldo parte sempre da pesagem mais recente: esta impressão entra no histórico e no custo, mas não baixa o saldo.</p>
     {:else if previa.efeito === 'indeterminado' && previa.motivo === 'pesagem-futura'}
      <p class="crt-dica">A última pesagem deste rolo está com data no futuro{#if rolo.pesagemTexto}{' '}({rolo.pesagemTexto}){/if}. O saldo só baixa com impressões iniciadas depois dela; o valor certo aparece ao registrar.</p>
     {:else if previa.efeito === 'indeterminado' && previa.motivo === 'virada-de-horario'}
      <p class="crt-dica">O início informado está a menos de três horas da última pesagem{#if rolo.pesagemTexto}{' '}({rolo.pesagemTexto}){/if}, perto de uma mudança de horário. Daqui não dá para afirmar se a impressão baixa o saldo; o valor certo aparece ao registrar.</p>
     {:else if previa.efeito === 'indeterminado'}
      <p class="crt-dica">Não foi possível ler a data de início daqui; o saldo é calculado ao registrar.</p>
     {/if}
     {#if previa.efeito === 'baixa' && previa.depoisG === rolo.restanteG && rolo.restanteG > 0}
      <p class="crt-dica">Este consumo é menor que a precisão do saldo, que é guardado com uma casa decimal. Ele é registrado e entra na conta do rolo.</p>
     {/if}
     {#if consumoSuperaSaldo}<p class="cadastro-erro" role="status">O consumo informado supera o saldo estimado deste rolo. Confira o filamento escolhido ou atualize a pesagem.</p>{/if}
    </div>
   {/if}
   <button class="acao acao--sinal acao--grande" type="submit" disabled={enviando || !data.impressoras.length || !data.rolos.length}>{enviando ? 'Registrando…' : 'Registrar impressão'}</button>
   {#if pendencia}<p class="crt-dica">{pendencia}</p>{:else if rolo && previa}<p class="nota">Energia e máquina entram no custo completo, ao registrar.</p>{/if}
  </aside>
 </form>
{/if}

<dialog class="cadastro-dialogo" bind:this={dialogo} onclose={() => aberto = false} aria-labelledby="titulo-dialogo-filamento">
 <header><h2 id="titulo-dialogo-filamento">Novo filamento</h2><button type="button" class="acao acao--icone acao--fantasma" aria-label="Fechar" onclick={() => dialogo.close()}><Icone nome="fechar" /></button></header>
 {#if aberto}<CadastroFilamento itens={data.itens} envio={data.envioFilamento} aoCadastrar={cadastrado} />{/if}
</dialog>
