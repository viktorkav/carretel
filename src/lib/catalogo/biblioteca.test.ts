import { describe, expect, it } from 'vitest';
import { converterMarcaOfd, combinarBiblioteca, imagensBambu } from './biblioteca';
import type { ItemCatalogo } from './busca';

const legado: ItemCatalogo = { id: '10101', marca: 'Bambu Lab', material: 'PLA Basic', cor: 'Preto', corAlias: 'Black preto', corHex: '#000000', polimero: 'PLA', densidade: 1.26, tempBico: 220, tempMesa: 55, codigoBambu: 'GFA00' };
const fonte = {
 version: '2026.09.04', brand: { name: 'Bambu Lab', slug: 'bambu_lab', logo_name: 'logo.png', website: 'bambulab.com' },
 filaments: [{ id: 'pla', name: 'PLA Basic', material: 'PLA', density: 1.24, min_print_temperature: 190, max_print_temperature: 230, slicer_settings: { bambustudio: { id: 'GFA00', generic_id: 'GFA99' } } }],
 variants: [{ id: 'black', filament_id: 'pla', name: 'Black', color_hex: '#000000' }],
 sizes: [{ id: 's1', variant_id: 'black', diameter: 1.75, article_number: '10101', filament_weight: 1000 }],
 purchase_links: [{ size_id: 's1', url: 'https://us.store.bambulab.com/products/pla-basic?variant=123' }]
};

describe('biblioteca visual', () => {
 it('enriquece código de cor Bambu sem trocar identidade, tradução ou parâmetros legados', () => {
  const resultado = combinarBiblioteca([legado], converterMarcaOfd(fonte));
  expect(resultado).toHaveLength(1);
  expect(resultado[0]).toMatchObject({ id: '10101', cor: 'Preto', codigoBambu: 'GFA00', densidade: 1.26, produtoUrl: 'https://us.store.bambulab.com/products/pla-basic?variant=123' });
 });
 it('não inventa código específico a partir de perfil genérico', () => {
  const outra = structuredClone(fonte);
  outra.brand.name = 'Elegoo'; outra.brand.slug = 'elegoo';
  delete (outra.filaments[0].slicer_settings.bambustudio as { id?: string }).id;
  const itens = converterMarcaOfd(outra);
  expect(itens[0]).toMatchObject({ id: 'ofd:elegoo:black', codigoBambu: '', tempMesa: null, densidade: 1.24 });
 });
 it('não une Silk e Silk+ mesmo com cor idêntica', () => {
  const extra = { ...legado, id: 'novo', material: 'PLA Silk+', codigoBambu: 'GFA06' };
  expect(combinarBiblioteca([{ ...legado, material: 'PLA Silk', codigoBambu: 'GFA05' }], [extra])).toHaveLength(2);
 });
 it('recusa variante com densidade ausente sem fabricar uma especificação', () => {
  const ruim = structuredClone(fonte); delete (ruim.filaments[0] as { density?: number }).density;
  expect(converterMarcaOfd(ruim)).toEqual([]);
 });
 it('não deixa um artigo de outra linha sobrescrever o Bambu legado', () => {
  const outra = structuredClone(fonte); outra.filaments[0].name = 'PLA Silk+'; outra.filaments[0].slicer_settings.bambustudio.id = 'GFA06';
  expect(combinarBiblioteca([legado], converterMarcaOfd(outra))).toHaveLength(2);
 });
});

it('associa foto oficial por código de cor e linha, sem usar swatch ou imagem de outra cor', async () => {
 const { imagensBambu } = await import('./biblioteca');
 const html = '<script type="application/ld+json">' + JSON.stringify({ '@type': 'ProductGroup', name: 'PLA Basic', hasVariant: [
  { name: 'PLA Basic - Black (10101) / Filament with spool / 1kg', image: 'https://store.bblcdn.com/black.jpg', offers: { url: 'https://us.store.bambulab.com/products/pla-basic?id=1' } },
  { name: 'PLA Basic - White (10100) / Refill / 1kg', image: 'https://store.bblcdn.com/white.jpg', offers: { url: 'https://us.store.bambulab.com/products/pla-basic?id=2' } }
 ] }) + '</script>';
 expect(imagensBambu(html, [legado])[0]).toMatchObject({ id: '10101', imagemUrl: 'https://store.bblcdn.com/black.jpg' });
 expect(imagensBambu(html, [{ ...legado, material: 'PLA Matte' }])[0].imagemUrl).toBeUndefined();
});

it('prioriza código exato quando Blue também é prefixo de Blue Gray', () => {
 const azul = { ...legado, id: '10601', cor: 'Azul', corAlias: 'Blue azul' };
 const cinza = { ...legado, id: '10602', cor: 'Azul-Cinza', corAlias: 'Blue Gray azul cinza' };
 const f = structuredClone(fonte); f.variants[0].name = 'Blue'; f.sizes[0].article_number = '10601';
 const resultado = combinarBiblioteca([azul, cinza], converterMarcaOfd(f));
 expect(resultado).toHaveLength(2);
 expect(resultado[0].produtoUrl).toBeDefined();
 expect(resultado[1].produtoUrl).toBeUndefined();
});

