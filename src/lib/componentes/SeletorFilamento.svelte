<script lang="ts">
 import {onMount} from 'svelte';
 import {normalizar} from '$lib/catalogo/busca';
 import type {ErroDeCampo} from '$lib/erro-campo';
 import {frase} from '$lib/formato';
 import Icone from './Icone.svelte';
 type Rolo={id:number;codigo:string;marca:string;material:string;cor:string;corHex:string|null};
 let {rolos,nome='roloId',rotulo='Filamento',value=$bindable(''),vazio='Escolha um filamento',disabled=false,required=false,erro}: {rolos:Rolo[];nome?:string;rotulo?:string;value?:string;vazio?:string;disabled?:boolean;required?:boolean;erro?:ErroDeCampo}=$props();
 const id=$props.id();let pronta=$state(false);let busca=$state('');let menu=$state<HTMLDetailsElement>();
 onMount(()=>{pronta=true;});
 const atual=$derived(rolos.find(r=>String(r.id)===value));
 const encontrados=$derived(rolos.filter(r=>normalizar(`${r.codigo} ${r.marca} ${r.material} ${r.cor}`).includes(normalizar(busca))));
 const invalido=$derived(erro?.campo===nome);
 const texto=(r:Rolo)=>`${r.material} ${r.cor}, ${r.marca} (${r.codigo})`;
 function fechar(focar=false){if(menu?.open){menu.open=false;busca='';if(focar)menu.querySelector('summary')?.focus();}}
</script>
<svelte:window onkeydown={e=>{if(e.key==='Escape')fechar(true);}} onpointerdown={e=>{if(menu && e.target instanceof Node && !menu.contains(e.target))fechar();}}/>
<!--
 A escolha de um rolo dentro de um formulário comum. Fechado, parece um campo
 e mostra o rolo como ele é citado no resto do produto (carretelzinho na cor do
 dado, material, cor, código). Sem script, é um `<select>` de verdade.
-->
{#snippet citar(r: Rolo)}<span class="fio-chip" style:--icone-material={r.corHex ?? 'var(--fio-sem-cor)'}><Icone nome="filamentos" tamanho={20} /><span><b>{r.material}</b> {r.cor}</span></span>{/snippet}
<div class="crt-campo seletor-filamento">
 <label class="rotulo" id={`${id}-rotulo`} for={id}>{rotulo}</label>
 {#if pronta}
 <input type="hidden" name={nome} {value} {disabled}/>
 <details bind:this={menu} ontoggle={()=>{if(disabled && menu?.open)fechar();}}>
  <summary id={id} class:seletor-filamento__invalido={invalido} aria-labelledby={`${id}-rotulo ${id}-valor`} aria-describedby={invalido?`${id}-erro`:undefined} aria-disabled={disabled} tabindex={disabled?-1:0}>
   <span class="seletor-filamento__valor" id={`${id}-valor`}>{#if atual}{@render citar(atual)}<span class="etiqueta">{atual.codigo}</span>{:else}<span class="secundaria">{vazio}</span>{/if}</span>
   <Icone nome="chevron-baixo" tamanho={18} />
  </summary>
  <div class="seletor-filamento-menu">
   <input type="search" bind:value={busca} placeholder="Cor, material ou código" aria-label={`Buscar ${rotulo.toLowerCase()}`} {disabled} onkeydown={e=>{if(e.key==='Enter')e.preventDefault();}}/>
   <div class="seletor-filamento-opcoes" role="group" aria-label={`Opções de ${rotulo.toLowerCase()}`}>
    {#if !required && !busca.trim()}<button class="seletor-filamento-opcao" type="button" {disabled} aria-pressed={!value} onclick={()=>{value='';fechar(true);}}><span class="secundaria">{vazio}</span></button>{/if}
    {#each encontrados as r (r.id)}<button class="seletor-filamento-opcao" type="button" {disabled} aria-pressed={value===String(r.id)} onclick={()=>{value=String(r.id);fechar(true);}}>{@render citar(r)}<small>{r.marca}</small><span class="etiqueta">{r.codigo}</span>{#if value===String(r.id)}<Icone nome="check" tamanho={18} />{/if}</button>{/each}
    {#if !encontrados.length}<p class="nota">Nenhum filamento encontrado.</p>{/if}
   </div>
  </div>
 </details>
 {:else}
 <select {id} name={nome} bind:value {disabled} {required} aria-invalid={invalido || undefined}><option value="">{vazio}</option>{#each rolos as r (r.id)}<option value={String(r.id)}>{texto(r)}</option>{/each}</select>
 {/if}
 {#if invalido}<small id={`${id}-erro`} class="crt-erro">{frase(erro?.mensagem ?? '')}</small>{/if}
</div>
