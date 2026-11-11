<script lang="ts">
 import { applyAction, enhance } from '$app/forms';
 import { invalidateAll } from '$app/navigation';
 import { untrack, onMount } from 'svelte';
 import type { SubmitFunction } from '@sveltejs/kit';
 import { STATUS_ROLO, comUnidade, dataCurta, frase, inicial, reais } from '$lib/formato';
 import { normalizar } from '$lib/catalogo/busca';
 import { pesoCurto } from '$lib/figura-rolo';
 import { fracaoNaRegua } from '$lib/regua';
 import ChipFilamento from './ChipFilamento.svelte';
 import FiguraRolo from './FiguraRolo.svelte';
 import Icone from './Icone.svelte';
 import RoloNaPrateleira from './RoloNaPrateleira.svelte';
 type Rolo = { id:number; codigo:string; marca:string; material:string; cor:string; corHex:string|null; status:'fechado'|'aberto'|'vazio'|'descartado'; precoPagoCents:number; pesoLiquidoInicialG:number; dataCompra:Date|null; imagemUrl?:string; estoque:{restanteG:number;percentual:number}; alertas?:{tipo:string}[]; diasSemSecar?:number|null; secagemRegistrada?:boolean };
 let { rolos, historico, impressoras, carregados, detalheId = null, regua }: { rolos:Rolo[]; historico:Rolo[]; impressoras:{id:number;nome:string}[]; carregados:{impressoraId:number;roloId:number;posicao:number}[]; detalheId?: number | null; /** A régua da tela: o peso líquido inicial do maior rolo (ver `$lib/regua`). */ regua: number } = $props();
 let interativa = $state(false);
 onMount(() => { interativa = true; });
 let impressoraId = $state(untrack(() => String(impressoras[0]?.id ?? '')));
 let posicao = $state('1');
 // "Armado": há uma posição esperando rolo. Só então a prateleira oferece
 // "Carregar na posição N" em cada rolo — fora disso, o botão não aparece.
 let armado = $state(false);
 let busca = $state('');
 let salvando = $state(false);
 let mensagem = $state('');
 let erro = $state(false);
 let instrucao = $state<HTMLParagraphElement>();
 const ativos = $derived(carregados.filter(a => String(a.impressoraId) === impressoraId));
 const encontrados = $derived(rolos.filter(r => normalizar([r.marca,r.material,r.cor,r.codigo].join(' ')).includes(normalizar(busca))));
 const restanteTotalG = $derived(rolos.reduce((soma, r) => soma + r.estoque.restanteG, 0));
 // Os carretéis são desenhados na mesma escala (cheio = o maior rolo), para
 // que o rolo de 6 g em 20 g não pareça mais cheio que o de 391 g em 1 kg. A
 // escala só precisa ser dita quando os rolos têm capacidades diferentes.
 const capacidades = $derived(new Set(rolos.filter(r => r.pesoLiquidoInicialG > 0).map(r => r.pesoLiquidoInicialG)));
 const nomeDaImpressora = $derived(impressoras.find(i => String(i.id) === impressoraId)?.nome ?? '');
 function armar(slot: number) {
  posicao = String(slot); armado = true; mensagem = '';
  // O que mudou está na prateleira, mais abaixo: o foco vai para a instrução.
  queueMicrotask(() => instrucao?.focus());
 }
 const enviar: SubmitFunction = () => {
  salvando = true; mensagem = '';
  return async ({result}) => {
   try {
    // O retorno desta ação é dito AQUI, junto dos encaixes que mudaram. Por
    // isso a resposta não é aplicada ao `form` da página (que repetiria a
    // mesma frase no topo): só os dados são recarregados. Redirecionamento e
    // erro inesperado seguem o caminho normal.
    if (result.type === 'success' || result.type === 'failure') {
     await invalidateAll();
     // ...e o retorno de uma ação anterior da página sai do topo: ele não fala mais do estado atual.
     await applyAction({ type: 'success', status: 200, data: undefined });
    } else await applyAction(result);
    erro = result.type !== 'success';
    if (!erro) armado = false;
    mensagem = result.type === 'failure' || result.type === 'success' ? frase(String(result.data?.erro ?? result.data?.aviso ?? 'Seleção atualizada.')) : 'Não foi possível atualizar. Tente novamente.';
   } finally { salvando = false; }
  };
 };
</script>

<!--
 O que está na impressora: quatro encaixes. Encaixe cheio mostra o rolo que
 está nele e a ação de retirar; encaixe vazio oferece "Carregar", que deixa a
 posição esperando e passa a escolha para a prateleira logo abaixo.
