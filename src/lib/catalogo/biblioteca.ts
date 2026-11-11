import { normalizar, type ItemCatalogo } from './busca.ts';

interface FonteOfd {
 version: string;
 brand: { name: string; slug: string; logo_name?: string; website?: string };
 filaments: Array<{ id: string; name: string; material: string; density?: number; min_print_temperature?: number; max_print_temperature?: number; min_bed_temperature?: number; max_bed_temperature?: number; slicer_settings?: { bambustudio?: { id?: string; generic_id?: string } } }>;
 variants: Array<{ id: string; filament_id: string; name: string; color_hex?: string }>;
 sizes?: Array<{ id: string; variant_id: string; diameter?: number; article_number?: string; filament_weight?: number }>;
 purchase_links?: Array<{ size_id: string; url: string }>;
}

const COMMIT_LOGOS = '52a8835e20ed9a0486941ef63d3664fdfc54ab56';
const media = (min?: number, max?: number): number | null => min !== undefined ? Math.round((min + (max ?? min)) / 2) : max ?? null;
function urlSegura(url: unknown): string | undefined {
 if (typeof url !== 'string') return undefined;
 try { return new URL(url).protocol === 'https:' ? url : undefined; } catch { return undefined; }
}

/** Converte somente variantes reais. Ausência de parâmetros nunca vira especificação inventada. */
export function converterMarcaOfd(fonte: FonteOfd): ItemCatalogo[] {
 const linhas = new Map(fonte.filaments.map((f) => [f.id, f]));
 const itens: ItemCatalogo[] = [];
 for (const variante of fonte.variants) {
  const linha = linhas.get(variante.filament_id);
  if (!linha || !linha.density || linha.density <= 0 || !variante.name?.trim()) continue;
  const tamanhos = (fonte.sizes ?? []).filter((s) => s.variant_id === variante.id && (s.diameter === undefined || s.diameter === 1.75));
  if ((fonte.sizes ?? []).some((s) => s.variant_id === variante.id) && !tamanhos.length) continue;
  const ids = new Set(tamanhos.map((s) => s.id));
  const dominio = fonte.brand.website?.replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/$/, '');
  const produto = (fonte.purchase_links ?? []).find((p) => {
   if (!ids.has(p.size_id) || !urlSegura(p.url) || !dominio) return false;
   const host = new URL(p.url).hostname;
   return host === dominio || host.endsWith(`.${dominio}`);
  });
  const codigo = linha.slicer_settings?.bambustudio?.id;
  if (fonte.brand.slug === 'bambu_lab' && !produto && !(codigo && /^GF[A-Z]+\d+$/.test(codigo))) continue;
  itens.push({
   id: `ofd:${fonte.brand.slug}:${variante.id}`, marca: fonte.brand.slug === 'esun_3d' ? 'eSUN' : fonte.brand.name,
   material: linha.name, polimero: linha.material, cor: variante.name, corAlias: variante.name,
   corHex: /^#[\da-f]{6}$/i.test(variante.color_hex ?? '') ? variante.color_hex!.toUpperCase() : null,
   densidade: linha.density, tempBico: media(linha.min_print_temperature, linha.max_print_temperature), tempMesa: media(linha.min_bed_temperature, linha.max_bed_temperature),
   codigoBambu: codigo && /^GF[A-Z]+\d+$/.test(codigo) ? codigo : '', fonteCatalogo: 'ofd',
   ...(produto ? { produtoUrl: produto.url } : {}),
   ...(fonte.brand.logo_name ? { logoUrl: `https://cdn.jsdelivr.net/gh/OpenFilamentCollective/open-filament-database@${COMMIT_LOGOS}/data/${fonte.brand.slug}/${fonte.brand.logo_name}` } : {}),
   fonteUrl: `https://api.openfilamentdatabase.org/json/brands/${fonte.brand.slug}.json`, versaoFonte: fonte.version,
   ...(fonte.brand.slug === 'bambu_lab' ? { codigosCorBambu: tamanhos.flatMap((s) => s.article_number ? [s.article_number] : []) } : {})
  });
 }
 return itens;
}

const mesmaLinha = (a: ItemCatalogo, b: ItemCatalogo): boolean => normalizar(a.marca) === normalizar(b.marca) && normalizar(a.material) === normalizar(b.material);
const mesmaCor = (a: ItemCatalogo, b: ItemCatalogo): boolean => {
 if (!a.cor || !b.cor) return false;
 if (normalizar(a.cor) === normalizar(b.cor)) return true;
 // O nome inglês original está no começo dos aliases do catálogo Bambu.
 return !!a.corAlias && normalizar(a.corAlias) !== normalizar(a.cor) && a.corHex === b.corHex && normalizar(a.corAlias).startsWith(`${normalizar(b.cor)} `);
};

