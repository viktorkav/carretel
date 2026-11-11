import {eq,inArray} from 'drizzle-orm';
import * as schema from './db/schema';
import {recalcularImpressao,type Db} from './repo';

type Resultado = {ok:true;alteradas:number;jaUsavam:number}|{ok:false;erro:string};
/** Corrige apenas os vínculos selecionados, em uma transação. Estoque é derivado;
 * os custos congelados só mudam quando a opção explícita de recálculo é enviada. */
export function atribuirFilamentoEmLote(db:Db,ids:number[],roloId:number,recalcular:boolean):Resultado {
 if(!Number.isSafeInteger(roloId)||roloId<=0) return {ok:false,erro:'Escolha o filamento correto.'};
 if(!ids.length||ids.length>5000||ids.some(id=>!Number.isSafeInteger(id)||id<=0)) return {ok:false,erro:'Selecione de 1 a 5.000 impressões válidas.'};
 const unicos=[...new Set(ids)];
 return db.transaction(tx=>{
  if(!tx.select({id:schema.rolo.id}).from(schema.rolo).where(eq(schema.rolo.id,roloId)).get()) return {ok:false,erro:'Este filamento não existe mais. Atualize a página e escolha outro.'} as const;
  const existentes:{id:number;roloId:number}[]=[];
  for(let n=0;n<unicos.length;n+=400) existentes.push(...tx.select({id:schema.impressao.id,roloId:schema.impressao.roloId}).from(schema.impressao).where(inArray(schema.impressao.id,unicos.slice(n,n+400))).all());
  if(existentes.length!==unicos.length) return {ok:false,erro:'Uma impressão selecionada não existe mais. Atualize a página e revise a seleção; nenhuma foi alterada.'} as const;
  const alteradas=existentes.filter(i=>i.roloId!==roloId);
  for(const i of alteradas){
   tx.update(schema.impressao).set({roloId}).where(eq(schema.impressao.id,i.id)).run();
   if(recalcular && !recalcularImpressao(tx,i.id)) throw new Error('Não foi possível recalcular a impressão.');
  }
  return {ok:true,alteradas:alteradas.length,jaUsavam:existentes.length-alteradas.length} as const;
 },{behavior:'immediate'});
}
