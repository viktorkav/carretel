<script lang="ts">
 import { untrack } from 'svelte';
 import { colorirRender, corEhClara } from '$lib/render-cor';
 import Icone from './Icone.svelte';
 let { src, cor = null, alt = '', class: classe = '', original = false, compacta = false, onestado }: {
  src: string; cor?: string | null; alt?: string; class?: string; original?: boolean;
  /** Miniatura: se a imagem não abrir, mostra o ícone em vez da frase. */
  compacta?: boolean;
  /** `aplicada`: recolorida; `original`: mostrada como veio; `falhou`: o arquivo não abriu. */
  onestado?: (estado: 'aplicada' | 'original' | 'falhou') => void;
 } = $props();
 let imagem: HTMLImageElement;
 let canvas: HTMLCanvasElement;
 let pronta = $state(false);
 // A falha é da URL que não abriu, não da cor: trocar o filamento (ou alternar "como foi guardada")
 // mantém a mesma URL, a imagem não recarrega e o aviso tem de continuar. Uma URL nova deixa de casar
 // com esta e volta a ser tentada; se abrir, o `onload` limpa a marca.
 let urlQueFalhou = $state<string | null>(null);
 const falhou = $derived(urlQueFalhou === src);
 function pintar() {
  pronta = false;
  onestado?.('original');
  if (!imagem?.naturalWidth || !canvas || original || !cor) return;
  try {
   const escala = Math.min(1, 640 / Math.max(imagem.naturalWidth, imagem.naturalHeight));
   canvas.width = Math.max(1, Math.round(imagem.naturalWidth * escala));
   canvas.height = Math.max(1, Math.round(imagem.naturalHeight * escala));
   const ctx = canvas.getContext('2d', { willReadFrequently: true });
   if (!ctx) return;
   ctx.drawImage(imagem, 0, 0, canvas.width, canvas.height);
   const dados = ctx.getImageData(0, 0, canvas.width, canvas.height);
   const colorida = colorirRender(dados.data, cor);
   if (!colorida) return;
   dados.data.set(colorida);
   ctx.putImageData(dados, 0, 0);
   pronta = true;
   onestado?.('aplicada');
  } catch { /* Falha de canvas conserva a imagem original. */ }
 }
 $effect(() => {
  src; cor; original;
  pronta = false;
  // Arquivo que não abriu nesta URL: nada a pintar e nenhum estado a anunciar. Lido fora do rastreio,
  // para a falha não reexecutar este efeito.
  if (untrack(() => urlQueFalhou) === src) return;
  // A URL nova só é utilizável após load; imagem em cache também dispara load.
  if (imagem?.complete && imagem.currentSrc === new URL(src, location.href).href) pintar();
 });
</script>

<!-- Peça recolorida numa cor clara: o fundo escurece um degrau para ela não sumir no branco. -->
<span class="render-peca {classe}" class:render-peca--colorida={pronta} class:render-peca--clara={pronta && corEhClara(cor)} data-cor-aplicada={pronta ? cor : undefined}>
 <img bind:this={imagem} {src} {alt} loading="lazy" decoding="async" onload={() => { urlQueFalhou = null; pintar(); }} onerror={() => { urlQueFalhou = src; pronta = false; onestado?.('falhou'); }} style:opacity={pronta || falhou ? 0 : 1} />
 <canvas bind:this={canvas} aria-hidden="true" style:opacity={pronta ? 1 : 0}></canvas>
 {#if falhou}<span class="render-peca__ausente">{#if compacta}<Icone nome="sem-imagem" tamanho={22} rotulo="Imagem indisponível" />{:else}<Icone nome="sem-imagem" tamanho={40} />Imagem indisponível{/if}</span>{/if}
</span>
