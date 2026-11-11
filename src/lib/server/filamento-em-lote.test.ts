import Database from 'better-sqlite3';
import {drizzle} from 'drizzle-orm/better-sqlite3';
import {migrate} from 'drizzle-orm/better-sqlite3/migrator';
import {eq} from 'drizzle-orm';
import {expect,it} from 'vitest';
import * as schema from './db/schema';
import {registrarImpressao,estoqueDoRolo} from './repo';
import {atribuirFilamentoEmLote} from './filamento-em-lote';
function base(){
 const sqlite=new Database(':memory:');sqlite.pragma('foreign_keys=ON');const db=drizzle(sqlite,{schema});migrate(db,{migrationsFolder:'./drizzle'});
 const printer=db.insert(schema.impressora).values({nome:'A1',modelo:'A1',precoCompraCents:200000,vidaUtilHoras:5000,potenciaMediaW:100}).returning().get();
 const rolos=[10000,20000].map((preco,i)=>db.insert(schema.rolo).values({codigo:`R${i}`,marca:'Bambu Lab',material:'PLA',cor:i?'Azul':'Preto',precoPagoCents:preco,pesoLiquidoInicialG:1000,status:i?'vazio':'aberto'}).returning().get());
 const prints=[1,2,3].map(n=>registrarImpressao(db,{nomeLivre:`Peça ${n}`,impressoraId:printer.id,roloId:rolos[0].id,inicioEm:1000000+n,gramas:10,duracaoS:3600,status:'sucesso',finalidade:'pessoal',origem:'manual',observacoes:'Preservar'}));
 const rows=()=>db.select().from(schema.impressao).all();return {sqlite,db,rolos,prints,rows};
}
it('altera só a seleção, aceita rolo histórico, move consumo e preserva todo o restante',()=>{
 const c=base();const before=c.rows();const ids=c.prints.slice(0,2).map(i=>i.id);
 expect(atribuirFilamentoEmLote(c.db,[...ids,ids[0]],c.rolos[1].id,false)).toEqual({ok:true,alteradas:2,jaUsavam:0});
 expect(c.rows()).toEqual(before.map((r,n)=>n<2?{...r,roloId:c.rolos[1].id}:r));
 expect(estoqueDoRolo(c.db,c.rolos[0].id).restanteG).toBe(990);
 expect(estoqueDoRolo(c.db,c.rolos[1].id).restanteG).toBe(980);
 expect(atribuirFilamentoEmLote(c.db,ids,c.rolos[1].id,false)).toEqual({ok:true,alteradas:0,jaUsavam:2});
});
it('recálculo é explícito e só afeta as selecionadas',()=>{
 const c=base();const before=c.rows();
 expect(atribuirFilamentoEmLote(c.db,[c.prints[0].id],c.rolos[1].id,true).ok).toBe(true);
 const after=c.rows();expect(after[0].custoFilamentoCents).toBe(200);expect(after.slice(1)).toEqual(before.slice(1));
});
it.each([[],[0],[NaN],[1.5],[Infinity],[1,99999]].map(ids=>[ids]))('recusa seleção inválida ou desatualizada sem alterar parcialmente: %j',ids=>{
 const c=base();const before=c.rows();expect(atribuirFilamentoEmLote(c.db,ids,c.rolos[1].id,false).ok).toBe(false);expect(c.rows()).toEqual(before);
});
it('recusa destino inexistente e desfaz o lote inteiro se uma escrita falhar',()=>{
 const c=base();const before=c.rows();expect(atribuirFilamentoEmLote(c.db,[1],999,false).ok).toBe(false);
 c.sqlite.exec("CREATE TRIGGER falha_teste BEFORE UPDATE OF rolo_id ON impressao WHEN OLD.id=2 BEGIN SELECT RAISE(ABORT,'teste'); END;");
 expect(()=>atribuirFilamentoEmLote(c.db,[1,2],c.rolos[1].id,false)).toThrow();expect(c.rows()).toEqual(before);
});
