import { atribuirFilamentoEmLote } from '$lib/server/filamento-em-lote';
import { fail } from '@sveltejs/kit';
import { and, desc, eq, gte, type SQL } from 'drizzle-orm';
import { db, schema } from '$lib/server/db';
import { CAMPO_ENVIO, novoEnvio, registrarEnvio } from '$lib/server/envio';
import { resolverImagem } from '$lib/server/imagens';
import { normalizarFinalidade } from '$lib/finalidade';
import {
	aplicarFinalidadeEmLote,
	registrarImpressao,
	saldoEParcelasDoRolo
} from '$lib/server/repo';
import {
	campoDataHora,
	campoId,
	campoIds,
	campoNumericoPositivo,
	ecoDoFormulario
} from '$lib/server/formulario';
import { casaBusca, desdeEm, lerRecorte, paginar, subtotal } from '$lib/recorte';
import {
	COOKIE_VISUALIZACAO,
	PARAM_VISUALIZACAO,
	VALIDADE_VISUALIZACAO_S,
	escolherVisualizacao
} from '$lib/visualizacao';
import { duracaoParaSegundos } from './duracao';
import type { PageServerLoad } from './$types';
// Estas actions são compartilhadas com a rota dedicada de cadastro e só leem request.
import type { Actions } from '@sveltejs/kit';

