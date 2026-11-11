import { error, fail, redirect } from '@sveltejs/kit';
import { desc, eq } from 'drizzle-orm';
import { db, schema } from '$lib/server/db';
import { lerDoProjeto } from '$lib/projeto';
import { resolverImagem } from '$lib/server/imagens';
import { excluirImpressaoDaNuvem } from '$lib/server/nuvem/importacao';
import { editarImpressao, estoqueDoRolo, excluirImpressao } from '$lib/server/repo';
import {
	campoDataHoraObrigatoria,
	campoId,
	campoNumericoObrigatorio,
	campoNumericoOpcional,
	ecoDoFormulario
} from '$lib/server/formulario';
import { duracaoEmSegundos } from '../duracao';
import type { Actions, PageServerLoad } from './$types';

const STATUS = ['sucesso', 'falha', 'cancelada'] as const;
const FINALIDADES = ['estudio', 'homelab', 'conteudo', 'pessoal', 'outro'] as const;

export const load: PageServerLoad = async ({ params, url }) => {
	const id = Number(params.id);
	const linha = db.select().from(schema.impressao).where(eq(schema.impressao.id, id)).get();
	if (!linha) throw error(404, 'impressão não encontrada');

	// `imagemPath` é caminho no disco do servidor e fica no servidor. A tela só
	// precisa saber SE existe capa; para pegá-la existe `/impressoes/<id>/imagem`,
	// que resolve o caminho de novo, do zero, com toda a validação.
	//
	// E a pergunta é feita ao DISCO, não à coluna: coluna preenchida com arquivo
	// ausente (volume novo, restore parcial, caminho adulterado) faria a tela
	// pedir uma imagem que a rota vai recusar — e o resultado disso é o ícone de
	// imagem quebrada, exatamente o que esta tela não pode mostrar.
	const { imagemPath, ...impressao } = linha;
	const capa = await resolverImagem(imagemPath);
	const temImagem = capa.ok;
	/** `null` quando há capa; senão, por que não há. Ver `MotivoRecusa`. */
	const semCapa = capa.ok ? null : capa.motivo;

	// A ficha do filamento (marca, material, cor) mora no próprio rolo desde a
	// fusão — não há mais uma segunda consulta para fazer aqui.
	const rolo = db.select().from(schema.rolo).where(eq(schema.rolo.id, impressao.roloId)).get();
	const impressora = db
		.select()
		.from(schema.impressora)
		.where(eq(schema.impressora.id, impressao.impressoraId))
		.get();

	// As outras impressões do MESMO ARQUIVO DE PROJETO, em três leituras: a
	// mesma plate (comparável), as outras plates do projeto (complementares,
	// sem soma) e as que não dá para situar. Ver `$lib/projeto` para o motivo de
	// cada corte — em especial por que a mesma plate rende VARIAÇÃO e nunca um
	// total, e por que plate diferente continua sem somar.
	//
	// A capa entra na lista porque é o sinal que o OLHO usa para confirmar o que
	// o índice afirma: quem vê as quatro miniaturas lado a lado sabe na hora se
	// são a mesma peça ou peças complementares. A pergunta é feita à coluna, e
	// não ao disco: um `stat` por irmã custaria caro numa peça com trinta
	// tentativas, e o pior caso aqui é uma miniatura que não abre dentro de uma
	// lista secundária — não a capa da tela.
	const projeto = lerDoProjeto(
		impressao.id,
		db
			.select({
				id: schema.impressao.id,
				nomeLivre: schema.impressao.nomeLivre,
				corHex: schema.rolo.corHex,
				inicioEm: schema.impressao.inicioEm,
				gramas: schema.impressao.gramas,
				custoTotalCents: schema.impressao.custoTotalCents,
				status: schema.impressao.status,
				imagemPath: schema.impressao.imagemPath,
				indicePlate: schema.impressao.indicePlate,
				projetoIdNuvem: schema.impressao.projetoIdNuvem
			})
			.from(schema.impressao)
			.leftJoin(schema.rolo, eq(schema.rolo.id, schema.impressao.roloId))
			.orderBy(desc(schema.impressao.inicioEm))
			.all()
			.map(({ imagemPath: caminho, ...i }) => ({
				...i,
				inicioEm: i.inicioEm.getTime(),
				temImagem: caminho !== null
			}))
	);

	// Quanto do carretel desenhar ao lado do nome do filamento: o saldo de HOJE
	// sobre a capacidade do próprio rolo. É só o nível da figura; nenhum número
	// de saldo aparece nesta tela, que fala de uma impressão já feita.
	const nivelDoRolo =
		rolo && rolo.status !== 'vazio' && rolo.status !== 'descartado' && rolo.pesoLiquidoInicialG > 0
			? Math.min(1, estoqueDoRolo(db, rolo.id).restanteG / rolo.pesoLiquidoInicialG)
			: 0;

	return {
		impressao,
		temImagem,
		semCapa,
		rolo,
		nivelDoRolo,
		impressora,
		projeto,
		// Editar e confirmar exclusão são passos revelados por query string, e
		// não JavaScript: a confirmação que só existe no cliente vira exclusão
		// silenciosa quando o script não roda.
		editando: url.searchParams.has('editar'),
		excluindo: url.searchParams.has('excluir'),
		impressoras: db.select().from(schema.impressora).all(),
		rolos: db.select().from(schema.rolo).all()
	};
};

