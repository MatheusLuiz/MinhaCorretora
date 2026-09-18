import type { NomeIcone } from '@/components/Icone';

/** Catálogo único de análises: painéis temáticos e Visão Geral usam a MESMA definição, para não divergirem. */

export type ChaveArea =
  | 'producao'
  | 'renovacoes'
  | 'receita'
  | 'clientes'
  | 'ramos'
  | 'seguradoras'
  | 'sinistros'
  | 'cancelamentos'
  | 'previsoes';

export interface Area {
  chave: ChaveArea;
  nome: string;
  descricao: string;
  icone: NomeIcone;
  rota: string;
  /** Permissão para o painel aparecer no menu (ausente = `dashboard.ver`); deve ser a da rota que ele lê, senão 403. */
  permissao?: string;
}

export const AREAS: Area[] = [
  {
    chave: 'producao',
    nome: 'Produção',
    descricao: 'Propostas, apólices, prêmio e comissão — por vendedor, filial, seguradora e ramo',
    icone: 'producao',
    rota: '/dashboards/producao',
    permissao: 'apolices.ler',
  },
  {
    chave: 'renovacoes',
    nome: 'Renovações',
    descricao: 'Carteira a vencer, histórico de renovação e probabilidade por apólice',
    icone: 'renovacoes',
    rota: '/dashboards/renovacoes',
  },
  // Sem dashboard próprio: a chave fica para os cartões rec.* e fin.inadimplencia da Visão Geral.
  {
    chave: 'clientes',
    nome: 'Clientes',
    descricao: 'Entradas e saídas, carteira ativa, frequência de contratação e cross-sell',
    icone: 'clientes',
    rota: '/dashboards/clientes',
    permissao: 'clientes.ler',
  },
  {
    chave: 'ramos',
    nome: 'Ramos',
    descricao: 'Desempenho por ramo: auto, residencial, vida, empresarial, saúde, transportes e agrícola',
    icone: 'carteira',
    rota: '/dashboards/ramos',
    permissao: 'sinistros.ler',
  },
  {
    chave: 'seguradoras',
    nome: 'Seguradoras e metas',
    descricao: 'Participação por seguradora, metas comerciais, realizado, projeção e gap',
    icone: 'apolices',
    rota: '/dashboards/seguradoras',
  },
  {
    chave: 'sinistros',
    nome: 'Sinistros',
    descricao: 'Sinistros e assistências em análise, por seguradora e por causa',
    icone: 'sinistros',
    rota: '/dashboards/sinistros',
    permissao: 'sinistros.ler',
  },
  {
    // A gaveta lista clientes, por isso a permissão é a de Clientes.
    chave: 'cancelamentos',
    nome: 'Cancelamentos',
    descricao: 'Clientes com apólice cancelada nos últimos 1, 2, 3 e 4 meses, e quantos ficaram sem apólice',
    icone: 'clientes',
    rota: '/dashboards/cancelamentos',
    permissao: 'clientes.ler',
  },
  // Previsões fora do menu até haver série longa; a chave fica para os cartões prev.*.
];

/** Largura do widget na grade. */
export type Largura = 'terco' | 'metade' | 'inteiro';

export interface DefinicaoWidget {
  id: string;
  titulo: string;
  /** Subtítulo do cartão: o que o número significa. */
  descricao: string;
  area: ChaveArea;
  largura: Largura;
  /** Permissão exigida; ausente = visível para quem tem `dashboard.ver`. */
  permissao?: string;
  /** Padrão da Visão Geral de quem não personalizou e cujo papel não define um (`papeis.visao_geral`). */
  padraoNaVisaoGeral?: boolean;
  /** Destino do "Ver painel" quando não é a página da área (ex.: inadimplência mora em Financeiro). */
  rota?: string;
  /** Só na Visão Geral: está no padrão de algum papel, mas não pertence ao painel da área. */
  foraDoPainel?: boolean;
}