export const load: PageServerLoad = async ({ url, cookies }) => {
	// A escolha vem antes do banco de propósito: ela não depende de dado nenhum,
	// e um valor hostil na query não pode ser motivo para a consulta não sair.
	// `escolherVisualizacao` não lança e não devolve nada fora da lista fechada.
	const escolha = escolherVisualizacao({
		query: url.searchParams.get(PARAM_VISUALIZACAO),
		cookie: cookies.get(COOKIE_VISUALIZACAO)
	});

	if (escolha.gravar) {
		cookies.set(COOKIE_VISUALIZACAO, escolha.gravar, {
			path: '/',
			maxAge: VALIDADE_VISUALIZACAO_S,
			// Nada de JavaScript lê isto — quem lê é o `load`, aqui. Fechar o
			// cookie para script é de graça e tira uma superfície da mesa.
			httpOnly: true,
			sameSite: 'lax',
			// ⚠️ `false` EXPLÍCITO, e não descuido. O SvelteKit marca `secure` por
			// padrão em tudo que não seja `localhost`, e o Carretel pode rodar por HTTP
			// na rede local: com `secure`, o navegador
			// descartaria o cookie em silêncio e a preferência nunca seria
			// lembrada em produção — só na máquina de desenvolvimento. O que está
			// guardado aqui é uma de duas palavras públicas, não credencial.
			secure: false
		});
	}

	// TODOS os rolos alimentam o filtro, inclusive vazio e descartado: filtrar o
	// histórico por um rolo que acabou é justamente o caso de uso ("o que saiu
	// daquele PLA preto que comprei em março?"). É outra lista, e não a mesma
	// do formulário de registro, que só oferece rolo que ainda imprime.
	const rolosDoFiltro = db
		.select({
			id: schema.rolo.id,
			codigo: schema.rolo.codigo,
			marca: schema.rolo.marca,
			material: schema.rolo.material,
			cor: schema.rolo.cor,
			corHex: schema.rolo.corHex
		})
		.from(schema.rolo)
		.orderBy(desc(schema.rolo.id))
		.all();

	// A leitura do recorte vem antes do banco pelo mesmo motivo da
	// visualização: ela não depende de dado nenhum e não lança. Valor hostil na
	// query não vira 400 nem 500 — vira "não filtrei por isso".
	const recorte = lerRecorte(url.searchParams, { rolos: rolosDoFiltro.map((r) => r.id) });

	// Período, finalidade, status e rolo são comparações exatas e vão para o
	// SQL. A BUSCA fica em memória de propósito: ela dobra acento e caixa
	// ("peca" acha "Peça"), e o `LIKE` do SQLite só é insensível a caixa em
	// ASCII — no banco, procurar "peca" não acharia nada.
	const desde = desdeEm(recorte, Date.now());
	const condicoes: SQL[] = [];
	if (desde !== null) condicoes.push(gte(schema.impressao.inicioEm, new Date(desde)));
	if (recorte.finalidade !== 'todas')
		condicoes.push(eq(schema.impressao.finalidade, recorte.finalidade));
	if (recorte.status !== 'todos') condicoes.push(eq(schema.impressao.status, recorte.status));
	if (recorte.roloId !== null) condicoes.push(eq(schema.impressao.roloId, recorte.roloId));

	const doRecorte = db
		.select()
		.from(schema.impressao)
		.where(condicoes.length > 0 ? and(...condicoes) : undefined)
		.orderBy(desc(schema.impressao.inicioEm))
		.all()
		.filter((i) => casaBusca(i.nomeLivre, recorte.busca));

	// O subtotal é do RECORTE INTEIRO, e é ele que transforma a lista em
	// instrumento: "estas 14 de estúdio somam R$ 63,20" responde uma pergunta,
	// catorze linhas não respondem nenhuma. Somar só a página faria o número
	// mudar ao virar de página, que é a pior coisa que um total pode fazer.
	const total = subtotal(doRecorte);
	const pagina = paginar(doRecorte.length, recorte.pagina);
	const linhas = doRecorte.slice(pagina.inicio, pagina.fim);

	// O caminho no disco não sai do servidor — a lista só precisa saber quais
	// linhas têm capa, para decidir se a coluna de miniatura existe.
	//
	// A pergunta é feita ao disco (um `stat` por linha, e agora só pelas linhas
	// DA PÁGINA), e não à coluna: uma linha apontando para arquivo que não
	// existe renderizaria um `<img>` que a rota recusa, e o navegador desenha o
	// ícone de imagem quebrada. Miniatura só aparece quando ela existe de verdade.
	const impressoes = await Promise.all(
		linhas.map(async ({ imagemPath, ...i }) => ({
			...i,
			filamento: rolosDoFiltro.find(r => r.id === i.roloId) ?? null,
			temImagem: (await resolverImagem(imagemPath)).ok
		}))
	);

	return {
		impressoes,
		recorte,
		total,
		pagina,
		rolosDoFiltro,
		// ── integração `crit-fluxo` × `crit-leitura` ──────────────────────────
		// A reclassificação em lote e a paginação chegaram na mesma tela, e a
		// unidade de cada uma era diferente: o lote da `crit-fluxo` era "as
		// linhas que o servidor desenhou" (a página, depois que a `crit-leitura`
		// entrou), e o subtotal da `crit-leitura` é do RECORTE inteiro.
		//
		// Deixar as duas como estavam faria a tela dizer "119 impressões" no
		// cabeçalho e reclassificar 50. O escopo do lote passa a ser o recorte —
		// que é o que o usuário filtrou e o que o subtotal conta.
		//
		// Continuam sendo ids DESENHADOS PELO SERVIDOR, e não um `where` refeito
		// no POST: a garantia que a `crit-fluxo` escreveu ("o lote é exatamente
		// o que está na tela, não o que existir no banco na hora do POST") vale
		// igual, só que sobre o recorte em vez da página. `doRecorte` já está em
		// memória — é dele que sai o subtotal —, então isto não custa consulta.
		idsDoRecorte: doRecorte.map((i) => i.id),
		visualizacao: escolha.visualizacao,
		// Token desta renderização — ver `$lib/server/envio`. Sem ele, dois
		// toques em "Registrar" viram duas impressões, e cada uma debita o rolo.
		envio: novoEnvio(),
		// A coluna de miniatura só nasce quando há o que mostrar: numa base só de
		// lançamentos manuais ela seria uma faixa vazia de página inteira.
		//
		// Vale só para a TABELA. Na grade o slot da capa existe sempre: ele é o
		// que dá a todos os cards a mesma altura, e é o que faz a peça lançada à
		// mão parecer uma peça sem foto em vez de um card quebrado.
		temMiniaturas: impressoes.some((i) => i.temImagem),
		impressoras: db.select().from(schema.impressora).all(),
		// Este formulário é o "acabei de imprimir", e rolo vazio ou descartado não
		// imprime nada. Some da lista pelo mesmo motivo que a importação passou a
		// recusá-lo: depois da fusão existem rolos vazios FABRICADOS (o filamento
		// que não tinha rolo virou um), com material, cor e código vizinhos aos
		// reais — e um deles escolhido por engano grava custo zero, congelado.
		//
		// A tela de correção (`/impressoes/[id]`) continua listando todos de
		// propósito: lá o caso legítimo existe (lançar ou corrigir uma peça antiga,
		// de um rolo que já acabou desde então), e a escolha é deliberada.
		rolos: db
			.select()
			.from(schema.rolo)
			.all()
			.filter((r) => r.status !== 'vazio' && r.status !== 'descartado')
	};
};