export const actions: Actions = {
	editar: async ({ request, params }) => {
		const form = await request.formData();

		const id = campoId(String(params.id), 'impressão inválida');
		if (!id.ok) return fail(400, { erro: id.erro });

		// Numa EDIÇÃO o eco vale ainda mais que num cadastro: o formulário volta
		// preenchido com o que estava guardado, e devolvê-lo vazio não parece
		// "perdi o que digitei" — parece "o registro sumiu".
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
			'finalidade',
			'observacoes'
		]);
		const recusar = (erro: string, campo: string) => fail(400, { erro, campo, valores: eco });

		const nomeLivre = String(form.get('nomeLivre') ?? '').trim();
		if (!nomeLivre) return recusar('peça é obrigatória', 'nomeLivre');

		const impressora = campoId(form.get('impressoraId'), 'escolha uma impressora');
		if (!impressora.ok) return recusar(impressora.erro, 'impressoraId');

		const rolo = campoId(form.get('roloId'), 'escolha um rolo');
		if (!rolo.ok) return recusar(rolo.erro, 'roloId');

		// Numa EDIÇÃO, campo em branco não pode cair em padrão: aqui o "padrão"
		// de `inicioEm` é AGORA, o que mandaria a impressão para o outro lado da
		// âncora de pesagem do rolo e mudaria o estoque sem ninguém ter pedido.
		const inicioEm = campoDataHoraObrigatoria(form.get('inicioEm'), 'início');
		if (!inicioEm.ok) return recusar(inicioEm.erro, 'inicioEm');

		const gramas = campoNumericoObrigatorio(form.get('gramas'), 'gramas');
		if (!gramas.ok) return recusar(gramas.erro, 'gramas');

		// `duracaoParaSegundos` satura vazio e malformado em 0, que é o certo no
		// registro e desastroso aqui: 0 zera energia e depreciação, tira a
		// impressão do horímetro da máquina — mexendo no denominador de
		// manutenção de TODAS as outras dela — e, com "Recalcular" marcado,
		// grava isso por cima do custo congelado. `duracaoEmSegundos` é o mesmo
		// parser devolvendo `null` no lugar do zero de desistência.
		const duracaoS = duracaoEmSegundos(String(form.get('duracao') ?? ''));
		if (duracaoS === null) {
			return recusar(
				'duração não pode ficar em branco nem inválida; use 3,6h · 3:36 · 215 (minutos)',
				'duracao'
			);
		}

		// Estes três são nullable de verdade: em branco é "não informado" e a
		// tela esconde o campo. O que não passa é lixo virando null em silêncio.
		const camadaMm = campoNumericoOpcional(form.get('camadaMm'), 'camada');
		if (!camadaMm.ok) return recusar(camadaMm.erro, 'camadaMm');

		const paredes = campoNumericoOpcional(form.get('paredes'), 'paredes');
		if (!paredes.ok) return recusar(paredes.erro, 'paredes');

		const infillPct = campoNumericoOpcional(form.get('infillPct'), 'infill', { permiteZero: true });
		if (!infillPct.ok) return recusar(infillPct.erro, 'infillPct');

		const statusBruto = String(form.get('status') ?? '');
		if (!(STATUS as readonly string[]).includes(statusBruto)) {
			return recusar('status inválido', 'status');
		}

		const finalidadeBruta = String(form.get('finalidade') ?? '');
		if (!(FINALIDADES as readonly string[]).includes(finalidadeBruta)) {
			return recusar('finalidade inválida', 'finalidade');
		}

		// Existência de impressora, rolo e da própria impressão mora em
		// `editarImpressao`: um id inexistente volta como erro de formulário, não
		// como `FOREIGN KEY constraint failed` (que seria 500).
		const r = editarImpressao(
			db,
			id.valor,
			{
				nomeLivre,
				impressoraId: impressora.valor,
				roloId: rolo.valor,
				inicioEm: inicioEm.valor,
				// `fimEm` fica de fora de propósito: a tela não expõe o campo, e
				// mandá-lo ausente apagaria o horário de término que a importação
				// da nuvem preenche. Ausente aqui significa "não mexe".
				duracaoS,
				gramas: gramas.valor,
				status: statusBruto as (typeof STATUS)[number],
				motivoFalha: String(form.get('motivoFalha') ?? '').trim() || null,
				camadaMm: camadaMm.valor,
				paredes: paredes.valor,
				infillPct: infillPct.valor,
				finalidade: finalidadeBruta as (typeof FINALIDADES)[number],
				observacoes: String(form.get('observacoes') ?? '').trim() || null
			},
			form.get('recalcular') === 'on'
		);
		if (!r.ok) return fail(400, { erro: r.erro, valores: eco });

		return { sucesso: true, recalculadas: r.recalculadas ?? 0 };
	},

	excluir: async ({ request, params }) => {
		const form = await request.formData();
		const id = campoId(String(params.id), 'impressão inválida');
		if (!id.ok) return fail(400, { erro: id.erro });

		// A tela de confirmação é servida pelo servidor (`?excluir`); este campo
		// é a prova de que ela foi atravessada. Um POST direto na action não
		// apaga nada.
		if (form.get('confirmar') !== '1') return fail(400, { erro: 'exclusão não confirmada' });

		const r = excluirImpressao(db, id.valor);
		if (!r.ok) return fail(400, { erro: r.erro });

		redirect(303, '/impressoes');
	},

	/**
	 * Desfaz uma importação errada.
	 *
	 * A atribuição em lote multiplica acerto e erro na mesma proporção: um
	 * clique no `select` do grupo pode congelar cinquenta custos no rolo errado.
	 * Sem uma saída, a correção seria SQL na mão — reimportar devolve
	 * `duplicadas`, porque o `taskIdNuvem` continua ocupado.
	 *
	 * Excluir e reimportar, em vez de editar o rolo aqui, porque o custo é
	 * congelado por `registrarImpressao` e só por ela. Uma edição teria que
	 * recalcular e recongelar por fora, criando um segundo lugar onde o custo é
	 * escrito. A justificativa completa está em `docs/relatorio-nuvem.md`.
	 *
	 * **Por que é uma action separada de `excluir`, e não a mesma.** As duas
	 * apagam a mesma linha e param aí a semelhança. Esta recusa impressão que
	 * não veio da nuvem (`excluirImpressaoDaNuvem`), porque a manual não tem de
	 * onde voltar, e redireciona anunciando o nome — a lista lê `?excluida=` e
	 * diz que a peça volta na próxima importação. A `excluir` genérica, que a
	 * edição trouxe, apaga qualquer impressão a partir da tela de confirmação
	 * servida em `?excluir`. Fundir as duas custaria uma das duas garantias: ou
	 * a manual deixaria de ser apagável, ou a da nuvem perderia o aviso de que
	 * ela reaparece.
	 */
	excluirDaNuvem: async ({ request, params }) => {
		const form = await request.formData();
		const id = campoId(params.id, 'impressão inválida');
		if (!id.ok) return fail(400, { erro: id.erro });

		// Confirmação explícita no corpo do POST, não só no `confirm()` do
		// navegador: o diálogo do browser é conveniência, não garantia.
		if (form.get('confirmar') !== 'sim') {
			return fail(400, { erro: 'confirme a exclusão para continuar' });
		}

		const r = excluirImpressaoDaNuvem(db, id.valor);
		if (!r.ok) return fail(400, { erro: r.erro });

		throw redirect(303, '/impressoes?excluida=' + encodeURIComponent(r.nome));
	}
};
