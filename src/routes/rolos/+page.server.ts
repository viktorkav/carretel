/**
 * A tela única de filamento.
 *
 * Havia duas — `/filamentos` (o TIPO) e `/rolos` (a unidade física) — e o dono
 * tropeçou nas duas: foi procurar o preço na tela do tipo, e depois perguntou
 * por que existiam as duas. A fusão deixou só o rolo, e esta é a porta de
 * entrada dele.
 *
 * **Na interface ele se chama "filamento"**, que é a palavra que o dono usa
 * ("cadê o preço do filamento?"). No código continua `rolo`, que é o nome que
 * a lógica de custo e estoque já usa e que diz a verdade sobre o que a linha é.
 * `/filamentos` redireciona para cá, para não quebrar o caminho que ele já
 * tinha na cabeça.
 */
import { fail, redirect } from '@sveltejs/kit';
import { desc, eq } from 'drizzle-orm';
import { fotoDoRolo } from '$lib/catalogo/foto-rolo';
import { listarAtivos, ativarFilamento, desativarFilamento } from '$lib/server/filamentos-ativos';
import { buscarNoCatalogo } from '$lib/catalogo/busca';
import { lerCodigo } from '$lib/codigo';
import { estadoDoCatalogo, itemPorId, itensDoCatalogo, itemDaBiblioteca, itensDaBiblioteca } from '$lib/server/catalogo-arquivo';
import { db, schema } from '$lib/server/db';
import { dadosDoItem } from '$lib/server/catalogo';
import { estaEncerrado, lerMotivo } from '$lib/server/encerramento';
import { CAMPO_ENVIO, devolverEnvio, novoEnvio, registrarEnvio, lembrarRoloDoEnvio, roloDoEnvio } from '$lib/server/envio';
import { alertasDoRolo, resolverPesagem, validarPesoAferido } from '$lib/server/estoque';
import {
	contarImpressoesDoRolo,
	criarRolo,
	dependentesDoRolo,
	editarRolo,
	encerrarRolo,
	estoqueDoRolo,
	excluirAfericao,
	excluirRolo,
	pesagemFinalDoRolo,
	reabrirRolo,
	rendimentoDoRolo
} from '$lib/server/repo';
import {
	campoCorHex,
	campoId,
	campoNumericoNaoNegativoOpcional,
	campoNumericoObrigatorio,
	campoNumericoOpcional,
	campoNumericoPositivo,
	campoPreco,
	campoPrecoObrigatorio,
	ecoDoFormulario
} from '$lib/server/formulario';
import type { PageServerLoad } from './$types';
// Estas actions são compartilhadas com a rota dedicada de cadastro e só leem request.
import type { Actions } from '@sveltejs/kit';

const STATUS_ROLO = ['fechado', 'aberto', 'vazio', 'descartado'] as const;
type StatusRolo = (typeof STATUS_ROLO)[number];

function idDaQuery(valor: string | null): number | null {
	const n = Number(valor ?? '');
	return Number.isInteger(n) && n > 0 ? n : null;
}

/**
 * A ficha de um rolo para a lista: estoque derivado + alertas.
 *
 * **Rolo encerrado não alerta.** Ele quase sempre bate os dois gatilhos de
 * "acabando" (é para isso que foi encerrado) e, se estiver aberto há tempo, o
 * de umidade — e alertar sobre um rolo que o dono acabou de declarar fora de
 * uso é exatamente o barulho que o botão de encerrar existe para calar.
 */
function fichaDoRolo(r: typeof schema.rolo.$inferSelect, agora: number) {
	const estoque = estoqueDoRolo(db, r.id);
	// O número que a regra de umidade usa (dias desde a última secagem ou, sem
	// secagem, desde a abertura), para o aviso do rolo dizer há quanto tempo.
	const referenciaDaSecagem = r.dataUltimaSecagem ?? r.dataAbertura;
	return {
		...r,
		imagemUrl: fotoDoRolo(r, itensDaBiblioteca()),
		diasSemSecar: referenciaDaSecagem
			? Math.floor((agora - referenciaDaSecagem.getTime()) / 86_400_000)
			: null,
		secagemRegistrada: r.dataUltimaSecagem !== null,
		estoque,
		alertas: estaEncerrado(r.status)
			? []
			: alertasDoRolo({
					restanteG: estoque.restanteG,
					pesoInicialG: r.pesoLiquidoInicialG,
					dataAbertura: r.dataAbertura ? r.dataAbertura.getTime() : null,
					dataUltimaSecagem: r.dataUltimaSecagem ? r.dataUltimaSecagem.getTime() : null,
					agora
				})
	};
}

