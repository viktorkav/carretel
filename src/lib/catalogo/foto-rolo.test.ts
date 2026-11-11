import { expect, it } from 'vitest';
import { fotoDoRolo } from './foto-rolo';
import type { ItemCatalogo } from './busca';
const item = {id:'10100',marca:'Bambu Lab',material:'PLA Basic',polimero:'PLA',cor:'Branco Jade',corAlias:'Jade White',corHex:'#FFFFFF',densidade:1.26,tempBico:220,tempMesa:55,codigoBambu:'GFA00',imagemUrl:'https://store.bblcdn.com/white.png'} satisfies ItemCatalogo;
it('associa a variante exata, inclusive ordem histórica do nome da cor', () => {
 expect(fotoDoRolo({...item,cor:'Jade Branco'},[item])).toBe(item.imagemUrl);
 expect(fotoDoRolo({...item,cor:'Jade White'},[item])).toBe(item.imagemUrl);
});
it('não reutiliza foto ao mudar cor ou linha, mesmo com ID antigo ou hex igual', () => {
 expect(fotoDoRolo({...item,cor:'Transparente',catalogoItemId:item.id},[item])).toBeUndefined();
 expect(fotoDoRolo({...item,material:'PLA Lite',catalogoItemId:item.id},[item])).toBeUndefined();
});
it('uma correspondência ambígua não escolhe uma foto arbitrariamente', () => {
 const outras = [item,{...item,id:'outra',imagemUrl:'https://store.bblcdn.com/outra.png'}];
 expect(fotoDoRolo(item,outras)).toBeUndefined();
 expect(fotoDoRolo({...item,catalogoItemId:item.id},outras)).toBe(item.imagemUrl);
});