/** A ordem é a do seletor da Visão Geral e de cada painel: por área, do resumo ao detalhe. */
export const WIDGETS: DefinicaoWidget[] = [
  // ─────────── Produção ───────────
  { id: 'geral.hoje',         titulo: 'Hoje na corretora',          descricao: 'Os números do dia. Clique num deles para ver o detalhe', area: 'producao', largura: 'inteiro' },
  { id: 'prod.resumo',        titulo: 'Resumo da produção',        descricao: 'Propostas, apólices, prêmio e comissão do mês', area: 'producao', largura: 'inteiro', padraoNaVisaoGeral: true },
  { id: 'prod.premio',        titulo: 'Prêmio contra a meta',       descricao: 'Emitido e meta nos últimos 24 meses',           area: 'producao', largura: 'inteiro', padraoNaVisaoGeral: true },
  { id: 'prod.propostas',     titulo: 'Propostas e apólices',       descricao: 'Volume e conversão mês a mês',                   area: 'producao', largura: 'metade' },
  { id: 'prod.ticket',        titulo: 'Ticket médio',               descricao: 'Prêmio médio por apólice emitida',               area: 'producao', largura: 'metade' },
  { id: 'prod.vendedor',      titulo: 'Vendas por vendedor',        descricao: 'Prêmio no mês, com variação contra o anterior',  area: 'producao', largura: 'metade', permissao: 'relatorios.ler' },
  { id: 'prod.filial',        titulo: 'Vendas por filial',          descricao: 'Distribuição da produção entre as unidades',     area: 'producao', largura: 'metade', permissao: 'relatorios.ler' },
  { id: 'prod.seguradora',    titulo: 'Vendas por seguradora',      descricao: 'Prêmio por companhia, e o quanto está concentrado', area: 'producao', largura: 'metade', padraoNaVisaoGeral: true },
  { id: 'prod.ramo',          titulo: 'Vendas por ramo',            descricao: 'Prêmio por ramo SUSEP',                          area: 'producao', largura: 'metade' },
  { id: 'prod.canal',         titulo: 'Vendas por canal',           descricao: 'Por qual rota o negócio chegou: campanha, central de renovação ou emissão direta', area: 'producao', largura: 'metade' },
  { id: 'prod.tipoNegocio',   titulo: 'Novos e renovações',         descricao: 'Composição da produção mês a mês',                area: 'producao', largura: 'inteiro', padraoNaVisaoGeral: true },

  // ─────────── Renovações ───────────
  { id: 'renov.resumo',       titulo: 'Renovações do mês',          descricao: 'Quantas vencem e o prêmio em jogo. Clique num número e abra na fila', area: 'renovacoes', largura: 'inteiro', padraoNaVisaoGeral: true },
  { id: 'renov.porMes',       titulo: 'Vencimentos por mês',        descricao: 'Quantas apólices vencem em cada mês, por seguradora. Clique num mês para ver quais', area: 'renovacoes', largura: 'inteiro' },
  { id: 'renov.carteira',    titulo: 'Fila de renovação',          descricao: 'Quem procurar, por urgência: apólice, vencimento, corretor e contato', area: 'renovacoes', largura: 'inteiro', permissao: 'apolices.ler', foraDoPainel: true },
  { id: 'renov.seguradora',   titulo: 'Lista da seguradora',        descricao: 'O que a companhia informa a renovar. Clique para ver a lista na fila', area: 'renovacoes', largura: 'metade', permissao: 'apolices.ler' },
  { id: 'renov.encerradas',   titulo: 'Encerradas: voltaram ou não', descricao: 'Encerradas pela seguradora e se voltaram pela placa. Clique para ver na fila', area: 'renovacoes', largura: 'metade', permissao: 'apolices.ler' },
  { id: 'renov.historico',  titulo: 'Novos e renovações',         descricao: 'Apólices novas e renovadas mês a mês, nos últimos 12 meses', area: 'renovacoes', largura: 'inteiro' },
  // Sempre "pendente" (falta histórico por cliente): fora do painel.
  { id: 'renov.probabilidade',titulo: 'Probabilidade de renovação', descricao: 'Por apólice, com os fatores que pesam',           area: 'renovacoes', largura: 'inteiro', permissao: 'apolices.ler', foraDoPainel: true },

  // ─────────── Receita ───────────
  { id: 'fin.inadimplencia',  titulo: 'Inadimplência',              descricao: 'Parcelas em atraso, clientes devendo e as mais antigas', area: 'receita', largura: 'metade', permissao: 'inadimplencia.ler', rota: '/financeiro/inadimplencia', foraDoPainel: true },
  { id: 'rec.comissao',       titulo: 'Comissão mensal',            descricao: 'Comissão apurada nos últimos 24 meses',           area: 'receita', largura: 'inteiro', permissao: 'comissoes.ler', rota: '/dashboards/comissoes', padraoNaVisaoGeral: true },
  { id: 'rec.acumulada',      titulo: 'Receita acumulada',          descricao: 'Comissão somada no exercício',                    area: 'receita', largura: 'metade', permissao: 'comissoes.ler', rota: '/dashboards/comissoes' },
  { id: 'rec.meta',           titulo: 'Atingimento da meta anual',  descricao: 'Realizado, meta, ritmo esperado e gap',           area: 'receita', largura: 'metade', permissao: 'comissoes.ler', rota: '/dashboards/comissoes', padraoNaVisaoGeral: true },
  { id: 'rec.ramo',           titulo: 'Receita por ramo',           descricao: 'Comissão estimada por ramo',                      area: 'receita', largura: 'metade', permissao: 'comissoes.ler', rota: '/dashboards/comissoes' },
  { id: 'rec.seguradora',     titulo: 'Receita por seguradora',     descricao: 'Comissão por parceira',                           area: 'receita', largura: 'metade', permissao: 'comissoes.ler', rota: '/dashboards/comissoes' },
  { id: 'rec.vendedor',       titulo: 'Receita por vendedor',       descricao: 'Comissão gerada por cada vendedor',               area: 'receita', largura: 'metade', permissao: 'comissoes.ler', rota: '/dashboards/comissoes' },

  // ─────────── Clientes ───────────
  { id: 'cli.resumo',         titulo: 'Carteira de clientes',       descricao: 'Ativos, inativos, novos e perdidos',              area: 'clientes', largura: 'inteiro', permissao: 'clientes.ler', padraoNaVisaoGeral: true },
  { id: 'cli.movimento',      titulo: 'Entradas e saídas',          descricao: 'Novos e perdidos mês a mês, com saldo',           area: 'clientes', largura: 'inteiro', permissao: 'clientes.ler' },
  { id: 'cli.frequencia',     titulo: 'Frequência de contratação',  descricao: 'Quantos produtos cada cliente tem',               area: 'clientes', largura: 'metade', permissao: 'clientes.ler' },
  { id: 'cli.crosssell',      titulo: 'Potencial de cross-sell',    descricao: 'Combinações de ramo com maior espaço',            area: 'clientes', largura: 'metade', permissao: 'clientes.ler' },

  // ─────────── Ramos ───────────
  { id: 'ramo.comparativo',   titulo: 'Comparativo entre ramos',    descricao: 'Prêmio, apólices, ticket, comissão e sinistralidade', area: 'ramos', largura: 'inteiro', padraoNaVisaoGeral: true },
  { id: 'ramo.participacao',  titulo: 'Participação por ramo',      descricao: 'Peso de cada ramo no prêmio total',               area: 'ramos', largura: 'metade' },
  { id: 'ramo.crescimento',   titulo: 'Crescimento por ramo',       descricao: 'Variação contra o período anterior',               area: 'ramos', largura: 'metade' },
  // Sinistros: os blocos do dashboard, lidos do mesmo resumo.
  { id: 'sin.resumo',         titulo: 'Sinistros em andamento',     descricao: 'Em análise, abertos há mais de 60 dias e recusados', area: 'sinistros', largura: 'inteiro', permissao: 'sinistros.ler' },
  { id: 'sin.mes',            titulo: 'Acionamentos por mês',       descricao: 'Sinistro e assistência nos últimos 12 meses',     area: 'sinistros', largura: 'metade', permissao: 'sinistros.ler' },
  { id: 'sin.seguradoras',    titulo: 'Sinistros por seguradora',   descricao: 'Acionamentos por companhia — abre a fila',         area: 'sinistros', largura: 'metade', permissao: 'sinistros.ler' },
  { id: 'ramo.sinistralidade',titulo: 'Sinistralidade por ramo',    descricao: 'Onde a carteira consome mais',                     area: 'ramos', largura: 'metade', permissao: 'sinistros.ler' },

  // ─────────── Seguradoras ───────────
  { id: 'seg.participacao',   titulo: 'Participação por seguradora',descricao: 'Concentração da carteira entre parceiras',        area: 'seguradoras', largura: 'metade' },
  { id: 'seg.metas',          titulo: 'Metas por seguradora',       descricao: 'Meta, realizado e gap de cada parceira',           area: 'seguradoras', largura: 'inteiro', permissao: 'relatorios.ler' },
  { id: 'seg.projecao',       titulo: 'Projeção por seguradora',    descricao: 'Onde a meta anual deve fechar no ritmo atual',     area: 'seguradoras', largura: 'inteiro', permissao: 'relatorios.ler' },

  // ─────────── Previsões ───────────
  { id: 'prev.tendencia',     titulo: 'Tendência da produção',      descricao: 'Direção, intensidade e quanto a reta explica',     area: 'previsoes', largura: 'metade', padraoNaVisaoGeral: true },
  { id: 'prev.sazonalidade',  titulo: 'Sazonalidade',               descricao: 'Desvio de cada mês em relação à média do ano',     area: 'previsoes', largura: 'inteiro' },
  { id: 'prev.forecast',      titulo: 'Projeção de 3 meses',        descricao: 'Tendência + sazonalidade, com faixa de incerteza', area: 'previsoes', largura: 'inteiro', padraoNaVisaoGeral: true },
  { id: 'prev.cancelamento',  titulo: 'Risco de cancelamento',      descricao: 'Apólices com menor probabilidade de renovar',      area: 'previsoes', largura: 'metade', permissao: 'apolices.ler' },
  { id: 'prev.demanda',       titulo: 'Previsão de demanda',        descricao: 'Propostas esperadas nos próximos meses',           area: 'previsoes', largura: 'metade' },

  // ─────────── Automóvel ───────────
];

export const WIDGETS_POR_ID = new Map(WIDGETS.map((w) => [w.id, w]));

/** Conveniência, não segurança: quem protege o dado é a permissão na rota da API. */
export function widgetsPermitidos(
  widgets: DefinicaoWidget[],
  temPermissao: (...p: string[]) => boolean,
): DefinicaoWidget[] {
  return widgets.filter((w) => !w.permissao || temPermissao(w.permissao));
}