export const load: PageServerLoad = async ({ url }) => {
	const rolos = db.select().from(schema.rolo).orderBy(desc(schema.rolo.id)).all();
	const agora = Date.now();
	const q = url.searchParams.get('q') ?? '';
	const estadoCatalogo = estadoDoCatalogo();
	const resultado = buscarNoCatalogo(itensDoCatalogo(), q);

	const idEditar = idDaQuery(url.searchParams.get('editar'));
	const idExcluir = idDaQuery(url.searchParams.get('excluir'));
	const idAfericao = idDaQuery(url.searchParams.get('excluirPesagem'));
	const idEncerrar = idDaQuery(url.searchParams.get('encerrar'));
	const idReabrir = idDaQuery(url.searchParams.get('reabrir'));

	const editandoRolo = idEditar ? (rolos.find((r) => r.id === idEditar) ?? null) : null;
	const excluindoRolo = idExcluir ? (rolos.find((r) => r.id === idExcluir) ?? null) : null;

	// Encerrar só se aplica a rolo em circulação, e reabrir só a rolo encerrado:
	// um `?encerrar=` apontando para o rolo errado não revela passo nenhum, em
	// vez de abrir um formulário que a action vai recusar.
	const encerrandoRolo = idEncerrar
		? (rolos.find((r) => r.id === idEncerrar && !estaEncerrado(r.status)) ?? null)
		: null;
	const reabrindoRolo = idReabrir
		? (rolos.find((r) => r.id === idReabrir && estaEncerrado(r.status)) ?? null)
		: null;

	// A pesagem só é oferecida para exclusão dentro da edição do rolo dela — é
	// lá que o usuário vê qual está ancorando o restante.
	const afericao = idAfericao
		? (db.select().from(schema.afericao).where(eq(schema.afericao.id, idAfericao)).get() ?? null)
		: null;

	return {
		detalheId: idDaQuery(url.searchParams.get('detalhes')),
		impressoras: db.select({id:schema.impressora.id,nome:schema.impressora.nome}).from(schema.impressora).where(eq(schema.impressora.ativa,true)).all(),
		carregados: listarAtivos(db),
		q,
		// Token de envio desta renderização. Cada resposta carrega um novo, e o
		// servidor gasta o token quando ele vira registro — é o que impede que
		// dois toques no mesmo botão virem duas linhas. Ver `$lib/server/envio`.
		envio: novoEnvio(),
		catalogo: estadoCatalogo.estado === 'ok' ? { estado: 'ok' as const } : estadoCatalogo,
		resultados: resultado.itens,
		total: resultado.total,
		truncado: resultado.truncado,
		selecionado: itemPorId(url.searchParams.get('item')),
		// A lista é partida em duas. O rolo encerrado CONTINUA aqui — encerrar não
		// é apagar, e o histórico dele é o que justifica o preço congelado das
		// impressões que saíram dele —, mas ele não disputa espaço com a
		// prateleira: o que está em circulação vem primeiro e sozinho.
		ativos: rolos.filter((r) => !estaEncerrado(r.status)).map((r) => fichaDoRolo(r, agora)),
		encerrados: rolos
			.filter((r) => estaEncerrado(r.status))
			.map((r) => ({
				...fichaDoRolo(r, agora),
				// A comparação estimativa × realidade. `null` quando ele encerrou sem
				// pesar — e aí a tela diz isso, em vez de inventar um número.
				rendimento: rendimentoDoRolo(db, r.id)
			})),
		editando: editandoRolo
			? {
					...editandoRolo,
					impressoes: contarImpressoesDoRolo(db, editandoRolo.id),
					afericoes: db
						.select()
						.from(schema.afericao)
						.where(eq(schema.afericao.roloId, editandoRolo.id))
						.orderBy(desc(schema.afericao.dataEm))
						.all()
				}
			: null,
		excluindo: excluindoRolo
			? { ...excluindoRolo, dependentes: dependentesDoRolo(db, excluindoRolo.id) }
			: null,
		// A sobra estimada de HOJE vai junto: é contra ela que a pesagem final vai
		// ser comparada, e vê-la antes de digitar é o que dá sentido ao campo.
		encerrando: encerrandoRolo
			? {
					...encerrandoRolo,
					sobraEstimadaG: estoqueDoRolo(db, encerrandoRolo.id).restanteG,
					impressoes: contarImpressoesDoRolo(db, encerrandoRolo.id)
				}
			: null,
		// A pesagem final vai junto porque é sobre ela que a confirmação precisa
		// falar: ela CONTINUA registrada depois de reabrir, e quem não souber
		// disso não entende por que o restante não voltou a ser a estimativa.
		reabrindo: reabrindoRolo
			? { ...reabrindoRolo, pesagemFinal: pesagemFinalDoRolo(db, reabrindoRolo.id) }
			: null,
		// Só confirma a pesagem quando ela é mesmo do rolo aberto na edição:
		// `?excluirPesagem=` apontando para outro rolo não abre confirmação.
		excluindoPesagem:
			afericao && editandoRolo && afericao.roloId === editandoRolo.id ? afericao : null
	};
};

