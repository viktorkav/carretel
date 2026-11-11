import { itensDaBiblioteca, itemDaBiblioteca } from '$lib/server/catalogo-arquivo';
import { novoEnvio } from '$lib/server/envio';
import { actions as acoesRolos } from '../+page.server';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = ({ url }) => ({
 itens: itensDaBiblioteca(), envio: novoEnvio(), selecionado: itemDaBiblioteca(url.searchParams.get('item'))
});
export const actions = { criar: acoesRolos.criar, criarDoCatalogo: acoesRolos.criarDoCatalogo };
