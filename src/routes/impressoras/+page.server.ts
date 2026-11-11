import { fail, redirect } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { db, schema } from '$lib/server/db';
import { listarAtivos } from '$lib/server/filamentos-ativos';
import {
	contarImpressoesDaImpressora,
	dependentesDaImpressora,
	editarImpressora,
	estoqueDoRolo,
	excluirImpressora,
	horasAcumuladas
} from '$lib/server/repo';
import {
	campoId,
	campoNumericoObrigatorio,
	campoNumericoPositivo,
	campoPreco,
	campoPrecoObrigatorio,
	ecoDoFormulario
} from '$lib/server/formulario';
import type { Actions, PageServerLoad } from './$types';

/**
 * Editar e excluir são passos revelados por query string (`?editar=3`,
 * `?excluir=3`), não formulários abertos em toda linha da lista.
 *
 * Vale dizer por que não é `confirm()` nem `<dialog>` no cliente: o Carretel é
 * um CRUD que funciona inteiro sem JavaScript, e uma confirmação que só existe
 * em JS vira exclusão silenciosa quando o script não roda. O passo de
 * confirmação aqui é uma NAVEGAÇÃO — a tela de confirmação é servida pelo
 * servidor, e a action ainda exige o campo `confirmar` para gravar.
 */
function idDaQuery(valor: string | null): number | null {
	const n = Number(valor ?? '');
	return Number.isInteger(n) && n > 0 ? n : null;
}

export const load: PageServerLoad = async ({ url }) => {
	const impressoras = db.select().from(schema.impressora).all();

	const idEditar = idDaQuery(url.searchParams.get('editar'));
	const idExcluir = idDaQuery(url.searchParams.get('excluir'));

	const editando = idEditar ? (impressoras.find((i) => i.id === idEditar) ?? null) : null;
	const excluindo = idExcluir ? (impressoras.find((i) => i.id === idExcluir) ?? null) : null;

	// O que está em cada máquina agora: os mesmos vínculos que a tela de
	// Filamentos mostra, com o que se precisa para desenhar o rolo (cor do
	// cadastro e quanto resta sobre a capacidade dele).
	const rolos = new Map(db.select().from(schema.rolo).all().map((r) => [r.id, r]));
	const carregados = listarAtivos(db).flatMap((a) => {
		const r = rolos.get(a.roloId);
		if (!r) return [];
		return [
			{
				impressoraId: a.impressoraId,
				posicao: a.posicao,
				roloId: r.id,
				material: r.material,
				cor: r.cor,
				corHex: r.corHex,
				fracao:
					r.pesoLiquidoInicialG > 0
						? Math.min(1, estoqueDoRolo(db, r.id).restanteG / r.pesoLiquidoInicialG)
						: 0
			}
		];
	});

	return {
		impressoras: impressoras.map((i) => ({
			...i,
			horas: horasAcumuladas(db, i.id),
			carregados: carregados.filter((c) => c.impressoraId === i.id)
		})),
		editando: editando
			? { ...editando, impressoes: contarImpressoesDaImpressora(db, editando.id) }
			: null,
		excluindo: excluindo ? { ...excluindo, dependentes: dependentesDaImpressora(db, excluindo.id) } : null
	};
};

/**
 * A mesma lista de campos para criar e editar, com a leitura numérica trocada
 * pelo modo.
 *
 * `criar` cai nos padrões documentados no formulário quando o campo vem em
 * branco: não há valor guardado a perder. `editar` EXIGE cada número, porque o
 * formulário volta preenchido e limpar um campo é um clique — cair no padrão
 * ali seria trocar 4.000,00 / 8.000 h / 150 W por 0 / 5000 / 100 e responder
 * "salva". A lista de campos fica uma só de propósito: duas cópias divergem.
 */
