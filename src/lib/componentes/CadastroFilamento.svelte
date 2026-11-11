<script lang="ts">
 import { enhance } from '$app/forms';
 import { tick, untrack } from 'svelte';
 import type { SubmitFunction } from '@sveltejs/kit';
 import { normalizar, type ItemCatalogo } from '$lib/catalogo/busca';
 import { frase, reais } from '$lib/formato';
 import { textoParaCentavosEstrito } from '$lib/dinheiro';
 import FiguraRolo from './FiguraRolo.svelte';
 import Icone from './Icone.svelte';
 import ImagemProduto from './ImagemProduto.svelte';

 type Resposta = { erro?: string; campo?: string; valores?: Record<string, string>; sucesso?: boolean; aviso?: string; roloId?: number };
 let { itens, envio, form = null, selecionado = null, aoCadastrar }: {
  itens: ItemCatalogo[]; envio: string; form?: Resposta | null; selecionado?: ItemCatalogo | null;
  aoCadastrar?: (id: number) => Promise<void>;
 } = $props();
 const inicial = untrack(() => itens.find(i => i.id === form?.valores?.itemId) ?? selecionado);
 let marca = $state(inicial?.marca ?? '');
 let linha = $state(inicial?.material ?? '');
 let itemId = $state(inicial?.id ?? '');
 let etapa = $state(inicial ? 3 : 0);
 let busca = $state('');
 let manual = $state(untrack(() => Boolean(form?.valores?.material && !inicial)));
 let valores = $state({ preco: '', pesoInicial: '1000', pesoCarretel: '250', fornecedor: '', apelido: '', marca: '', material: '', cor: '', densidade: '1,24', corHex: '', tempBico: '', tempMesa: '', ...untrack(() => form?.valores ?? {}) });
 let resposta = $state<Resposta | null>(untrack(() => form));
 let enviando = $state(false);
 let titulo = $state<HTMLHeadingElement>();
 const passos = ['Marca', 'Tipo', 'Cor', 'Preço'];
 const item = $derived(itens.find(i => i.id === itemId));
 const marcas = $derived([...new Set(itens.filter(i => i.marca !== 'Generic' && i.cor).map(i => i.marca))].sort((a,b) => a === 'Bambu Lab' ? -1 : b === 'Bambu Lab' ? 1 : a.localeCompare(b, 'pt-BR')));
 const linhas = $derived([...new Set(itens.filter(i => i.marca === marca && i.cor).map(i => i.material))].sort((a,b) => (a === 'PLA Basic' ? -1 : b === 'PLA Basic' ? 1 : a.localeCompare(b, 'pt-BR'))));
 const cores = $derived(itens.filter(i => i.marca === marca && i.material === linha && i.cor && normalizar([i.cor, i.corAlias].join(' ')).includes(normalizar(busca))).sort((a,b) => (a.cor ?? '').localeCompare(b.cor ?? '', 'pt-BR')));
 const precoCents = $derived(textoParaCentavosEstrito(valores.preco));
 const porKg = $derived(precoCents === null ? NaN : precoCents / Number(valores.pesoInicial.replace(',', '.')) * 1000);
 const avancado = $derived(['pesoInicial','pesoCarretel','fornecedor','apelido','densidade','tempBico','tempMesa','corHex'].includes(resposta?.campo ?? ''));
 async function ir(n: number) { etapa = n; busca = ''; await tick(); titulo?.focus(); }
 function escolherMarca(nome: string) { if (marca !== nome) { linha = ''; itemId = ''; } marca = nome; manual = false; ir(1); }
 function escolherLinha(nome: string) { if (linha !== nome) itemId = ''; linha = nome; ir(2); }
 function escolherCor(i: ItemCatalogo) { if (itemId !== i.id) valores.densidade = String(i.densidade).replace('.', ','); itemId = i.id; ir(3); }
 function cadastroManual() { manual = true; valores.marca = marca; valores.material = linha; ir(3); }
 const salvar: SubmitFunction = () => {
  enviando = true; resposta = null;
  return async ({ result }) => {
   enviando = false;
   if (result.type === 'success' || result.type === 'failure') {
    resposta = result.data as Resposta;
    if (resposta?.sucesso && resposta.roloId && aoCadastrar) await aoCadastrar(resposta.roloId);
   } else resposta = { erro: 'Não foi possível salvar. Confira sua conexão e tente novamente.' };
  };
 };
