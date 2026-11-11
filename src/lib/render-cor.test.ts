import { describe, expect, it } from 'vitest';
import { colorirRender, corEhClara } from './render-cor';

const pixels = (...cores: number[][]) => new Uint8ClampedArray(cores.flat());
describe('cor da peça impressa', () => {
 it('preserva transparência, relevo e a imagem de origem', () => {
  const original = pixels([0,0,0,0], [40,40,40,255], [80,80,80,128]);
  const antes = original.slice();
  const resultado = colorirRender(original, '#BB9AF7')!;
  expect(original).toEqual(antes);
  expect(resultado[3]).toBe(0);
  expect(resultado[11]).toBe(128);
  expect(resultado[8]).toBeGreaterThan(resultado[4]);
  expect(resultado[10]).toBeGreaterThan(resultado[8]);
 });
 it('mantém sombras visíveis em preto e branco', () => {
  const original = pixels([0,0,0,0], [40,40,40,255], [80,80,80,255]);
  for (const cor of ['#000000', '#FFFFFF']) {
   const resultado = colorirRender(original, cor)!;
   expect(resultado[4]).toBeLessThan(resultado[8]);
   expect(resultado[8]).toBeGreaterThan(0);
  }
 });
 it('recolore um render já colorido de uma única cor', () => {
  expect(colorirRender(pixels([0,0,0,0], [100,20,20,255], [180,36,36,255]), '#00FF00')).not.toBeNull();
 });
 it('preserva imagens multicoloridas e imagens sem fundo transparente', () => {
  expect(colorirRender(pixels([0,0,0,0], [255,0,0,255], [0,0,255,255]), '#123456')).toBeNull();
  expect(colorirRender(pixels([120,120,120,255], [255,255,255,255]), '#123456')).toBeNull();
 });
 it('preserva pequenos detalhes coloridos em uma peça neutra', () => {
  const original = pixels([0,0,0,0], ...Array.from({length:96}, () => [90,90,90,255]), ...Array.from({length:4}, () => [255,0,0,255]));
  expect(colorirRender(original, '#00FF00')).toBeNull();
 });
 it('não adivinha uma cor ausente ou inválida nem transforma imagem vazia', () => {
  for (const cor of [null, '', 'red', '#gggggg']) expect(colorirRender(pixels([0,0,0,0]), cor)).toBeNull();
  expect(colorirRender(pixels([0,0,0,0]), '#112233')).toBeNull();
 });
});

describe('corEhClara', () => {
 it('branco, creme e amarelo pedem fundo mais escuro', () => {
  expect(corEhClara('#FFFFFF')).toBe(true);
  expect(corEhClara('#E9E8E2')).toBe(true);
  expect(corEhClara('#FFD400')).toBe(true);
 });
 it('cinza médio, azul e preto ficam no fundo normal', () => {
  expect(corEhClara('#7C8798')).toBe(false);
  expect(corEhClara('#356DDD')).toBe(false);
  expect(corEhClara('#000000')).toBe(false);
 });
 it('cor ausente ou malformada não é clara', () => {
  expect(corEhClara(null)).toBe(false);
  expect(corEhClara('branco')).toBe(false);
 });
});