function lerCampos(form: FormData, modo: 'criar' | 'editar') {
	const nome = String(form.get('nome') ?? '').trim();
	const modelo = String(form.get('modelo') ?? '').trim();
	// O campo apontado é o primeiro que está vazio: marcar um controle já
	// preenchido como inválido é pior do que não marcar nenhum.
	if (!nome || !modelo) {
		return {
			ok: false as const,
			erro: 'nome e modelo são obrigatórios',
			campo: !nome ? 'nome' : 'modelo'
		};
	}

	const preco =
		modo === 'criar'
			? campoPreco(form.get('preco'), 'preço pago')
			: campoPrecoObrigatorio(form.get('preco'), 'preço pago');
	if (!preco.ok) return { ok: false as const, erro: preco.erro, campo: 'preco' };

	const vidaUtilHoras =
		modo === 'criar'
			? campoNumericoPositivo(form.get('vidaUtilHoras'), 5000, 'vida útil')
			: campoNumericoObrigatorio(form.get('vidaUtilHoras'), 'vida útil');
	if (!vidaUtilHoras.ok) {
		return { ok: false as const, erro: vidaUtilHoras.erro, campo: 'vidaUtilHoras' };
	}

	const potenciaMediaW =
		modo === 'criar'
			? campoNumericoPositivo(form.get('potenciaMediaW'), 100, 'potência média')
			: campoNumericoObrigatorio(form.get('potenciaMediaW'), 'potência média');
	if (!potenciaMediaW.ok) {
		return { ok: false as const, erro: potenciaMediaW.erro, campo: 'potenciaMediaW' };
	}

	return {
		ok: true as const,
		valores: {
			nome,
			modelo,
			apelidoBambu: String(form.get('apelidoBambu') ?? '').trim() || null,
			precoCompraCents: preco.valor,
			vidaUtilHoras: vidaUtilHoras.valor,
			potenciaMediaW: potenciaMediaW.valor
		}
	};
}

export const actions: Actions = {
	criar: async ({ request }) => {
		const form = await request.formData();

		// O digitado volta junto do erro: antes, um preço mal formatado devolvia
		// os cinco campos vazios e o cadastro começava de novo.
		const eco = ecoDoFormulario(form, [
			'nome',
			'modelo',
			'apelidoBambu',
			'preco',
			'vidaUtilHoras',
			'potenciaMediaW'
		]);

		const campos = lerCampos(form, 'criar');
		if (!campos.ok) return fail(400, { erro: campos.erro, campo: campos.campo, valores: eco });

		db.insert(schema.impressora).values(campos.valores).run();
		return { sucesso: true };
	},

	editar: async ({ request }) => {
		const form = await request.formData();

		// Inteiro positivo primeiro, existência depois: id malformado nem chega
		// a consultar o banco, e id inexistente vira 400 em vez de update de
		// zero linhas devolvendo "salvo" para o usuário.
		const id = campoId(form.get('id'), 'impressora inválida');
		if (!id.ok) return fail(400, { erro: id.erro });

		const existe = db
			.select({ id: schema.impressora.id })
			.from(schema.impressora)
			.where(eq(schema.impressora.id, id.valor))
			.get();
		if (!existe) return fail(400, { erro: 'impressora não encontrada' });

		// Na edição o formulário volta PREENCHIDO com o que estava guardado:
		// devolvê-lo vazio não é só perder o digitado, é parecer que o cadastro
		// foi apagado.
		const eco = ecoDoFormulario(form, [
			'nome',
			'modelo',
			'apelidoBambu',
			'preco',
			'vidaUtilHoras',
			'potenciaMediaW'
		]);

		const campos = lerCampos(form, 'editar');
		if (!campos.ok) {
			return fail(400, {
				erro: campos.erro,
				campo: campos.campo,
				editandoId: id.valor,
				valores: eco
			});
		}

		const r = editarImpressora(
			db,
			id.valor,
			{ ...campos.valores, ativa: form.get('ativa') === 'on' },
			form.get('recalcular') === 'on'
		);
		if (!r.ok) return fail(400, { erro: r.erro });

		return { sucesso: true, recalculadas: r.recalculadas ?? 0 };
	},

	excluir: async ({ request }) => {
		const form = await request.formData();
		const id = campoId(form.get('id'), 'impressora inválida');
		if (!id.ok) return fail(400, { erro: id.erro });

		// A confirmação é servida como tela; este campo é a prova de que ela foi
		// atravessada. Um POST direto na action, sem passar por ela, não apaga.
		if (form.get('confirmar') !== '1') return fail(400, { erro: 'exclusão não confirmada' });

		const r = excluirImpressora(db, id.valor);
		if (!r.ok) return fail(400, { erro: r.erro });

		// Redireciona para tirar `?excluir=` da barra: sem isso a tela de
		// confirmação de um registro que não existe mais continuaria montada.
		redirect(303, '/impressoras');
	}
};
