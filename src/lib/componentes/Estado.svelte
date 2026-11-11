<script lang="ts">
	import type { Estado } from '$lib/formato';
	import type { NomeIcone } from '$lib/icones';
	import Icone from './Icone.svelte';

	/**
	 * O estado de uma coisa: ícone + palavra escrita.
	 *
	 * `nome` é obrigatório na assinatura de propósito: estado nunca é canal
	 * único. Uma prop opcional deixaria alguém entregar só o símbolo, e quem
	 * não distingue as cores (ou não conhece o ícone) perderia a informação
	 * inteira. O ícone tem forma própria por estado — círculo com visto,
	 * triângulo, círculo com xis —, então a cor é o terceiro canal, não o único.
	 */
	interface Props {
		estado: Estado;
		nome: string;
		/** Retorno de formulário: o leitor de tela precisa ser avisado. */
		anuncia?: boolean;
	}

	let { estado, nome, anuncia = false }: Props = $props();

	const ICONE: Record<Estado, NomeIcone> = {
		ok: 'sucesso',
		atencao: 'alerta',
		falha: 'falha',
		materia: 'info',
		ligado: 'impressoras'
	};
	// "cancelada" chega aqui como `atencao`, mas tem desenho próprio.
	const icone = $derived(nome === 'cancelada' ? 'cancelada' : ICONE[estado]);
</script>

<span class="marca marca--{estado}" role={anuncia ? 'status' : undefined}>
	<Icone nome={icone} tamanho={18} /><span class="marca__nome">{nome}</span>
</span>
