<script lang="ts">
	/**
	 * A `medida` da Mesa: nome + trilho + barra + valor em mono.
	 *
	 * A Mesa exige que a escala plena esteja SEMPRE escrita ao lado — sem ela
	 * uma barra não é legível como medida, é um enfeite proporcional a nada.
	 * Por isso `valor` é obrigatório, e quem chama escreve a régua junto
	 * ("459 g de 1.000 g", "R$ 7,93 de R$ 9,67").
	 *
	 * A largura da barra é o dado e não arredonda para nada: 62,4% de 1 kg é
	 * 62,4%. O que se limita é só o intervalo do trilho.
	 *
	 * As classes internas são o BEM do sistema (`.medida__nome`,
	 * `.medida__trilho`, `.medida__barra`, `.medida__valor` — ver
	 * `static/sistema/elementos.css`), não nomes soltos: o sistema estiliza o
	 * CONTRATO inteiro, contêiner e filhos, e um filho fora do BEM não recebe
	 * nada — foi assim que a barra ficou 0×0 até a Task 6 medir e achar (ver
	 * `task-6-report.md`, fix round 1). `.medida__desvio` e `.medida__rodadas`
	 * também existem no pacote, para uma barra com marca de tolerância e
	 * contagem de rodadas; este componente não modela nem um nem outro — as
	 * três chamadas do Carretel são fração simples de um total —, então ficam
	 * de fora até existir dado real para passar a eles.
	 */
	interface Props {
		nome: string;
		/** 0 a 1. */
		fracao: number;
		valor: string;
	}

	let { nome, fracao, valor }: Props = $props();

	const largura = $derived(Math.min(100, Math.max(0, fracao * 100)));
</script>

<div class="medida">
	<span class="medida__nome">{nome}</span>
	<div class="medida__trilho"><div class="medida__barra" style="width: {largura}%"></div></div>
	<span class="medida__valor">{valor}</span>
</div>
