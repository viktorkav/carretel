import { normalizar, type ItemCatalogo } from './busca';
type ReferenciaRolo = { catalogoItemId?: string | null; marca: string; material: string; cor: string; corHex: string | null };
/** Foto só quando marca, linha e cor concordam; hex sozinho não identifica produto. */
export function fotoDoRolo(rolo: ReferenciaRolo, itens: ItemCatalogo[]): string | undefined {
 const nomeCor = (cor: string) => normalizar(cor).split(/\s+/).sort().join(' ');
 const mesmaFicha = (i: ItemCatalogo) => normalizar(i.marca) === normalizar(rolo.marca) && normalizar(i.material) === normalizar(rolo.material)
  && i.cor !== null && (nomeCor(i.cor) === nomeCor(rolo.cor) || (i.corAlias ?? '').split(/[,;|]/).some(a => nomeCor(a) === nomeCor(rolo.cor)));
 const exato = itens.find(i => i.id === rolo.catalogoItemId && mesmaFicha(i));
 if (exato?.imagemUrl) return exato.imagemUrl;
 const fotos = [...new Set(itens.filter(mesmaFicha).map(i => i.imagemUrl).filter((s): s is string => !!s))];
 return fotos.length === 1 ? fotos[0] : undefined;
}