it('não inclui variantes sem nome de cor', () => {
 const f = structuredClone(fonte); f.variants[0].name = '';
 expect(converterMarcaOfd(f)).toEqual([]);
});

it('não herda código Bambu que o catálogo legado associa a outra linha', () => {
 const asa = { ...legado, id: 'GFB01', cor: null, material: 'ASA', codigoBambu: 'GFB01' };
 const aero = { ...legado, id: 'aero', material: 'ASA Aero', codigoBambu: 'GFB01', fonteCatalogo: 'ofd' as const };
 expect(combinarBiblioteca([asa], [aero])[1].codigoBambu).toBe('');
});
it('une tradução de cor inequívoca pelo hex da mesma linha e código', () => {
 const creme = { ...legado, cor: 'Creme', corAlias: 'creme', corHex: '#F0EEDD' };
 const cream = { ...creme, id: 'ofd:bambu:cream', cor: 'Cream', corAlias: 'Cream' };
 expect(combinarBiblioteca([creme], [cream])).toHaveLength(1);
});

it('não funde duas cores novas porque usam o mesmo hex aproximado', () => {
 const a = { ...legado, id: 'a', marca: 'Elegoo', cor: 'Black', corAlias: 'Black', codigoBambu: '' };
 const b = { ...a, id: 'b', cor: 'Black Sparkle', corAlias: 'Black Sparkle' };
 expect(combinarBiblioteca([], [a, b])).toHaveLength(2);
});

it('não oferece aliases Bambu sem produto oficial nem código específico verificável', () => {
 const f = structuredClone(fonte);
 f.purchase_links = [];
 delete (f.filaments[0].slicer_settings.bambustudio as { id?: string }).id;
 expect(converterMarcaOfd(f)).toEqual([]);
});

it('não duplica SKU Bambu sem novo perfil quando a fonte reorganiza a linha comercial', () => {
 const historico = { ...legado, id: '10900', cor: 'Arctic Whisper' };
 const atual = { ...historico, id: 'ofd:bambu:arctic', material: 'PLA Basic Gradient', codigoBambu: '', codigosCorBambu: ['10900'], produtoUrl: 'https://us.store.bambulab.com/products/pla-basic-gradient' };
 const resultado = combinarBiblioteca([historico], [atual]);
 expect(resultado).toHaveLength(1);
 expect(resultado[0]).toMatchObject({ id: '10900', codigoBambu: 'GFA00', produtoUrl: atual.produtoUrl });
});

it('foto Gradient aceita a referência histórica PLA Basic somente com SKU exato', () => {
 const html = '<script type="application/ld+json">' + JSON.stringify({'@type':'ProductGroup',name:'PLA Basic Gradient',hasVariant:[{name:'PLA Basic Gradient - Dusk Glare (10906) / Filament with spool',image:'https://store.bblcdn.com/dusk.jpg'}]}) + '</script>';
 const resultado = imagensBambu(html,[{...legado,id:'10906'}, {...legado,id:'10101'}, {...legado,id:'10906',material:'PLA Silk'}]);
 expect(resultado[0].imagemUrl).toBe('https://store.bblcdn.com/dusk.jpg');
 expect(resultado[1].imagemUrl).toBeUndefined();
 expect(resultado[2].imagemUrl).toBeUndefined();
});

it('eSUN usa a imagem da variante PLA+ pela cor exata e não contamina outra linha ou marca', async () => {
 const { imagensEsun } = await import('./biblioteca');
 const html = '<span data-ui-id="page-title-wrapper">PLA+</span><script type="text/x-magento-init">' + JSON.stringify({ '[data-role=swatch-options]': { 'Magento_Swatches/js/swatch-renderer': { jsonConfig: {
  attributes: { '93': { code: 'color', options: [{ label: 'BLACK', products: [3017] }] } },
  images: { '3017': [{ img: 'https://www.esun3d.com/media/catalog/product/black.jpg', isMain: true, type: 'image' }] }
 } } } }) + '</script>';
 const base = { ...legado, marca: 'eSUN', material: 'PLA+', cor: 'Black' };
 const resultado = imagensEsun(html, [base, { ...base, cor: 'Black Glow' }, { ...base, marca: 'Elegoo' }, { ...base, material: 'PLA-HF' }]);
 expect(resultado[0]).toMatchObject({ imagemUrl: 'https://www.esun3d.com/media/catalog/product/black.jpg', produtoUrl: 'https://www.esun3d.com/pla-pro-product/' });
 expect(resultado.slice(1).every((i) => !i.imagemUrl)).toBe(true);
 expect(imagensEsun(html.replace('>PLA+<', '>PLA-HF<'), [base])[0].imagemUrl).toBeUndefined();
});

it.each([{hasVariant: {}}, {hasVariant: [null]}, {hasVariant: [{ name: 123 }]}, {hasVariant: [{ name: 'PLA Basic - Black (10101)', image: 'https://' }]}])('ignora mídia Bambu com estrutura inesperada sem interromper catálogo: %j', ({hasVariant}) => {
 const html = '<script type="application/ld+json">' + JSON.stringify({ '@type': 'ProductGroup', name: 'PLA Basic', hasVariant }) + '</script>';
 expect(imagensBambu(html, [legado])).toEqual([legado]);
});