/**
 * Os campos que toda tela de formulário devolve quando recusa: a mensagem, a
 * CHAVE do campo que a causou e o que foi digitado. Sem a chave, a tela só sabe
 * pendurar o texto no topo — que no formulário de rolo fica a mais de uma tela
 * de distância do controle errado, no celular.
 */
type Recusa = { ok: false; erro: string; campo: string };

/** Os campos físicos da compra — os mesmos nos dois caminhos de cadastro. */
function camposDaCompra(form: FormData) {
	const preco = campoPreco(form.get('preco'), 'preço pago');
	if (!preco.ok) return { ...preco, campo: 'preco' } satisfies Recusa;

	const pesoInicial = campoNumericoPositivo(form.get('pesoInicial'), 1000, 'peso líquido inicial');
	if (!pesoInicial.ok) return { ...pesoInicial, campo: 'pesoInicial' } satisfies Recusa;

	const pesoCarretel = campoNumericoPositivo(form.get('pesoCarretel'), 250, 'peso do carretel');
	if (!pesoCarretel.ok) return { ...pesoCarretel, campo: 'pesoCarretel' } satisfies Recusa;

	return {
		ok: true as const,
		valores: {
			apelido: String(form.get('apelido') ?? '').trim() || null,
			precoPagoCents: preco.valor,
			pesoLiquidoInicialG: pesoInicial.valor,
			pesoCarretelG: pesoCarretel.valor,
			fornecedor: String(form.get('fornecedor') ?? '').trim() || null
		}
	};
}

/**
 * Temperatura em branco continua sendo "não informada" (null) nos dois modos —
 * a coluna é nullable e a tela escreve "não informada". O que muda de `criar`
 * para `editar` é o LIXO: na criação ele cai no padrão, na edição ele é erro,
 * porque "abc" virando null é indistinguível de "apaguei de propósito".
 */
function campoTemperatura(bruto: FormDataEntryValue | null, nome: string, modo: 'criar' | 'editar') {
	if (modo === 'editar') return campoNumericoOpcional(bruto, nome);

	const texto = String(bruto ?? '').trim();
	if (!texto) return { ok: true as const, valor: null };
	const n = Number(texto);
	return { ok: true as const, valor: Number.isFinite(n) && n > 0 ? Math.round(n) : null };
}

/** A ficha técnica digitada à mão (marca, material, cor, densidade, temperaturas). */
function camposDaFicha(form: FormData, modo: 'criar' | 'editar') {
	const marca = String(form.get('marca') ?? '').trim();
	const material = String(form.get('material') ?? '').trim();
	const cor = String(form.get('cor') ?? '').trim();
	// O campo apontado é o PRIMEIRO que está vazio, e não sempre `marca`: marcar
	// um controle preenchido como inválido é pior do que não marcar nenhum.
	if (!marca || !material || !cor) {
		return {
			ok: false as const,
			erro: 'marca, material e cor são obrigatórios',
			campo: !marca ? 'marca' : !material ? 'material' : 'cor'
		} satisfies Recusa;
	}

	// Na edição a densidade é exigida: em branco ela cairia em 1,24 por cima do
	// 1,31 que o usuário tinha cadastrado, com HTTP 200 e "salvo".
	const densidade =
		modo === 'criar'
			? campoNumericoPositivo(form.get('densidade'), 1.24, 'densidade')
			: campoNumericoObrigatorio(form.get('densidade'), 'densidade');
	if (!densidade.ok) {
		return { ok: false as const, erro: densidade.erro, campo: 'densidade' } satisfies Recusa;
	}

	// O hex é validado nos dois modos: a cor é o que pinta a bolinha do rolo na
	// tela, e um "#zzz" digitado na edição apagaria a cor boa em silêncio.
	const corHex = campoCorHex(form.get('corHex'), 'cor (hex)');
	if (!corHex.ok) return { ok: false as const, erro: corHex.erro, campo: 'corHex' } satisfies Recusa;

	const tempBico = campoTemperatura(form.get('tempBico'), 'temperatura do bico', modo);
	if (!tempBico.ok) {
		return { ok: false as const, erro: tempBico.erro, campo: 'tempBico' } satisfies Recusa;
	}

	const tempMesa = campoTemperatura(form.get('tempMesa'), 'temperatura da mesa', modo);
	if (!tempMesa.ok) {
		return { ok: false as const, erro: tempMesa.erro, campo: 'tempMesa' } satisfies Recusa;
	}

	return {
		ok: true as const,
		valores: {
			marca,
			material,
			cor,
			corHex: corHex.valor || null,
			densidade: densidade.valor,
			tempBico: tempBico.valor,
			tempMesa: tempMesa.valor
		}
	};
}

