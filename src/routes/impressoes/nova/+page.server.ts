import { listarAtivos } from '$lib/server/filamentos-ativos';
import { db, schema } from '$lib/server/db';
import { saldoEParcelasDoRolo } from '$lib/server/repo';
import { descreverBase } from '$lib/previa-saldo';
import { dataHora } from '$lib/formato';
import { itensDaBiblioteca } from '$lib/server/catalogo-arquivo';
import { novoEnvio } from '$lib/server/envio';
import { actions as acoesImpressoes } from '../+page.server';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = () => {
 // O relógio do servidor no momento em que a tela é montada: a prévia do saldo
 // usa este instante, e não o do navegador, para saber se "em branco = agora"
 // cai depois da última pesagem.
 const agoraEm = Date.now();
 return {
  carregados: listarAtivos(db), envio: novoEnvio(), envioFilamento: novoEnvio(), itens: itensDaBiblioteca(),
  impressoras: db.select().from(schema.impressora).all(),
  rolos: db.select().from(schema.rolo).all().filter(r => r.status !== 'vazio' && r.status !== 'descartado')
   .map(r => {
    const { restanteG, baseG, consumidoG, baseEm } = saldoEParcelasDoRolo(db, r.id);
    return {
     ...r,
     restanteG,
     // O que a conferência precisa para prever o saldo com a regra daqui
     // (ver `$lib/previa-saldo`): as parcelas sem arredondar, o instante da
     // última pesagem e o fuso em que ESTE processo lê o campo de data.
     previa: descreverBase({ baseG, consumidoG, baseEm }, agoraEm),
     pesagemTexto: baseEm === null ? null : dataHora(baseEm)
    };
   })
 };
};
export const actions = { criar: acoesImpressoes.criar };
