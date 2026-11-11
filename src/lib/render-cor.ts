/** Prévia aproximada sobre a capa raster; não altera o arquivo nem simula acabamento. */
export function colorirRender(origem: Uint8ClampedArray, cor: string | null | undefined): Uint8ClampedArray | null {
 if (!cor || !/^#[\da-f]{6}$/i.test(cor) || origem.length % 4 !== 0) return null;
 const alvo = [1, 3, 5].map(i => parseInt(cor.slice(i, i + 2), 16));
 const luzes: number[] = [];
 let transparente = false;
 const cromas: number[][] = [];
 let neutros = 0;
 for (let i = 0; i < origem.length; i += 4) {
  if (origem[i + 3] < 16) { transparente = true; continue; }
  if (origem[i + 3] < 128) continue;
  const rgb = [origem[i], origem[i + 1], origem[i + 2]];
  const max = Math.max(...rgb), min = Math.min(...rgb);
  luzes.push(max);
  if (max - min > 24 && (max - min) / max > 0.2) cromas.push(rgb.map(c => (c - min) / (max - min)));
  else neutros++;
 }
 if (!transparente || luzes.length === 0) return null;
 // Duas cores ou regiões neutras expressivas: conservar a capa multicolorida.
 if (cromas.length > 0) {
  if (neutros > luzes.length * 0.15) return null;
  const media = [0, 1, 2].map(c => cromas.reduce((s, p) => s + p[c], 0) / cromas.length);
  const diferentes = cromas.filter(p => p.some((v, c) => Math.abs(v - media[c]) > 0.25));
  if (diferentes.length > 0) return null;
 }
 luzes.sort((a, b) => a - b);
 const referencia = Math.max(1, luzes[Math.floor((luzes.length - 1) * 0.95)]);
 const resultado = origem.slice();
 for (let i = 0; i < origem.length; i += 4) {
  if (origem[i + 3] === 0) continue;
  const luz = Math.min(1.12, Math.max(origem[i], origem[i + 1], origem[i + 2]) / referencia);
  // Preto precisa de luz refletida; branco precisa de margem para os realces.
  for (let c = 0; c < 3; c++) resultado[i + c] = Math.min(255, (24 + alvo[c] * 0.85) * luz);
 }
 return resultado;
}

/**
 * Cor clara o bastante para sumir num fundo branco (branco, creme, amarelo).
 * É a luminância relativa do sRGB; o corte em 0,6 deixa o cinza médio de fora
 * e pega o amarelo, que no branco quase não tem contorno. Serve só para a tela
 * escolher um fundo mais escuro atrás da peça — não muda a cor de nada.
 */
export function corEhClara(cor: string | null | undefined): boolean {
 if (!cor || !/^#[\da-f]{6}$/i.test(cor)) return false;
 const [r, g, b] = [1, 3, 5].map(i => {
  const c = parseInt(cor.slice(i, i + 2), 16) / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
 });
 return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.6;
}