/** Preserva IDs e parâmetros históricos; metadados visuais só enriquecem correspondências inequívocas. */
export function combinarBiblioteca(legado: ItemCatalogo[], adicionais: ItemCatalogo[]): ItemCatalogo[] {
 const itens = legado.map((i) => ({ ...i }));
 for (const entrada of adicionais) {
  const novo = { ...entrada };
  if (novo.marca === 'Bambu Lab' && novo.fonteCatalogo === 'ofd' && novo.codigoBambu) {
   const perfis = legado.filter((i) => i.marca === 'Bambu Lab' && (!novo.codigoBambu || i.codigoBambu === novo.codigoBambu));
   if (perfis.length && !perfis.some((i) => mesmaLinha(i, novo))) novo.codigoBambu = '';
  }
  const elegiveis = itens.filter((i) => (mesmaLinha(i, novo) || (i.marca === 'Bambu Lab' && novo.marca === 'Bambu Lab' && !novo.codigoBambu && i.polimero === novo.polimero && novo.codigosCorBambu?.includes(i.id))) && (!i.codigoBambu || !novo.codigoBambu || i.codigoBambu === novo.codigoBambu));
  const porCodigo = elegiveis.filter((i) => novo.codigosCorBambu?.includes(i.id));
  const porNome = elegiveis.filter((i) => mesmaCor(i, novo));
  const porHex = elegiveis.filter((i) => novo.marca === 'Bambu Lab' && legado.some((l) => l.id === i.id && !l.fonteCatalogo) && i.cor && novo.corHex && i.corHex === novo.corHex && (!novo.codigoBambu || i.codigoBambu === novo.codigoBambu));
  const candidatos = porCodigo.length ? porCodigo : porNome.length ? porNome : porHex.length === 1 ? porHex : [];
  if (candidatos.length === 1) {
   const alvo = candidatos[0];
   for (const campo of ['logoUrl', 'produtoUrl', 'imagemUrl', 'fonteUrl', 'versaoFonte'] as const) {
    if (novo[campo]) alvo[campo] = novo[campo];
   }
  } else if (!itens.some((i) => i.id === novo.id)) itens.push({ ...novo });
 }
 return itens;
}

/** Só o JSON-LD oficial da página de produto: nunca imagens decorativas ou swatches. */
export function imagensBambu(html: string, itens: ItemCatalogo[]): ItemCatalogo[] {
 const grupos: Array<{ name: string; hasVariant?: Array<{ name?: string; image?: string; offers?: { url?: string } }> }> = [];
 for (const match of html.matchAll(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g)) {
  try { const grupo = JSON.parse(match[1]); if (grupo['@type'] === 'ProductGroup' && typeof grupo.name === 'string') grupos.push(grupo); } catch { /* dados opcionais inválidos não substituem catálogo */ }
 }
 return itens.map((item) => {
  if (item.marca !== 'Bambu Lab' || !item.cor) return item;
  for (const grupo of grupos) {
   // A família Gradient aparecia como PLA Basic no catálogo histórico.
   // A seleção abaixo ainda exige o SKU de cor exato da variante oficial.
   const gradientHistorico = normalizar(grupo.name) === 'pla basic gradient' && normalizar(item.material) === 'pla basic';
   if (normalizar(grupo.name) !== normalizar(item.material) && !gradientHistorico) continue;
   if (!Array.isArray(grupo.hasVariant)) continue;
   const variantes = grupo.hasVariant.filter((v) => {
    if (!v || typeof v.name !== 'string') return false;
    const codigo = v.name?.match(/\((\d{5})\)/)?.[1];
    return codigo && (codigo === item.id || item.codigosCorBambu?.includes(codigo));
   });
   // A variante com carretel é preferida apenas entre correspondências exatas da mesma cor.
   const variante = variantes.find((v) => v.name?.includes('Filament with spool')) ?? variantes[0];
   const foto = urlSegura(variante?.image);
   if (foto && new URL(foto).hostname === 'store.bblcdn.com') return { ...item, imagemUrl: foto, ...(urlSegura(variante?.offers?.url) ? { produtoUrl: variante!.offers!.url } : {}) };
  }
  return item;
 });
}

/** A configuração Magento relaciona cada cor aos IDs e imagens reais dos produtos eSUN PLA+. */
export function imagensEsun(html: string, itens: ItemCatalogo[]): ItemCatalogo[] {
 const titulo = html.match(/<span[^>]*data-ui-id="page-title-wrapper"[^>]*>([\s\S]*?)<\/span>/)?.[1].trim();
 if (titulo !== 'PLA+') return itens;
 type Config = {
  attributes?: Record<string, { code?: string; options?: Array<{ label: string; products?: Array<number | string> }> }>;
  images?: Record<string, Array<{ img?: string; isMain?: boolean; type?: string }>>;
 };
 const fotos = new Map<string, string>();
 for (const match of html.matchAll(/<script[^>]*type="text\/x-magento-init"[^>]*>([\s\S]*?)<\/script>/g)) {
  try {
   const bloco = JSON.parse(match[1]);
   const config: Config | undefined = bloco['[data-role=swatch-options]']?.['Magento_Swatches/js/swatch-renderer']?.jsonConfig;
   const cores = Object.values(config?.attributes ?? {}).find((a) => a.code === 'color');
   for (const cor of cores?.options ?? []) {
    const imagens = (cor.products ?? []).flatMap((id) => config?.images?.[String(id)] ?? []).filter((i) => i.type === 'image');
    const url = urlSegura((imagens.find((i) => i.isMain) ?? imagens[0])?.img);
    if (url && new URL(url).hostname === 'www.esun3d.com') fotos.set(normalizar(cor.label), url);
   }
  } catch { /* metadados opcionais não derrubam a biblioteca */ }
 }
 return itens.map((item) => {
  if (normalizar(item.marca) !== 'esun' || item.material !== 'PLA+' || !item.cor) return item;
  const foto = fotos.get(normalizar(item.cor));
  return foto ? { ...item, imagemUrl: foto, produtoUrl: 'https://www.esun3d.com/pla-pro-product/' } : item;
 });
}
