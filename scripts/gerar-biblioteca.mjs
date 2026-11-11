#!/usr/bin/env node
/** Biblioteca local de variantes OFD e metadados visuais oficiais. Node 22.18+. */
import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { converterMarcaOfd, combinarBiblioteca, imagensBambu, imagensEsun } from '../src/lib/catalogo/biblioteca.ts';

import { validarCatalogo } from '../src/lib/catalogo/validacao.ts';

const basePath = resolve(process.env.CATALOGO_PATH ?? 'catalogo-bambu.json');
const destino = resolve(process.env.BIBLIOTECA_PATH ?? join(dirname(basePath), 'catalogo-biblioteca.json'));
const slugs = ['bambu_lab', 'creality', 'elegoo', 'esun_3d', 'sunlu'];
const fontes = [];
const avisos = [];
let itens = JSON.parse(await readFile(basePath, 'utf8')).itens;
const versoes = [];
const cacheDir = process.env.BIBLIOTECA_CACHE_DIR;

async function baixar(url) {
 const resposta = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(35000) });
 if (!resposta.ok) throw new Error(`HTTP ${resposta.status}: ${url}`);
 return resposta.text();
}

for (const slug of slugs) {
 const url = `https://api.openfilamentdatabase.org/json/brands/${slug}.json`;
 const texto = cacheDir ? await readFile(join(cacheDir, `${slug}.json`), 'utf8') : await baixar(url);
 const fonte = JSON.parse(texto);
 const convertidos = converterMarcaOfd(fonte);
 if (!convertidos.length) throw new Error(`Nenhuma variante utilizável em ${slug}; arquivo anterior preservado.`);
 itens = combinarBiblioteca(itens, convertidos);
 fontes.push({ url, versao: fonte.version, sha256: createHash('sha256').update(texto).digest('hex'), variantes: convertidos.length });
 versoes.push(fonte.version);
 console.log(`${fonte.brand.name}: ${convertidos.length} variantes`);
}

// Páginas descobertas nos links oficiais OFD; sem adivinhar slugs ou URLs de imagens.
for (const arquivo of ['catalogo-multfila.json', 'catalogo-marcas-br.json']) {
 try {
  const fonte = JSON.parse(await readFile(new URL(arquivo, import.meta.url), 'utf8'));
  itens = combinarBiblioteca(itens, fonte.itens ?? fonte);
  fontes.push({ tipo: 'curadoria de fontes oficiais brasileiras', arquivo, atualizadoEm: fonte.geradoEm ?? '2026-09-05' });
 } catch (erro) {
  if (erro.code !== 'ENOENT') throw erro;
 }
}
const paginas = process.env.BIBLIOTECA_SEM_IMAGENS === '1' ? [] : [...new Set(itens.filter((i) => i.marca === 'Bambu Lab' && i.produtoUrl).map((i) => {
 const url = new URL(i.produtoUrl); url.search = ''; return url.href;
}))];
const inicioMidia = Date.now();
for (let inicio = 0; inicio < paginas.length; inicio += 1) {
 if (Date.now() - inicioMidia > 90000) { avisos.push('Tempo de atualização de fotos esgotado; demais dados foram preservados.'); break; }
 const resultados = await Promise.allSettled(paginas.slice(inicio, inicio + 1).map(async (url) => ({ url, html: await baixar(url) })));
 for (const resultado of resultados) {
  if (resultado.status === 'fulfilled') {
   itens = imagensBambu(resultado.value.html, itens);
   fontes.push({ url: resultado.value.url, tipo: 'imagens oficiais por código de cor' });
  } else avisos.push(String(resultado.reason));
 }
}

if (process.env.BIBLIOTECA_SEM_IMAGENS !== '1') {
 const url = 'https://www.esun3d.com/pla-pro-product/';
 try {
  itens = imagensEsun(await baixar(url), itens);
  fontes.push({ url, tipo: 'imagens oficiais eSUN PLA+ por cor e ID de produto Magento' });
 } catch (erro) { avisos.push(String(erro)); }
}
// Falha temporária da mídia não apaga fotos já verificadas numa atualização anterior.
try {
 const anterior = JSON.parse(await readFile(destino, 'utf8'));
 const fotos = new Map(anterior.itens.filter((i) => i.imagemUrl).map((i) => [i.id, i]));
 itens = itens.map((i) => {
  const salvo = fotos.get(i.id);
  return !i.imagemUrl && salvo && salvo.marca === i.marca && salvo.material === i.material && salvo.cor === i.cor
   ? { ...i, imagemUrl: salvo.imagemUrl } : i;
 });
} catch { /* primeira geração */ }
if (cacheDir) {
 // Páginas oficiais previamente capturadas permitem repetir a geração sem rede.
 const { readdir } = await import('node:fs/promises');
 for (const nome of (await readdir(cacheDir)).filter((n) => n.endsWith('.html'))) {
  const html = await readFile(join(cacheDir, nome), 'utf8');
  itens = imagensEsun(html, imagensBambu(html, itens));
 }
}
const biblioteca = {
 fonte: 'Bambu Studio + Open Filament Database + curadoria de fontes oficiais',
 licencaFonte: 'Bambu Studio: AGPL-3.0; OFD: MIT; mídia: fabricantes, referenciada por URL',
 commit: '52a8835e20ed9a0486941ef63d3664fdfc54ab56',
 geradoEm: new Date().toISOString(), versoesOfd: [...new Set(versoes)], fontes, avisos, itens
};
const validado = validarCatalogo(biblioteca);
if (!validado.ok) throw new Error(`Biblioteca inválida: ${validado.erro}; arquivo anterior preservado.`);
await mkdir(dirname(destino), { recursive: true });
const temporario = `${destino}.${process.pid}.tmp`;
await writeFile(temporario, JSON.stringify(biblioteca, null, 2) + '\n');
await rename(temporario, destino);
console.log(`${itens.length} itens, ${itens.filter((i) => i.imagemUrl).length} fotos oficiais. ${destino}`);
if (avisos.length) console.warn(`${avisos.length} páginas sem imagem; dados do catálogo continuam locais.`);