</script>

{#if resposta?.sucesso}
 <section class="cadastro-sucesso folha" role="status">
  <p class="recibo__status"><Icone nome="sucesso" tamanho={22} />Filamento cadastrado</p>
  <p>{frase(resposta.aviso ?? '')}</p>
  <div class="crt-acoes"><a class="acao acao--sinal" href="/rolos"><Icone nome="filamentos" tamanho={18} />Ver meus filamentos</a><a class="acao" href="/rolos/novo" data-sveltekit-reload><Icone nome="registrar" tamanho={18} />Cadastrar outra compra</a></div>
 </section>
{:else}
 <!--
  Quatro perguntas, uma por vez: marca, tipo, cor, preço. As três primeiras
  são escolhas na biblioteca (a cor se escolhe olhando o rolo naquela cor); a
  última é o que só a pessoa sabe. Quem não acha o filamento sai para o
  cadastro pela embalagem em qualquer etapa.
 -->
 <div class="cadastro-guiado folha">
  <nav class="cadastro-passos" aria-label="Etapas do cadastro">
   {#each passos as passo, n}
    <button type="button" class:atual={etapa === n} class:feito={etapa > n} aria-current={etapa === n ? 'step' : undefined} disabled={n > etapa} onclick={() => { manual = false; ir(n); }}><span aria-hidden="true">{#if etapa > n}<Icone nome="check" tamanho={14} />{:else}{n + 1}{/if}</span>{passo}</button>
   {/each}
  </nav>
  <div class="cadastro-etapa">
   <div class="cadastro-titulo">
    <h2 bind:this={titulo} tabindex="-1">{manual ? 'Cadastrar pela embalagem' : ['Qual é a marca?', 'Qual é o tipo?', 'Qual é a cor?', 'Quanto você pagou?'][etapa]}</h2>
    {#if !manual && etapa > 0}<p>{etapa === 1 ? marca : `${marca}, ${linha}`}</p>{/if}
   </div>
   {#if etapa === 0}
    <div class="cadastro-marcas">
     {#each marcas as nome}
      {@const exemplo = itens.find(i => i.marca === nome && i.logoUrl)}
      <button type="button" class="cadastro-marca" onclick={() => escolherMarca(nome)}>
       <span class="cadastro-marca__logo" aria-hidden="true">{nome.charAt(0)}{#if exemplo?.logoUrl}<img src={exemplo.logoUrl} alt="" loading="lazy" referrerpolicy="no-referrer" onerror={e => (e.currentTarget as HTMLImageElement).remove()} />{/if}</span>
       <strong>{nome}</strong><small>{nome === 'Bambu Lab' ? 'Sua marca principal' : `${new Set(itens.filter(i => i.marca === nome && i.cor).map(i => i.material)).size} tipos`}</small>
      </button>
     {/each}
    </div>
    {#if !marcas.length}<p class="nota">A biblioteca não está disponível. Cadastre pela embalagem ou atualize o catálogo em <a class="crt-link" href="/config">Configurações</a>.</p>{/if}
   {:else if etapa === 1}
    {#if linhas.length > 6}<label class="busca"><span class="so-leitor">Buscar tipo</span><input type="search" bind:value={busca} placeholder="PLA, PETG, Matte, Silk…" /></label>{/if}
    <div class="cadastro-produtos">
     {#each linhas.filter(l => normalizar(l).includes(normalizar(busca))) as nome}
      {@const exemplos = itens.filter(i => i.marca === marca && i.material === nome)}
      {@const foto = exemplos.find(i => i.imagemUrl)}
      <button type="button" class="cadastro-produto" onclick={() => escolherLinha(nome)}>
       <ImagemProduto src={foto?.imagemUrl} nome={`${marca} ${nome}`} cor={(foto ?? exemplos.find(i => i.corHex))?.corHex} />
       <strong>{nome}</strong><small>{exemplos.filter(i => i.cor).length === 1 ? '1 cor' : `${exemplos.filter(i => i.cor).length} cores`}</small>
      </button>
     {/each}
    </div>
   {:else if etapa === 2}
    {#if cores.length > 8 || busca}<label class="busca"><span class="so-leitor">Buscar cor</span><input type="search" bind:value={busca} placeholder="Nome da cor" /></label>{/if}
    <div class="cadastro-cores">
     {#each cores as cor (cor.id)}
      <button type="button" class="cadastro-cor" class:selecionada={itemId === cor.id} aria-pressed={itemId === cor.id} onclick={() => escolherCor(cor)}>
       <FiguraRolo cor={cor.corHex} fracao={1} />
       <strong>{cor.cor}</strong>{#if !cor.corHex}<small>Sem amostra de cor</small>{/if}
       {#if itemId === cor.id}<span class="filamento-opcao__marca cor-check" aria-hidden="true"><Icone nome="check" tamanho={16} /></span>{/if}
      </button>
     {/each}
    </div>
    {#if !cores.length}<p class="nota">Nenhuma cor com essa busca.</p>{/if}
   {:else}
    {#if resposta?.erro}<p class="cadastro-erro" role="alert">{frase(resposta.erro)}</p>{/if}
    <form method="POST" action={manual ? '/rolos/novo?/criar' : `/rolos/novo?/criarDoCatalogo&item=${encodeURIComponent(itemId)}`} use:enhance={salvar} data-envio-local aria-busy={enviando}>
     <input type="hidden" name="envio" value={envio} /><input type="hidden" name="guiado" value="1" /><input type="hidden" name="itemId" value={itemId} />
     <div class="cadastro-compra">
      {#if item && !manual}
       <aside class="cadastro-resumo">
        <ImagemProduto src={item.imagemUrl} nome={`${item.marca} ${item.material} ${item.cor}`} cor={item.corHex} />
        <p class="cadastro-resumo__nome"><span><b>{item.material}</b> {item.cor}</span><small>{item.marca}</small></p>
        <small>{valores.pesoInicial} g de filamento, carretel de {valores.pesoCarretel} g</small>
        {#if item.produtoUrl}<a class="crt-link" href={item.produtoUrl} target="_blank" rel="noreferrer">Ver o produto na fonte<Icone nome="externo" tamanho={16} /></a>{/if}
       </aside>
      {/if}
      <div class="cadastro-campos">
       {#if manual}
        <label>Marca<input type="text" name="marca" bind:value={valores.marca} required /></label>
        <label>Tipo de filamento<input type="text" name="material" bind:value={valores.material} required /></label>
        <label>Cor<input type="text" name="cor" bind:value={valores.cor} required /></label>
       {/if}
       {#if item?.densidadeEstimada && !manual}
        <div class="cadastro-estimada"><label>Densidade de referência (g/cm³)<input type="text" inputmode="decimal" name="densidade" bind:value={valores.densidade} required /><small>A fabricante não informa. É uma estimativa para o material; ajuste pela ficha da embalagem.</small></label></div>
       {/if}
       <label class="cadastro-preco">Preço pago (R$)<input type="text" inputmode="decimal" name="preco" bind:value={valores.preco} placeholder="129,90" required aria-invalid={resposta?.campo === 'preco'} /><small>{#if valores.preco && Number.isFinite(porKg) && porKg >= 0}{reais(Math.round(porKg))} por kg.{:else}Desta compra, por rolo.{/if}</small></label>
       <details class="cadastro-detalhes" open={avancado}>
        <summary>Peso e outros detalhes</summary>
        <div class="cadastro-dupla">
         <label>Peso líquido (g)<input type="text" inputmode="decimal" name="pesoInicial" bind:value={valores.pesoInicial} required /></label>
         <label>Peso do carretel (g)<input type="text" inputmode="decimal" name="pesoCarretel" bind:value={valores.pesoCarretel} required /><small>Descontado nas pesagens.</small></label>
        </div>
        <label>Onde comprou<input type="text" name="fornecedor" bind:value={valores.fornecedor} placeholder="Miranda, Mercado Livre…" /></label>
        <label>Apelido do rolo<input type="text" name="apelido" bind:value={valores.apelido} placeholder="Opcional" /></label>
        {#if manual}
         <label>Cor hexadecimal<input type="text" name="corHex" bind:value={valores.corHex} placeholder="#000000" /><small>É a cor em que o rolo e as peças aparecem.</small></label>
         <label>Densidade (g/cm³)<input type="text" inputmode="decimal" name="densidade" bind:value={valores.densidade} /><small>1,24 é uma estimativa para PLA.</small></label>
         <label>Temperatura do bico (°C)<input type="text" inputmode="decimal" name="tempBico" bind:value={valores.tempBico} /></label>
         <label>Temperatura da mesa (°C)<input type="text" inputmode="decimal" name="tempMesa" bind:value={valores.tempMesa} /></label>
        {/if}
       </details>
       <button class="acao acao--sinal acao--grande" type="submit" disabled={enviando || (!manual && !item)}>{enviando ? 'Cadastrando…' : 'Cadastrar filamento'}</button>
      </div>
     </div>
    </form>
   {/if}
   {#if etapa < 3}<button type="button" class="acao acao--miuda cadastro-alternativa" onclick={cadastroManual}><Icone nome="editar" tamanho={16} />Não achei: cadastrar pela embalagem</button>{/if}
  </div>
 </div>
 <noscript>
  <style>.cadastro-guiado { display: none !important; }</style>
  {#if resposta?.erro}<p class="cadastro-erro" role="alert">{frase(resposta.erro)}</p>{/if}
  {#if itens.some(i => i.cor)}
   <form class="crt-corpo" method="POST" action="?/criarDoCatalogo">
    <input type="hidden" name="envio" value={envio} /><input type="hidden" name="guiado" value="1" />
    <label>Filamento<select name="itemId" required><option value="">Selecione marca, tipo e cor</option>{#each itens.filter(i => i.cor) as i}<option value={i.id} selected={i.id === itemId}>{i.marca} · {i.material} · {i.cor}{i.densidadeEstimada ? ` (densidade estimada: ${i.densidade})` : ''}</option>{/each}</select></label>
    <label>Preço pago (R$)<input type="text" name="preco" value={valores.preco} required /></label>
    <label>Peso líquido (g)<input type="text" name="pesoInicial" value={valores.pesoInicial} required /></label>
    <label>Peso do carretel (g)<input type="text" name="pesoCarretel" value={valores.pesoCarretel} required /></label>
    <label>Densidade, se quiser corrigir a estimativa (g/cm³)<input type="text" name="densidade" value={form?.valores?.densidade ?? ''} /></label>
    <button class="acao acao--sinal" type="submit">Cadastrar filamento</button>
   </form>
  {:else}<p>A biblioteca ainda não está disponível. Cadastre os dados da embalagem abaixo.</p>{/if}
  <details open={manual || !itens.length} class="cadastro-detalhes">
   <summary>Meu filamento não está no catálogo</summary>
   <form class="crt-corpo" method="POST" action="?/criar">
    <input type="hidden" name="envio" value={envio} /><input type="hidden" name="guiado" value="1" />
    {#each [['marca','Marca'],['material','Tipo de filamento'],['cor','Cor'],['preco','Preço pago (R$)'],['pesoInicial','Peso líquido (g)'],['pesoCarretel','Peso do carretel (g)'],['densidade','Densidade (g/cm³)'],['corHex','Cor hexadecimal'],['tempBico','Temperatura do bico (°C)'],['tempMesa','Temperatura da mesa (°C)'],['fornecedor','Onde comprou'],['apelido','Apelido do rolo']] as [nome, rotulo]}
     <label>{rotulo}<input type="text" name={nome} value={valores[nome as keyof typeof valores]} required={['marca','material','cor','preco','pesoInicial','pesoCarretel'].includes(nome)} /></label>
    {/each}
    <p class="crt-dica">Confira peso e densidade na embalagem. Os valores iniciais são uma referência para PLA de 1 kg.</p>
    <button class="acao acao--traco" type="submit">Cadastrar pela embalagem</button>
   </form>
  </details>
 </noscript>
{/if}