export const actions: Actions = {
 filamentoEmLote: async ({request}) => {
  const form = await request.formData();
  const ids = form.getAll(form.get('escopo') === 'todas' ? 'listada' : 'marcada').map(v => Number(String(v)));
  const roloId = Number(form.get('roloLote'));
  const recalcular = form.get('recalcularLote') === 'on';
  const eco = {idsFilamentoLote:ids.filter(Number.isSafeInteger),roloFilamentoLote:String(form.get('roloLote') ?? ''),recalcularFilamentoLote:recalcular};
  try {
   const r = atribuirFilamentoEmLote(db,ids,roloId,recalcular);
   if(!r.ok) return fail(400,{erroFilamentoLote:r.erro,...eco});
   return {sucessoFilamentoLote:`${r.alteradas} ${r.alteradas === 1 ? 'impressão alterada' : 'impressões alteradas'}. ${r.jaUsavam ? `${r.jaUsavam} já usavam este filamento. ` : ''}${recalcular ? 'Custos das alteradas recalculados.' : 'Custos registrados preservados.'}`};
  } catch {
   return fail(500,{erroFilamentoLote:'Não foi possível aplicar o lote. Nenhuma impressão foi alterada. Tente novamente.',...eco});
  }
 },

	criar: async ({ request }) => {
		const form = await request.formData();

		// ── o que foi digitado volta com o erro ───────────────────────────────
		// Errar um campo devolvia o formulário INTEIRO vazio: doze campos
		// redigitados por causa de uma vírgula. O padrão certo já existia em
		// `criarDoCatalogo`, que devolve marca e cor junto do `fail`; aqui ele
		// vira regra. `campo` é a chave do que falhou — a tela usa para marcar o
		// `aria-invalid` e repetir a mensagem ao lado dele, em vez de deixá-la a
		// 1.400 px de distância.
		const eco = ecoDoFormulario(form, [
			'nomeLivre',
			'impressoraId',
			'roloId',
			'inicioEm',
			'duracao',
			'gramas',
			'status',
			'motivoFalha',
			'camadaMm',
			'paredes',
			'infillPct',
			'finalidade'
		]);
		const recusar = (erro: string, campo: string) => fail(400, { erro, campo, valores: eco });

		const nomeLivre = String(form.get('nomeLivre') ?? '').trim();
		if (!nomeLivre) return recusar('peça é obrigatória', 'nomeLivre');

		// Ausente, vazio, "abc", "0" e negativo caem todos aqui: nenhum é um id
		// válido, então nem chega a consultar o banco.
		const impressora = campoId(form.get('impressoraId'), 'escolha uma impressora');
		if (!impressora.ok) return recusar(impressora.erro, 'impressoraId');
		const impressoraId = impressora.valor;

		const rolo = campoId(form.get('roloId'), 'escolha um rolo');
		if (!rolo.ok) return recusar(rolo.erro, 'roloId');
		const roloId = rolo.valor;

		// `new Date('abc').getTime()` é NaN, e NaN num `inicioEm` notNull vira
		// `NOT NULL constraint failed` — 500 por entrada de formulário. Vazio
		// continua significando "agora".
		const inicioEm = campoDataHora(form.get('inicioEm'), Date.now());
		if (!inicioEm.ok) return recusar(inicioEm.erro, 'inicioEm');

		// Id com formato válido mas que não existe no banco (ex.: "99999")
		// precisa ser pego AQUI — registrarImpressao faz `throw new Error(...)`
		// nesse caso, e essa action não pode deixar um throw de repositório
		// virar 500 por causa de entrada de formulário.
		const impressoraExiste = db
			.select({ id: schema.impressora.id })
			.from(schema.impressora)
			.where(eq(schema.impressora.id, impressoraId))
			.get();
		if (!impressoraExiste) return recusar('impressora não encontrada', 'impressoraId');

		const roloExiste = db
			.select({ id: schema.rolo.id })
			.from(schema.rolo)
			.where(eq(schema.rolo.id, roloId))
			.get();
		if (!roloExiste) return recusar('rolo não encontrado', 'roloId');

		const gramas = campoNumericoPositivo(form.get('gramas'), NaN, 'gramas');
		if (!gramas.ok) return recusar(gramas.erro, 'gramas');
		if (!Number.isFinite(gramas.valor)) return recusar('gramas é obrigatório', 'gramas');

		const camadaMm = campoNumericoPositivo(form.get('camadaMm'), 0, 'camada');
		if (!camadaMm.ok) return recusar(camadaMm.erro, 'camadaMm');

		const paredes = campoNumericoPositivo(form.get('paredes'), 0, 'paredes');
		if (!paredes.ok) return recusar(paredes.erro, 'paredes');

		const infillPct = campoNumericoPositivo(form.get('infillPct'), 0, 'infill');
		if (!infillPct.ok) return recusar(infillPct.erro, 'infillPct');

		// Antes da escrita e sem `await` no meio. Duas impressões idênticas
		// debitariam o rolo duas vezes e dobrariam o custo da peça no painel.
		if (registrarEnvio(form.get(CAMPO_ENVIO)) === 'repetido') {
			return {
				sucesso: true,
				repetido: true,
				aviso: 'essa impressão já tinha sido registrada; nada foi gravado duas vezes.'
			};
		}

		// O saldo do rolo ANTES de gravar, lido pela mesma função que a tela de
		// filamentos usa. Ele e o de depois vão na resposta só para a tela de
		// resultado mostrar o que acabou de acontecer com números do banco, e
		// não com uma conta refeita no navegador: nada aqui muda o que é gravado
		// nem como o custo é calculado.
		const roloDoRegistro = db
			.select()
			.from(schema.rolo)
			.where(eq(schema.rolo.id, roloId))
			.get();
		const antes = saldoEParcelasDoRolo(db, roloId);

		const registro = registrarImpressao(db, {
			nomeLivre,
			impressoraId,
			roloId,
			inicioEm: inicioEm.valor,
			duracaoS: duracaoParaSegundos(String(form.get('duracao') ?? '')),
			gramas: gramas.valor,
			status: String(form.get('status') ?? 'sucesso') as 'sucesso' | 'falha' | 'cancelada',
			motivoFalha: String(form.get('motivoFalha') ?? '').trim() || null,
			camadaMm: camadaMm.valor || null,
			paredes: paredes.valor || null,
			infillPct: infillPct.valor || null,
			finalidade: String(form.get('finalidade') ?? 'outro') as
				| 'estudio'
				| 'homelab'
				| 'conteudo'
				| 'pessoal'
				| 'outro',
			origem: 'manual'
		});

		const depois = saldoEParcelasDoRolo(db, roloId);

		return {
			sucesso: true,
			registro: {
				id: registro.id,
				nomeLivre: registro.nomeLivre,
				gramas: registro.gramas,
				duracaoS: registro.duracaoS,
				status: registro.status,
				finalidade: registro.finalidade,
				custoFilamentoCents: registro.custoFilamentoCents,
				custoEnergiaCents: registro.custoEnergiaCents,
				custoDepreciacaoCents: registro.custoDepreciacaoCents,
				custoManutencaoCents: registro.custoManutencaoCents,
				custoTotalCents: registro.custoTotalCents
			},
			saldo: roloDoRegistro
				? {
						roloId,
						codigo: roloDoRegistro.codigo,
						marca: roloDoRegistro.marca,
						material: roloDoRegistro.material,
						cor: roloDoRegistro.cor,
						corHex: roloDoRegistro.corHex,
						pesoLiquidoInicialG: roloDoRegistro.pesoLiquidoInicialG,
						antesG: antes.restanteG,
						depoisG: depois.restanteG,
						// POR QUE o saldo ficou como ficou, dito pelos dados e não
						// deduzido de "antes === depois": a impressão entrou na conta se
						// o consumo descontado pelo domínio cresceu com ela. Saldo igual
						// com a impressão contada é limite em zero ou arredondamento, e
						// não data antiga.
						entrouNoSaldo: depois.consumidoG > antes.consumidoG,
						inicioEm: registro.inicioEm.getTime(),
						pesagemEm: depois.baseEm
					}
				: null
		};
	},

	/**
	 * Reclassificar a finalidade de várias impressões de uma vez.
	 *
	 * As 11 impressões reais entraram todas como `outro` porque a importação
	 * tinha um seletor só para o lote inteiro. Aquilo foi consertado na origem;
	 * isto é a saída para o passivo — sem ela, corrigir as onze custa cinco
	 * interações cada, e o card "Por finalidade" continua uma barra de 100%.
	 *
	 * Dois escopos, dois botões de envio no MESMO formulário, e isso é o que
	 * mantém a tela funcionando sem JavaScript: "às marcadas" lê as caixas, e
	 * "a todas as listadas" lê os ids que o servidor desenhou como campos
	 * escondidos. Um "marcar todas" no cliente seria um controle falso para quem
	 * está sem script.
	 */
	finalidadeEmLote: async ({ request }) => {
		const form = await request.formData();

		const alvo = normalizarFinalidade(form.get('finalidadeLote'));
		if (!alvo) return fail(400, { erroLote: 'escolha uma finalidade para aplicar' });

		// O escopo vem do botão apertado (`name="escopo"` no `<button>`), então
		// qualquer outra coisa é adulteração e cai no escopo mais estreito.
		const todas = form.get('escopo') === 'todas';
		const ids = campoIds(form, todas ? 'listada' : 'marcada');
		if (ids.length === 0) {
			return fail(400, {
				erroLote: todas
					? 'não há impressão nenhuma nesta lista'
					: 'marque pelo menos uma impressão para reclassificar'
			});
		}

		const alteradas = aplicarFinalidadeEmLote(db, ids, alvo);
		return { sucessoLote: alteradas, finalidadeLote: alvo };
	}
};