/** Mensagem única de cadastro: o código tem que ser visto para ir para o carretel. */
const anotaOCodigo = (codigo: string) =>
	`Cadastrado como ${codigo}; escreva esse código no carretel.`;

/**
 * A resposta ao envio que já tinha sido gravado.
 *
 * É **sucesso**, e não erro: o usuário tocou duas vezes porque a tela demorou,
 * e o que ele queria aconteceu. Um `fail()` aqui diria "deu errado" sobre uma
 * pesagem que está gravada, e o passo seguinte seria digitar tudo de novo.
 */
const jaEnviado = (aviso: string) => ({ sucesso: true as const, repetido: true as const, aviso });

export const actions: Actions = {
 ativar: async ({request}) => {
  const form = await request.formData();
  const resultado = ativarFilamento(db, {impressoraId:Number(form.get('impressoraId')),posicao:Number(form.get('posicao')),roloId:Number(form.get('roloId'))});
  return resultado.ok ? {sucesso:true,aviso:'Filamento ativo. Sua próxima impressão considerará esta seleção.'} : fail(400,{erro:resultado.erro});
 },
 desativar: async ({request}) => {
  const form = await request.formData();
  const resultado = desativarFilamento(db,{impressoraId:Number(form.get('impressoraId')),posicao:Number(form.get('posicao'))});
  return resultado.ok ? {sucesso:true,aviso:'Filamento retirado da impressora. Ele continua no estoque.'} : fail(400,{erro:resultado.erro});
 },
	/**
	 * O caminho curto: ele acabou de comprar, busca no catálogo, escolhe e
	 * digita só o preço.
	 *
	 * **Não reaproveita nada.** Escolher o mesmo item duas vezes cria dois
	 * registros, e é esse o ponto: a segunda compra tem outro preço, e o preço
	 * é o que vira custo congelado em toda impressão que sair dela.
	 */
	criarDoCatalogo: async ({ request }) => {
		const form = await request.formData();
		const marca = String(form.get('marca') ?? '');
		const cor = String(form.get('cor') ?? '');

		// Este era o ÚNICO lugar do sistema que devolvia o digitado junto do erro
		// — e por isso foi o modelo. O que mudou é o alcance: agora volta o
		// formulário inteiro (e não só marca e cor), com a chave do campo que
		// falhou, que é o que permite marcar o controle e repetir a mensagem ao
		// lado dele.
		const eco = ecoDoFormulario(form, [
			'itemId',
			'densidade',
			'marca',
			'cor',
			'preco',
			'apelido',
			'pesoInicial',
			'pesoCarretel',
			'fornecedor'
		]);
		const recusar = (erro: string, campo: string) => fail(400, { erro, campo, valores: eco });

		if (form.get('guiado') === '1') {
			const preco = campoPrecoObrigatorio(form.get('preco'), 'preço pago');
			if (!preco.ok) return recusar(preco.erro, 'preco');
		}
		const campos = camposDaCompra(form);
		if (!campos.ok) return recusar(campos.erro, campos.campo);

		// O id vem de campo escondido; item inexistente é entrada de usuário
		// como qualquer outra e não pode virar 500.
		const item = itemDaBiblioteca(String(form.get('itemId') ?? ''));
		if (!item) {
			return fail(400, {
				erro: 'item do catálogo não encontrado; busque de novo',
				valores: eco
			});
		}

		const ficha = dadosDoItem(item, { marca, cor });
		if (!ficha.ok) return recusar(ficha.erro, 'cor');
		if (item.densidadeEstimada && String(form.get('densidade') ?? '').trim()) {
			const densidade = campoNumericoObrigatorio(form.get('densidade'), 'densidade');
			if (!densidade.ok) return recusar(densidade.erro, 'densidade');
			ficha.dados.densidade = densidade.valor;
		}

		// Imediatamente antes de escrever, e sem `await` no meio: é a adjacência
		// que faz dois POST simultâneos não criarem dois rolos.
		if (registrarEnvio(form.get(CAMPO_ENVIO)) === 'repetido') {
			return { ...jaEnviado('este cadastro já tinha sido enviado; nenhum filamento foi duplicado.'), roloId: roloDoEnvio(form.get(CAMPO_ENVIO)) };
		}

		const r = criarRolo(db, {
			...ficha.dados, ...campos.valores, catalogoItemId: item.id,
			notas: item.densidadeEstimada
				? `Densidade ${String(ficha.dados.densidade).replace('.', ',')} g/cm³ ${ficha.dados.densidade === item.densidade ? 'estimada para o material' : 'informada no cadastro'}.`
				: null
		});
		// `criarRolo` tem regra própria (código já em uso) e recusa DEPOIS do
		// token. Sem devolvê-lo, o reenvio corrigido responderia "já enviado"
		// sobre um rolo que nunca foi criado. Ver `devolverEnvio`.
		if (!r.ok) {
			devolverEnvio(form.get(CAMPO_ENVIO));
			return fail(400, { erro: r.erro, valores: eco });
		}

		lembrarRoloDoEnvio(form.get(CAMPO_ENVIO), r.id);
		return { sucesso: true, roloId: r.id, aviso: anotaOCodigo(r.codigo) };
	},

	/** Cadastro à mão, para o rolo que não está no catálogo da Bambu. */
	criar: async ({ request }) => {
		const form = await request.formData();

		const eco = ecoDoFormulario(form, [
			'itemId',
			'marca',
			'material',
			'cor',
			'corHex',
			'densidade',
			'tempBico',
			'tempMesa',
			'preco',
			'apelido',
			'pesoInicial',
			'pesoCarretel',
			'fornecedor'
		]);
		const recusar = (erro: string, campo: string) => fail(400, { erro, campo, valores: eco });

		const ficha = camposDaFicha(form, 'criar');
		if (!ficha.ok) return recusar(ficha.erro, ficha.campo);

		if (form.get('guiado') === '1') {
			const preco = campoPrecoObrigatorio(form.get('preco'), 'preço pago');
			if (!preco.ok) return recusar(preco.erro, 'preco');
		}
		const campos = camposDaCompra(form);
		if (!campos.ok) return recusar(campos.erro, campos.campo);

		if (registrarEnvio(form.get(CAMPO_ENVIO)) === 'repetido') {
			return { ...jaEnviado('este cadastro já tinha sido enviado; nenhum filamento foi duplicado.'), roloId: roloDoEnvio(form.get(CAMPO_ENVIO)) };
		}

		const r = criarRolo(db, {
			...ficha.valores,
			...campos.valores,
			// Digitado na mão continua sendo digitado na mão: sem código Bambu, e
			// a importação da nuvem vai saber que não tem âncora.
			codigoBambu: null,
			fonteCatalogo: 'manual'
		});
		if (!r.ok) {
			devolverEnvio(form.get(CAMPO_ENVIO));
			return fail(400, { erro: r.erro, valores: eco });
		}

		lembrarRoloDoEnvio(form.get(CAMPO_ENVIO), r.id);
		return { sucesso: true, roloId: r.id, aviso: anotaOCodigo(r.codigo) };
	},

	editar: async ({ request }) => {
		const form = await request.formData();
		const id = campoId(form.get('id'), 'rolo inválido');
		if (!id.ok) return fail(400, { erro: id.erro });

		const atual = db.select().from(schema.rolo).where(eq(schema.rolo.id, id.valor)).get();
		if (!atual) return fail(400, { erro: 'rolo não encontrado' });

		// Na edição o eco é ainda mais necessário: o formulário volta PREENCHIDO
		// com o que estava guardado, então devolvê-lo vazio não é só perder o que
		// foi digitado — é fazer o usuário achar que o cadastro foi apagado.
		const eco = ecoDoFormulario(form, [
			'codigo',
			'marca',
			'material',
			'cor',
			'corHex',
			'densidade',
			'tempBico',
			'tempMesa',
			'apelido',
			'preco',
			'pesoInicial',
			'pesoCarretel',
			'fornecedor',
			'notas',
			'status'
		]);
		const recusar = (erro: string, campo: string) =>
			fail(400, { erro, campo, editandoId: id.valor, valores: eco });

		const codigo = lerCodigo(form.get('codigo'));
		if (!codigo.ok) return recusar(codigo.erro, 'codigo');

		const ficha = camposDaFicha(form, 'editar');
		if (!ficha.ok) return recusar(ficha.erro, ficha.campo);

		// Leitura de EDIÇÃO: aqui o formulário volta preenchido, então campo em
		// branco não é "não preenchi" — é apagar. Cair nos padrões de cadastro
		// (0 / 1000 g / 250 g) trocaria o preço e o peso do rolo em silêncio, e
		// com "Recalcular" marcado isso vira custo de filamento reescrito a
		// partir de números que ninguém digitou.
		const preco = campoPrecoObrigatorio(form.get('preco'), 'preço pago');
		if (!preco.ok) return recusar(preco.erro, 'preco');

		const pesoInicial = campoNumericoObrigatorio(form.get('pesoInicial'), 'peso líquido inicial');
		if (!pesoInicial.ok) return recusar(pesoInicial.erro, 'pesoInicial');

		const pesoCarretel = campoNumericoObrigatorio(form.get('pesoCarretel'), 'peso do carretel');
		if (!pesoCarretel.ok) return recusar(pesoCarretel.erro, 'pesoCarretel');

		const statusBruto = String(form.get('status') ?? '');
		const status = (STATUS_ROLO as readonly string[]).includes(statusBruto)
			? (statusBruto as StatusRolo)
			: null;
		if (!status) return recusar('status inválido', 'status');

		// Unicidade do código e coerência do peso inicial com as pesagens já
		// registradas moram em `editarRolo` — mesma checagem para qualquer
		// chamador, e nenhum throw chegando na action.
		const r = editarRolo(
			db,
			id.valor,
			{
				codigo: codigo.valor,
				...ficha.valores,
				// `codigoBambu` e `fonteCatalogo` não são editáveis: o primeiro é a
				// âncora que a importação da nuvem usa, e o segundo declara de onde
				// vieram densidade e temperaturas. Corrigir um tipo na cor não pode
				// soltar a âncora nem mentir sobre a origem.
				codigoBambu: atual.codigoBambu,
				fonteCatalogo: atual.fonteCatalogo,
				apelido: String(form.get('apelido') ?? '').trim() || null,
				precoPagoCents: preco.valor,
				pesoLiquidoInicialG: pesoInicial.valor,
				pesoCarretelG: pesoCarretel.valor,
				fornecedor: String(form.get('fornecedor') ?? '').trim() || null,
				notas: String(form.get('notas') ?? '').trim() || null,
				status
			},
			form.get('recalcular') === 'on'
		);
		// `editarRolo` recusa código duplicado e peso inicial abaixo de uma
		// pesagem já registrada. Nos dois casos o campo é sabido, e é ele que
		// recebe a marca.
		if (!r.ok) return recusar(r.erro, r.erro.includes('código') ? 'codigo' : 'pesoInicial');

		return { sucesso: true, recalculadas: r.recalculadas ?? 0 };
	},

	excluir: async ({ request }) => {
		const form = await request.formData();
		const id = campoId(form.get('id'), 'rolo inválido');
		if (!id.ok) return fail(400, { erro: id.erro });
		if (form.get('confirmar') !== '1') return fail(400, { erro: 'exclusão não confirmada' });

		const r = excluirRolo(db, id.valor);
		if (!r.ok) return fail(400, { erro: r.erro });

		redirect(303, '/rolos');
	},

	apagarPesagem: async ({ request }) => {
		const form = await request.formData();
		const id = campoId(form.get('id'), 'pesagem inválida');
		if (!id.ok) return fail(400, { erro: id.erro });
		if (form.get('confirmar') !== '1') return fail(400, { erro: 'exclusão não confirmada' });

		const af = db.select().from(schema.afericao).where(eq(schema.afericao.id, id.valor)).get();
		if (!af) return fail(400, { erro: 'pesagem não encontrada' });

		const r = excluirAfericao(db, id.valor);
		if (!r.ok) return fail(400, { erro: r.erro });

		// Volta para a edição do rolo, onde o restante recalculado fica visível.
		redirect(303, `/rolos?editar=${af.roloId}`);
	},

	abrir: async ({ request }) => {
		const form = await request.formData();
		const id = campoId(form.get('id'), 'rolo inválido');
		if (!id.ok) return fail(400, { erro: id.erro });

		// `update ... where id = 99999` não falha: afeta zero linhas e devolve
		// 200. O usuário via "deu certo" sem nada ter acontecido.
		const r = db
			.update(schema.rolo)
			.set({ status: 'aberto', dataAbertura: new Date() })
			.where(eq(schema.rolo.id, id.valor))
			.run();
		if (r.changes === 0) return fail(400, { erro: 'rolo não encontrado' });
		// `feito` diz à tela QUAL gesto deu certo, para o retorno falar dele e não um "salvo" genérico.
		return { sucesso: true, feito: 'abertura' as const };
	},

	/**
	 * A pesagem — o gesto mais importante do sistema, feito de pé ao lado da
	 * impressora.
	 *
	 * Três coisas mudaram de uma vez, e as três pela mesma razão (o que a
	 * balança dá é diferente do que o formulário pedia):
	 *
	 * 1. **Bruto ou líquido.** A balança mostra o rolo inteiro; a coluna guarda
	 *    o filamento. `resolverPesagem` converte, e os dois campos existem lado
	 *    a lado — com script um preenche o outro, sem script a conta sai aqui.
	 * 2. **Peso de fábrica acima do nominal.** A Bambu manda 1010 a 1030 g num
	 *    rolo de 1 kg, e a primeira pesagem de um rolo novo era recusada por
	 *    isso. Continua sendo recusada em silêncio nunca: ou o usuário marca
	 *    "ajustar o peso inicial", e o cadastro passa a valer o que a balança
	 *    diz, ou ele recebe a mensagem explicando as duas saídas.
	 * 3. **Pesar abre o rolo.** Pesar um rolo é ter o rolo na mão. Deixá-lo
	 *    "fechado" depois disso mantinha `dataAbertura` nula — e rolo sem data
	 *    de abertura não alerta acabando nem umidade, que são os dois únicos
	 *    alertas do sistema.
	 */
	aferir: async ({ request }) => {
		const form = await request.formData();
		const roloId = campoId(form.get('roloId'), 'rolo inválido');
		if (!roloId.ok) return fail(400, { erro: roloId.erro });

		// Id inexistente virava `FOREIGN KEY constraint failed` no insert — 500.
		// Vem antes da leitura do peso porque é o cadastro do rolo que carrega o
		// peso do carretel, sem o qual não há conversão.
		const rol = db.select().from(schema.rolo).where(eq(schema.rolo.id, roloId.valor)).get();
		if (!rol) return fail(400, { erro: 'rolo não encontrado' });

		const eco = ecoDoFormulario(form, ['pesoBrutoG', 'pesoLiquidoG']);
		const recusar = (erro: string, campo: string) =>
			fail(400, { erro, campo, roloComErro: roloId.valor, valores: eco });

		const pesagem = resolverPesagem({
			bruto: eco.pesoBrutoG,
			liquido: eco.pesoLiquidoG,
			pesoCarretelG: rol.pesoCarretelG
		});
		if (!pesagem.ok) return recusar(pesagem.erro, pesagem.campo);

		const peso = pesagem.pesoLiquidoG;
		const ajustarInicial = form.get('ajustarInicial') === 'on';
		let pesoInicial = rol.pesoLiquidoInicialG;

		if (peso > pesoInicial) {
			// Um rolo de 1 kg que chega com 1024 g de filamento não é balança
			// errada: é a tolerância de fábrica, e ela é para cima com frequência.
			// A recusa continua sendo o padrão — a aferição é a âncora do estoque —
			// mas agora ela vem com a saída ao lado, e a saída é um clique.
			if (!ajustarInicial) {
				return recusar(
					`a pesagem (${peso} g) passa do peso líquido inicial do cadastro ` +
						`(${pesoInicial} g). Se o rolo é novo, isso é a tolerância de fábrica; marque ` +
						'"ajustar o peso inicial" e os dois passam a valer este número. Se não é, ' +
						'confira a balança e o peso do carretel.',
					'pesoLiquidoG'
				);
			}
			pesoInicial = peso;
		}

		const valido = validarPesoAferido(peso, pesoInicial);
		if (!valido.ok) return recusar(valido.erro, 'pesoLiquidoG');

		// ── integração `crit-dados` × `crit-fluxo` ────────────────────────────
		// A trava de envio repetido vem DEPOIS de toda a validação (formulário
		// recusado não queima o token, senão o reenvio corrigido seria negado) e
		// ANTES da primeira escrita. A `crit-fluxo` acrescentou dois efeitos de
		// banco à ação — ajustar o peso inicial e abrir o rolo — e eles são
		// escrita como a aferição é: o token tem que cobrir os três, não só o
		// insert que existia quando ele foi desenhado.
		if (registrarEnvio(form.get(CAMPO_ENVIO)) === 'repetido') {
			return jaEnviado('essa pesagem já tinha sido registrada; nada foi gravado duas vezes.');
		}

		const mudancas: string[] = [];

		if (pesoInicial !== rol.pesoLiquidoInicialG) {
			db.update(schema.rolo)
				.set({ pesoLiquidoInicialG: pesoInicial })
				.where(eq(schema.rolo.id, roloId.valor))
				.run();
			mudancas.push(`peso inicial ajustado para ${pesoInicial} g`);
		}

		// Pesar é ter o rolo na mão. `abrir` já existe como ação própria e
		// continua existindo (dá para abrir sem pesar); o que não fazia sentido
		// era o contrário — pesar e o rolo seguir lacrado no cadastro.
		if (rol.status === 'fechado') {
			db.update(schema.rolo)
				.set({ status: 'aberto', dataAbertura: rol.dataAbertura ?? new Date() })
				.where(eq(schema.rolo.id, roloId.valor))
				.run();
			mudancas.push('rolo aberto');
		}

		db.insert(schema.afericao)
			.values({
				roloId: roloId.valor,
				pesoLiquidoG: peso,
				// A observação registra COMO o número foi obtido: uma pesagem
				// convertida do bruto e uma digitada já líquida são a mesma âncora,
				// mas não são o mesmo gesto, e a tabela de pesagens mostra isto.
				observacao:
					pesagem.origem === 'bruto'
						? `pesagem manual · ${eco.pesoBrutoG.trim()} g brutos − ` +
							// Vírgula, como o cadastro aceita: um carretel de 212,3 g não pode
							// virar "212.3" na tabela de pesagens do próprio rolo.
							`${String(rol.pesoCarretelG).replace('.', ',')} g de carretel`
						: 'pesagem manual · líquido'
			})
			.run();

		return {
			sucesso: true,
			feito: 'pesagem' as const,
			aviso: mudancas.length > 0 ? mudancas.join(' · ') : null
		};
	},

	/**
	 * O botão que faltava: dar o rolo como finalizado.
	 *
	 * As duas situações do pedido do dono chegam aqui como `motivo`, e viram os
	 * dois status que o resto do sistema já sabe recusar — ver
	 * `$lib/server/encerramento`. A pesagem final é opcional, e o zero nela é
	 * uma resposta ("acabou"), não um campo em branco.
	 */
	encerrar: async ({ request }) => {
		const form = await request.formData();
		const id = campoId(form.get('id'), 'rolo inválido');
		if (!id.ok) return fail(400, { erro: id.erro });

		// Encerrar tira o rolo do formulário de nova impressão e da importação da
		// nuvem, e pode gravar uma aferição que vira a âncora do estoque. Passo
		// revelado por `?encerrar=<id>`, confirmação explícita aqui — mesmo padrão
		// da exclusão.
		if (form.get('confirmar') !== '1') return fail(400, { erro: 'encerramento não confirmado' });

		const motivo = lerMotivo(form.get('motivo'));
		if (!motivo) {
			return fail(400, {
				erro: 'escolha se o filamento acabou ou se você está encerrando com sobra'
			});
		}

		const sobra = campoNumericoNaoNegativoOpcional(form.get('sobra'), 'sobra na balança');
		if (!sobra.ok) return fail(400, { erro: sobra.erro });

		// ── integração `crit-dados` × `encerrar` ──────────────────────────────
		// Esta ação grava uma AFERIÇÃO (a pesagem final), que é a âncora do
		// estoque — a escrita que o token de envio existe para proteger. Sem a
		// trava, dois toques deixavam duas pesagens finais idênticas na tabela do
		// rolo: o mesmo número, então o restante não muda, mas uma linha fantasma
		// na única tabela do sistema em que cada linha é uma ida à balança.
		//
		// `encerrarRolo` não recusa rolo já encerrado de propósito (encerrar duas
		// vezes com motivos diferentes é correção legítima), então não há nada
		// depois dela que pegue a repetição.
		//
		// A resposta ao repetido é o MESMO 303 do caminho normal: o desfecho é
		// idêntico ao da primeira requisição, e é para a lista que o usuário tem
		// que ir. Depois de toda a validação, para que um formulário recusado não
		// queime o token.
		if (registrarEnvio(form.get(CAMPO_ENVIO)) === 'repetido') redirect(303, '/rolos');

		const r = encerrarRolo(db, id.valor, { motivo, sobraG: sobra.valor });
		// `encerrarRolo` valida a sobra contra o peso inicial do rolo, e essa
		// regra mora lá porque é lá que o rolo é lido. Recusa sem escrita devolve
		// o token: corrigir a sobra e reenviar é o gesto seguinte, garantido.
		if (!r.ok) {
			devolverEnvio(form.get(CAMPO_ENVIO));
			return fail(400, { erro: r.erro });
		}

		// Volta para a lista limpa de query string: o passo já foi dado, e
		// recarregar a página não pode reabrir a confirmação.
		redirect(303, '/rolos');
	},

	/** Encerrar por engano não é definitivo. Ver `reabrirRolo` sobre a pesagem. */
	reabrir: async ({ request }) => {
		const form = await request.formData();
		const id = campoId(form.get('id'), 'rolo inválido');
		if (!id.ok) return fail(400, { erro: id.erro });
		if (form.get('confirmar') !== '1') return fail(400, { erro: 'reabertura não confirmada' });

		const r = reabrirRolo(db, id.valor);
		if (!r.ok) return fail(400, { erro: r.erro });

		redirect(303, '/rolos');
	},

	secar: async ({ request }) => {
		const form = await request.formData();
		const id = campoId(form.get('id'), 'rolo inválido');
		if (!id.ok) return fail(400, { erro: id.erro });

		const r = db
			.update(schema.rolo)
			.set({ dataUltimaSecagem: new Date() })
			.where(eq(schema.rolo.id, id.valor))
			.run();
		if (r.changes === 0) return fail(400, { erro: 'rolo não encontrado' });
		return { sucesso: true, feito: 'secagem' as const };
	}
};