-->
<section class="na-impressora folha ativacao-interativa" aria-labelledby="titulo-carregados">
 <img class="na-impressora__maquina" src="/midia/impressora.webp" alt="" width="640" height="640" />
 <div class="na-impressora__corpo">
  <header class="faixa">
   <h2 id="titulo-carregados">Na impressora</h2>
   {#if impressoras.length > 1}
    <label class="campo campo--linha">Impressora<select bind:value={impressoraId} disabled={salvando}>{#each impressoras as i}<option value={String(i.id)}>{i.nome}</option>{/each}</select></label>
   {:else if impressoras.length === 1}
    <p class="topo__dado">{nomeDaImpressora}</p>
   {/if}
  </header>
  {#if !impressoras.length}
   <p><a class="crt-link" href="/impressoras">Cadastre uma impressora</a> para carregar filamentos nela.</p>
  {:else}
   <ol class="encaixes" aria-label="Posições de filamento de {nomeDaImpressora}">
    {#each [1,2,3,4] as slot}
     {@const vinculo = ativos.find(a => a.posicao === slot)}
     {@const rolo = rolos.find(r => r.id === vinculo?.roloId)}
     {@const esperando = armado && posicao === String(slot)}
     <li class="encaixe" class:encaixe--cheio={!!rolo} class:encaixe--esperando={esperando}>
      <span class="encaixe__n" aria-hidden="true">{slot}</span>
      {#if rolo}
       <FiguraRolo cor={rolo.corHex} fracao={fracaoNaRegua(rolo.estoque.restanteG, regua)} />
       <p class="encaixe__nome"><span class="so-leitor">Posição {slot}: </span><b>{rolo.material}</b> {rolo.cor}<span class="etiqueta">{rolo.codigo}</span></p>
       <div class="encaixe__acoes">
        <form method="POST" action="?/desativar" use:enhance={enviar} data-envio-local><input type="hidden" name="impressoraId" value={impressoraId}/><input type="hidden" name="posicao" value={slot}/><button type="submit" disabled={salvando} class="acao acao--miuda" aria-label="Retirar {rolo.codigo} da posição {slot}"><Icone nome="retirar" tamanho={16} />Retirar</button></form>
        <button type="button" class="acao acao--miuda acao--fantasma" disabled={!interativa || salvando} aria-pressed={esperando} onclick={() => armar(slot)} aria-label="Trocar o rolo da posição {slot}">Trocar</button>
       </div>
      {:else}
       <span class="encaixe__vago" aria-hidden="true"></span>
       <p class="encaixe__nome encaixe__nome--vazio"><span class="so-leitor">Posição {slot}: </span>Vazia</p>
       <div class="encaixe__acoes">
        <button type="button" class="acao acao--miuda" disabled={!interativa || salvando} aria-pressed={esperando} onclick={() => armar(slot)} aria-label="Carregar um rolo na posição {slot}"><Icone nome="carregar" tamanho={16} />{esperando ? 'Escolha o rolo' : 'Carregar'}</button>
       </div>
      {/if}
     </li>
    {/each}
   </ol>
  {/if}
  {#if mensagem}<p class="retorno" class:retorno--falha={erro} role="status">{mensagem}</p>{/if}
 </div>
</section>

<noscript><style>.ativacao-interativa { display: none; }</style><form class="painel crt-corpo" method="POST" action="?/ativar"><h2>Carregar filamento na impressora</h2><label>Impressora<select name="impressoraId" required>{#each impressoras as i}<option value={i.id}>{i.nome}</option>{/each}</select></label><label>Posição<select name="posicao">{#each [1,2,3,4] as n}<option value={n}>{n}</option>{/each}</select></label><label>Filamento<select name="roloId" required>{#each rolos as r}<option value={r.id}>{r.codigo} · {r.marca} {r.material} {r.cor}</option>{/each}</select></label><button type="submit" class="acao acao--sinal">Carregar filamento</button></form>
 {#if carregados.length}<section class="painel crt-corpo"><h2>Filamentos na impressora</h2>{#each carregados as a}<form method="POST" action="?/desativar"><input type="hidden" name="impressoraId" value={a.impressoraId}/><input type="hidden" name="posicao" value={a.posicao}/><p>{impressoras.find(i => i.id === a.impressoraId)?.nome} · Posição {a.posicao} · {rolos.find(r => r.id === a.roloId)?.codigo}</p><button type="submit" class="acao">Retirar da posição {a.posicao}</button></form>{/each}</section>{/if}
</noscript>

<!--
 A prateleira: cada rolo é o objeto (o render na cor do dado, com o enrolamento
 que sobrou), o que está escrito nele e os avisos dele. Abrir o rolo mostra o
 detalhe ao lado, onde ficam pesar, secar, editar e encerrar.
-->
<section id="estoque-visual" class="estoque-prateleira" aria-labelledby="titulo-estoque">
 <header class="faixa">
  <h2 id="titulo-estoque">Em estoque</h2>
  <p class="topo__dado">{rolos.length} {rolos.length === 1 ? 'rolo' : 'rolos'}, {pesoCurto(restanteTotalG)}</p>
  <label class="busca"><span class="so-leitor">Buscar filamento</span><input type="search" bind:value={busca} placeholder="Buscar marca, tipo, cor ou código" /></label>
 </header>
 {#if armado}
  <p class="instrucao" role="status" tabindex="-1" bind:this={instrucao}><Icone nome="carregar" tamanho={18} />Escolha abaixo o rolo que vai na posição {posicao}{impressoras.length > 1 ? ` de ${nomeDaImpressora}` : ''}.<button type="button" class="acao acao--miuda acao--fantasma" onclick={() => armado = false}>Cancelar</button></p>
 {/if}
 {#if encontrados.length}
 <ul class="prateleira">
 {#each encontrados as r (r.id)}
  {@const ativo = carregados.find(a => a.roloId === r.id)}
  {@const nestaImpressora = ativo && String(ativo.impressoraId) === impressoraId}
  <li>
   <RoloNaPrateleira
    rolo={{ id: r.id, codigo: r.codigo, material: r.material, cor: r.cor, corHex: r.corHex, status: r.status, pesoLiquidoInicialG: r.pesoLiquidoInicialG, restanteG: r.estoque.restanteG, alertas: (r.alertas ?? []).map(a => a.tipo), posicao: ativo?.posicao ?? null, diasSemSecar: r.diasSemSecar, secagemRegistrada: r.secagemRegistrada }}
    {regua}
    href="/rolos?detalhes={r.id}#detalhe-rolo"
    atual={detalheId === r.id}
   >
    {#if armado}
     <form class="ativacao-interativa" method="POST" action="?/ativar" use:enhance={enviar} data-envio-local>
      <input type="hidden" name="impressoraId" value={impressoraId}/><input type="hidden" name="posicao" value={posicao}/><input type="hidden" name="roloId" value={r.id}/>
      <button class="acao acao--sinal acao--miuda" type="submit" disabled={!interativa || salvando || !impressoraId || (nestaImpressora && String(ativo.posicao) === posicao)} aria-label="Carregar {r.marca} {r.material} {r.cor}, rolo {r.codigo}, na posição {posicao}"><Icone nome="carregar" tamanho={16} />Carregar na posição {posicao}</button>
     </form>
    {/if}
   </RoloNaPrateleira>
  </li>
 {/each}
 </ul>
 {#if capacidades.size > 1}<p class="nota">Carretéis desenhados na mesma escala: cheio é {pesoCurto(regua)}, o maior rolo.</p>{/if}
 {/if}
 {#if !rolos.length}
  <div class="vazio-estado folha"><Icone nome="filamentos" tamanho={40} /><p>Nenhum filamento em estoque.</p><a class="acao acao--sinal" href="/rolos/novo">Cadastrar o primeiro filamento</a></div>
 {:else if !encontrados.length}
  <div class="vazio-estado"><Icone nome="buscar" tamanho={32} /><p>Nenhum filamento com “{busca}”.</p><button type="button" class="acao acao--miuda" onclick={() => busca = ''}>Limpar a busca</button></div>
 {/if}
</section>

{#if historico.length}
<section id="historico-filamentos" class="folha" aria-labelledby="titulo-historico">
 <header class="faixa"><h2 id="titulo-historico">Encerrados</h2><p class="topo__dado">{historico.length} {historico.length === 1 ? 'rolo' : 'rolos'} fora de uso</p></header>
 <div class="crt-rolagem" role="region" aria-label="Filamentos encerrados, tabela com rolagem horizontal"><table><thead><tr><th scope="col">Filamento</th><th scope="col">Compra</th><th scope="col" class="crt-num">Preço pago</th><th scope="col" class="crt-num">Saldo final estimado</th><th scope="col">Estado</th><th scope="col">Ações</th></tr></thead><tbody>{#each historico as r (r.id)}<tr><td><ChipFilamento material={r.material} cor={r.cor} corHex={r.corHex} codigo={r.codigo} /><small class="secundaria encerrado-marca">{r.marca}</small></td><td>{r.dataCompra ? dataCurta(r.dataCompra) : 'Não informada'}</td><td class="crt-num">{reais(r.precoPagoCents)}</td><td class="crt-num">{comUnidade(r.estoque.restanteG,'g',0)}</td><td>{inicial(STATUS_ROLO[r.status] ?? r.status)}</td><td class="acoes-linha"><a class="crt-link" href="/rolos?detalhes={r.id}#detalhe-rolo">Detalhes</a><a class="crt-link" href="/impressoes?rolo={r.id}">Impressões</a><a class="crt-link" href="/rolos?reabrir={r.id}">Reabrir</a></td></tr>{/each}</tbody></table></div>
</section>
{/if}
