import type { RowDataPacket } from 'mysql2/promise';

import { pool } from '../database/pool.js';
import * as clienteRepo from './cliente.repository.js';
import * as grupoRepo from './grupoCliente.repository.js';
import { condicaoDeCarteira, ESCOPO_TOTAL, type Escopo } from '../utils/escopo.js';
import { condicaoEmVigor, condicaoSituacaoAtiva } from '../utils/vigencia.js';

/**
 * Os números dos painéis, num endpoint só (um por painel acabaria divergindo).
 * A série é cortada em JANELA_MESES por viés de sobrevivência: relatório de
 * VIGENTES não traz o que venceu; o resto vai em `producao.foraDaJanela`.
 */

export interface Ponto {
  periodo: string;
  valor: number;
}

export interface Fatia {
  rotulo: string;
  valor: number;
  /** Quantidade por trás do valor, quando o valor é dinheiro. */
  quantidade?: number;
}

/** Frequência por ramo; assistência à parte — guincho não é sinistro. */
export interface FrequenciaSinistro extends Fatia {
  assistencias: number;
}

export interface DadosPaineis {
  producao: {
    apolices: number;
    comPremio: number;
    premioTotal: number;
    ticketMedio: number | null;
    movimentos: { rotulo: string; valor: number }[];

    /** Quantos meses a série cobre — e o painel precisa dizer na tela. */
    janelaMeses: number;
    porMes: {
      periodo: string;
      apolices: number;
      premio: number;
      novos: number;
      renovacoes: number;
      /** Mês ainda correndo: a tela pontilha a barra em vez de sugerir queda. */
      parcial: boolean;
    }[];
    /** O que o corte deixou de fora, para o painel explicá-lo. */
    foraDaJanela: { apolices: number; meses: number; premio: number };

    porSeguradora: Fatia[];
    porProduto: Fatia[];
    porRamo: Fatia[];
    porVendedor: Fatia[];
    /** Por onde a venda entrou — "Grupo de Produção" na origem. */
    porCanal: Fatia[];
    /** Novo x renovação, direto do "Tipo de Negócio" da origem. */
    porTipoNegocio: { rotulo: string; apolices: number; premio: number }[];
  };
  renovacoes: {
    total: number;
    em30: number;
    em60: number;
    em90: number;
    /** Prêmio de TODA apólice em vigor — é a carteira, não o risco. */
    premioEmRisco: number;
    /** Prêmio do que vence em até 90 dias — o que está de fato em jogo. */
    premioEm90: number;
    jaRenovadas: number;
    canceladas: number;
    /**
     * Renovações ÷ classificadas na janela (vigentes não traz as que não voltaram).
     * NULL quando a classificação não cobre a janela — só renovações daria 100%.
     */
    proporcaoRenovacao: number | null;
    /** Apólices da janela com novo/renovação informado, e o total da janela. */
    classificacaoTipoNegocio: { classificadas: number; naJanela: number };
    /** Vencimentos por mês e seguradora; mesma condição da dimensão `vencimentoMes`. */
    porMes: { periodo: string; seguradora: string; apolices: number; premio: number }[];
    /** Fila de renovação: traz corretor e contato porque quem renova é o corretor. */
    proximas: {
      numero: string;
      segurado: string;
      seguradora: string;
      produto: string | null;
      vigenciaFim: string | null;
      premio: number | null;
      diasParaVencer: number;
      /** Identificador público do cliente, para abrir a ficha a partir da fila. */
      clienteUuid: string | null;
      corretor: string | null;
      telefone: string | null;
      email: string | null;
    }[];
    /** Quantas da fila não têm telefone nem e-mail — a tela precisa dizer. */
    semContato: number;
  };

  /**
   * Comissão por apólice (bruta, sabe cliente e vendedor). Não soma com `receita`,
   * o demonstrativo pago (líquido, sem cliente): seria o mesmo dinheiro duas vezes.
   */
  comissaoCarteira: {
    apolices: number;
    total: number;
    /** Média ponderada pelo prêmio, não média das porcentagens. */
    percentualMedio: number | null;
    porMes: Ponto[];
    porSeguradora: Fatia[];
    porVendedor: Fatia[];
    porRamo: Fatia[];
  };

  receita: {
    competencias: string[];
    bruto: number;
    impostos: number;
    liquido: number;
    porFilial: Fatia[];
    porCompetencia: Ponto[];
    porSeguradora: Fatia[];
    /** Soma por tipo de lançamento — separa acerto retroativo da produção do mês. */
    porTipo: Fatia[];
    /** Soma por tipo dentro de cada competência; o tipo é a palavra da companhia. */
    porCompetenciaTipo: { periodo: string; rotulo: string; valor: number }[];
    /** Uma linha por competência, como o portal: a CONTAGEM de ordens denuncia arquivo faltando. */
    fechamento: {
      competencia: string;
      ordens: number;
      primeiro: string | null;
      ultimo: string | null;
      bruto: number;
      impostos: number;
      liquido: number;
    }[];
  };
  /** Situação por grupo de cliente, cada um separado (chave → contagem). */
  carteiras: Record<string, clienteRepo.CarteiraComercialContagem>;
  /** Os grupos de cliente, na ordem do cadastro. */
  grupos: grupoRepo.GrupoDoPainel[];
  carteira: {
    total: number;
    /** Na carteira — inclui quem tem apólice em vigor e quem não teve apólice importada. */
    ativos: number;
    /** Tem apólice EM VIGOR na base. */
    comApoliceVigente: number;
    /** É cliente, mas nenhuma apólice dele foi importada. */
    semApoliceConhecida: number;
    inativos: number;
    prospectos: number;
    inadimplentes: number;
    novosNoAno: number;
    perdidosNoAno: number;
  };
  movimento: { periodo: string; novos: number; perdidos: number }[];

  clientes: {
    /** Quantos clientes têm 1, 2, 3... apólices. */
    porApolices: { apolices: number; clientes: number }[];
    /** `exclusivos`: clientes que só têm AQUELE ramo — onde mora o cross-sell. */
    crossSell: { ramo: string; clientes: number; exclusivos: number }[];
  };

  /** Frequência de sinistro por ramo; só ramos com 20+ apólices (menos não descreve risco). */
  sinistroPorRamo: FrequenciaSinistro[];

  /** Ramos apurados pelos vínculos de cliente — não pelo prêmio. */
  ramosPorCliente: Fatia[];
  seguradorasPorCliente: Fatia[];

  disponivel: Disponibilidade;
}

/** O que tem origem hoje: o painel desenha ou explica a ausência. */
export interface Disponibilidade {
  /** Há apólice importada. */
  producao: boolean;
  /** Há prêmio em quantidade que justifique somar. */
  premio: boolean;
  /** Há apólice e nenhuma tem prêmio: a unidade passa a ser APÓLICE, não reais. */
  medirEmApolices: boolean;
  /** Série mensal de PRÊMIO com meses suficientes para virar linha. */
  serieProducao: boolean;
  /** Série mensal de CONTAGEM de apólices — não depende de prêmio. */
  serieApolices: boolean;
  /** Há base fora da janela — a tela precisa explicar o corte. */
  serieRecortada: boolean;
  /** Mais de uma seguradora com apólice — senão o gráfico é uma fatia só. */
  producaoPorSeguradora: boolean;
  /** `produtos.ramo_id` preenchido — dá para agrupar por ramo, nem que seja contando. */
  apolicesPorRamo: boolean;
  /** O mesmo, mas com prêmio para somar. Sem isto a barra sai zerada com cifrão. */
  premioPorRamo: boolean;
  /** Ramo pelo vínculo do cliente, que a importação de clientes trouxe. */
  ramoPorCliente: boolean;
  /** Há cliente na carteira de quem está olhando. */
  carteira: boolean;
  /** Há cliente cujas apólices não foram importadas (não é perda de carteira). */
  clientesSemApoliceImportada: boolean;
  /** Há saída registrada com data — senão a série de perdidos é uma linha em zero. */
  saidasDeClientes: boolean;
  /** Há entrada/saída DATADA com cobertura suficiente para desenhar a série. */
  movimentoDeClientes: boolean;
  renovacoes: boolean;
  /** Histórico de renovação/cancelamento ao longo do tempo. */
  historicoRenovacao: boolean;
  /** Novo x renovação classificado na origem. */
  tipoNegocio: boolean;
  receita: boolean;
  /** Competências suficientes para uma série de comissão. */
  serieReceita: boolean;
  /** Comissão por filial — o único recorte que o demonstrativo sustenta. */
  receitaPorFilial: boolean;
  /** Comissão por apólice, que chega ao cliente e ao vendedor. */
  comissaoPorApolice: boolean;
  /** Há cliente com mais de uma apólice — senão a distribuição é uma barra só. */
  frequenciaDeContratacao: boolean;
  /** Há cliente com mais de um ramo — senão não há combinação a comparar. */
  crossSell: boolean;
  /** `apolices.produtor_id` preenchido — quem VENDEU, e não o dono da carteira. */
  producaoPorVendedor: boolean;
  /** Canal de entrada da venda. */
  producaoPorCanal: boolean;
  /** FREQUÊNCIA de sinistro (S/N da origem) — não sinistralidade. */
  frequenciaDeSinistro: boolean;

  // Dependem de dado que o sistema ainda não recebe de ninguém.
  propostas: boolean;
  metas: boolean;
  producaoPorFilial: boolean;
  sinistros: boolean;
  veiculos: boolean;
  previsoes: boolean;
}

const MESES_MINIMOS_PARA_SERIE = 3;

/** Fração da carteira com data para a série de movimento valer — abaixo disso é viés. */
const COBERTURA_MINIMA_DE_DATA = 0.9;

/** Doze: o ciclo do seguro; mais que isso, o viés de sobrevivência entra na curva. */
const JANELA_MESES = 12;

/** Primeiro dia do mês que abre a janela — 12 baldes cheios, e não 13 quebrados. */
const INICIO_JANELA = `DATE_FORMAT(DATE_SUB(CURDATE(), INTERVAL ${JANELA_MESES - 1} MONTH), '%Y-%m-01')`;

/** `AAAA-MM` de hoje, no mesmo formato que `DATE_FORMAT(..., '%Y-%m')` devolve. */
function periodoCorrente(): string {
  const agora = new Date();
  return `${agora.getFullYear()}-${String(agora.getMonth() + 1).padStart(2, '0')}`;
}

/** Junta as condições num WHERE, ou devolve string vazia. */
function onde(...partes: (string | null)[]): string {
  const validas = partes.filter((p): p is string => Boolean(p));
  return validas.length > 0 ? `WHERE ${validas.join(' AND ')}` : '';
}

export async function carregar(escopo: Escopo = ESCOPO_TOTAL): Promise<DadosPaineis> {
  const q = async (sql: string, valores: unknown[] = []): Promise<RowDataPacket[]> =>
    (await pool.query<RowDataPacket[]>(sql, valores))[0];

  // Recorte pelo produtor do CLIENTE (dono da carteira), nunca o da apólice (quem
  // vendeu): trocar abriria a carteira a quem vendeu uma apólice avulsa ao cliente.
  const carteira = condicaoDeCarteira(escopo, 'c.produtor_id');
  const v = carteira.valores;

  const juncaoCliente = 'LEFT JOIN clientes c ON c.id = a.cliente_id';
  const naJanela = `a.vigencia_inicio >= ${INICIO_JANELA}`;

  // ORDEM POSICIONAL: casa com o array de consultas — consulta nova vai no FIM.
  const [
    totais,
    movimentos,
    porMes,
    foraDaJanela,
    porSeguradora,
    porProduto,
    porRamo,
    porVendedor,
    porCanal,
    sinistroPorRamo,
    porTipoNegocio,
    renovacaoResumo,
    proximas,
    comissaoApolice,
    comissaoApoliceMes,
    comissaoApoliceSeguradora,
    comissaoApoliceVendedor,
    comissaoApoliceRamo,
    comissaoTotais,
    comissaoFilial,
    comissaoCompetencia,
    comissaoFechamento,
    comissaoSeguradora,
    comissaoTipo,
    comissaoTipoMes,
    ramosCliente,
    seguradorasCliente,
    apolicesPorCliente,
    crossSell,
    resumoCarteira,
    movimento,
    vencimentosPorMes,
    porCarteira,
  ] = await Promise.all([
    q(
      `SELECT COUNT(*) AS apolices,
              SUM(a.premio_total IS NOT NULL) AS com_premio,
              COALESCE(SUM(a.premio_total), 0) AS premio,
              COUNT(DISTINCT a.seguradora_id) AS seguradoras,
              SUM(a.produtor_id IS NOT NULL) AS com_vendedor,
              SUM(a.tipo_negocio IS NOT NULL) AS com_tipo
         FROM apolices a ${juncaoCliente} ${onde(carteira.condicao)}`,
      v,
    ),
    q(
      `SELECT m.tipo AS rotulo, COUNT(*) AS valor
         FROM apolice_movimentos m
         JOIN apolices a ON a.id = m.apolice_id ${juncaoCliente}
        ${onde(carteira.condicao)}
        GROUP BY m.tipo ORDER BY valor DESC`,
      v,
    ),

    q(
      `SELECT DATE_FORMAT(a.vigencia_inicio, '%Y-%m') AS periodo,
              COUNT(*) AS apolices,
              COALESCE(SUM(a.premio_total), 0) AS premio,
              SUM(a.tipo_negocio = 'novo') AS novos,
              SUM(a.tipo_negocio = 'renovacao') AS renovacoes
         FROM apolices a ${juncaoCliente}
        ${onde(naJanela, carteira.condicao)}
        GROUP BY periodo ORDER BY periodo`,
      v,
    ),
    q(
      `SELECT COUNT(*) AS apolices,
              COUNT(DISTINCT DATE_FORMAT(a.vigencia_inicio, '%Y-%m')) AS meses,
              COALESCE(SUM(a.premio_total), 0) AS premio
         FROM apolices a ${juncaoCliente}
        ${onde('a.vigencia_inicio IS NOT NULL', `NOT (${naJanela})`, carteira.condicao)}`,
      v,
    ),

    q(
      `SELECT s.nome AS rotulo,
              COALESCE(SUM(a.premio_total), 0) AS valor,
              COUNT(*) AS quantidade
         FROM apolices a
         JOIN seguradoras s ON s.id = a.seguradora_id ${juncaoCliente}
        ${onde(carteira.condicao)}
        GROUP BY s.nome ORDER BY valor DESC, quantidade DESC`,
      v,
    ),
    q(
      `SELECT p.nome AS rotulo,
              COALESCE(SUM(a.premio_total), 0) AS valor,
              COUNT(*) AS quantidade
         FROM apolices a
         JOIN produtos p ON p.id = a.produto_id ${juncaoCliente}
        ${onde(carteira.condicao)}
        GROUP BY p.nome ORDER BY quantidade DESC, valor DESC LIMIT 12`,
      v,
    ),

    // Ramo pelo PRODUTO: o vínculo cliente↔seguradora não sabe qual prêmio é de qual ramo.
    q(
      `SELECT r.nome AS rotulo,
              COALESCE(SUM(a.premio_total), 0) AS valor,
              COUNT(*) AS quantidade
         FROM apolices a
         JOIN produtos p ON p.id = a.produto_id
         JOIN ramos r ON r.id = p.ramo_id
         ${juncaoCliente}
        ${onde(carteira.condicao)}
        GROUP BY r.nome ORDER BY valor DESC`,
      v,
    ),
    q(
      `SELECT pr.nome AS rotulo,
              COALESCE(SUM(a.premio_total), 0) AS valor,
              COUNT(*) AS quantidade
         FROM apolices a
         JOIN produtores pr ON pr.id = a.produtor_id
         ${juncaoCliente}
        ${onde(naJanela, carteira.condicao)}
        GROUP BY pr.nome ORDER BY valor DESC LIMIT 20`,
      v,
    ),
    q(
      `SELECT c2.nome AS rotulo,
              COALESCE(SUM(a.premio_total), 0) AS valor,
              COUNT(*) AS quantidade
         FROM apolices a
         JOIN canais_producao c2 ON c2.id = a.canal_id
         ${juncaoCliente}
        ${onde(naJanela, carteira.condicao)}
        GROUP BY c2.nome ORDER BY valor DESC LIMIT 15`,
      v,
    ),

    // Denominador = apólice COBERTA: S/N de origem, ou cia com relatório de sinistros
    // importado (lá, não estar em `sinistros` = não acionou).
    q(
      `SELECT r.nome AS rotulo,
              SUM(a.possui_sinistro = 1) AS valor,
              COUNT(*) AS quantidade,
              SUM(EXISTS (SELECT 1 FROM sinistros s
                           WHERE s.apolice_id = a.id AND s.tipo = 'assistencia')) AS assistencias
         FROM apolices a
         JOIN produtos p ON p.id = a.produto_id
         JOIN ramos r ON r.id = p.ramo_id
         ${juncaoCliente}
        ${onde(
          `(a.possui_sinistro IS NOT NULL
            OR EXISTS (SELECT 1 FROM sinistros s WHERE s.seguradora_id = a.seguradora_id))`,
          carteira.condicao,
        )}
        GROUP BY r.nome
        HAVING COUNT(*) >= 20
        ORDER BY SUM(a.possui_sinistro = 1) / COUNT(*) DESC`,
      v,
    ),

    q(
      `SELECT a.tipo_negocio AS rotulo,
              COUNT(*) AS apolices,
              COALESCE(SUM(a.premio_total), 0) AS premio
         FROM apolices a ${juncaoCliente}
        ${onde(naJanela, 'a.tipo_negocio IS NOT NULL', carteira.condicao)}
        GROUP BY a.tipo_negocio`,
      v,
    ),

    q(
      // Cada contagem exclui canceladas, como a fila e a gaveta — os totais têm de bater.
      `SELECT
         SUM(${condicaoEmVigor("a")}) AS a_renovar,
         SUM(${condicaoSituacaoAtiva("a")} AND a.vigencia_fim BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL 30 DAY)) AS em30,
         SUM(${condicaoSituacaoAtiva("a")} AND a.vigencia_fim BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL 60 DAY)) AS em60,
         SUM(${condicaoSituacaoAtiva("a")} AND a.vigencia_fim BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL 90 DAY)) AS em90,
         COALESCE(SUM(CASE WHEN ${condicaoEmVigor("a")} THEN a.premio_total END), 0) AS premio_risco,
         COALESCE(SUM(CASE WHEN ${condicaoSituacaoAtiva("a")} AND a.vigencia_fim BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL 90 DAY) THEN a.premio_total END), 0) AS premio_em90,
         SUM(a.numero_renovacao > 0) AS ja_renovadas,
         SUM(a.cancelada_em IS NOT NULL OR a.situacao_cia = 'cancelada') AS canceladas
         FROM apolices a ${juncaoCliente} ${onde(carteira.condicao)}`,
      v,
    ),
    q(
      // BIN_TO_UUID com flag 1: sem ela o uuid parece válido e a ficha não acha o cliente.
      // Teto 200: é uma fila de trabalho, e são centenas de vencimentos.
      `SELECT a.numero, a.nome_segurado, s.nome AS seguradora, p.nome AS produto,
              a.vigencia_fim, a.premio_total,
              DATEDIFF(a.vigencia_fim, CURDATE()) AS dias,
              BIN_TO_UUID(c.uuid, 1) AS cliente_uuid,
              pr.nome AS corretor,
              (SELECT t.completo FROM telefones t
                WHERE t.cliente_id = c.id
                ORDER BY t.principal DESC, t.id LIMIT 1) AS telefone,
              (SELECT e.endereco FROM emails e
                WHERE e.cliente_id = c.id
                ORDER BY e.principal DESC, e.id LIMIT 1) AS email
         FROM apolices a
         JOIN seguradoras s ON s.id = a.seguradora_id
         LEFT JOIN produtos p ON p.id = a.produto_id
         ${juncaoCliente}
         LEFT JOIN produtores pr ON pr.id = c.produtor_id
        ${onde(condicaoEmVigor('a'), carteira.condicao)}
        ORDER BY a.vigencia_fim LIMIT 200`,
      v,
    ),

    // Comissão da apólice passa pelo recorte de carteira; % médio ponderado pelo prêmio.
    q(
      `SELECT COUNT(*) AS apolices,
              COALESCE(SUM(a.comissao), 0) AS total,
              COALESCE(SUM(a.premio_total), 0) AS premio_base
         FROM apolices a ${juncaoCliente}
        ${onde('a.comissao IS NOT NULL', 'a.comissao > 0', carteira.condicao)}`,
      v,
    ),
    q(
      `SELECT DATE_FORMAT(a.vigencia_inicio, '%Y-%m') AS periodo,
              COALESCE(SUM(a.comissao), 0) AS valor
         FROM apolices a ${juncaoCliente}
        ${onde(naJanela, 'a.comissao IS NOT NULL', carteira.condicao)}
        GROUP BY periodo ORDER BY periodo`,
      v,
    ),
    q(
      `SELECT s.nome AS rotulo, COALESCE(SUM(a.comissao), 0) AS valor, COUNT(*) AS quantidade
         FROM apolices a
         JOIN seguradoras s ON s.id = a.seguradora_id ${juncaoCliente}
        ${onde('a.comissao IS NOT NULL', 'a.comissao > 0', carteira.condicao)}
        GROUP BY rotulo ORDER BY valor DESC`,
      v,
    ),
    q(
      `SELECT pr.nome AS rotulo, COALESCE(SUM(a.comissao), 0) AS valor, COUNT(*) AS quantidade
         FROM apolices a
         JOIN produtores pr ON pr.id = a.produtor_id ${juncaoCliente}
        ${onde(naJanela, 'a.comissao IS NOT NULL', 'a.comissao > 0', carteira.condicao)}
        GROUP BY rotulo ORDER BY valor DESC LIMIT 20`,
      v,
    ),
    q(
      `SELECT r.nome AS rotulo, COALESCE(SUM(a.comissao), 0) AS valor, COUNT(*) AS quantidade
         FROM apolices a
         JOIN produtos p ON p.id = a.produto_id
         JOIN ramos r ON r.id = p.ramo_id
         ${juncaoCliente}
        ${onde('a.comissao IS NOT NULL', 'a.comissao > 0', carteira.condicao)}
        GROUP BY rotulo ORDER BY valor DESC`,
      v,
    ),

    // O demonstrativo NÃO passa pelo recorte (não tem cliente); o controller zera para
    // quem não pode ver o total da corretora.
    q(`SELECT COALESCE(SUM(total_bruto),0) bruto,
              COALESCE(SUM(impostos),0) impostos,
              COALESCE(SUM(total_liquido),0) liquido,
              COUNT(DISTINCT competencia) competencias
         FROM comissoes`),
    q(`SELECT COALESCE(filial,'—') AS rotulo, SUM(total_liquido) AS valor, COUNT(*) AS quantidade
         FROM comissoes GROUP BY rotulo ORDER BY valor DESC`),
    q(`SELECT competencia AS periodo, SUM(total_liquido) AS valor
         FROM comissoes GROUP BY periodo ORDER BY periodo`),

    // Fechamento por competência, como o portal: a contagem de ordens denuncia arquivo não baixado.
    q(`SELECT competencia AS periodo,
              COUNT(*) AS ordens,
              MIN(pago_em) AS primeiro,
              MAX(pago_em) AS ultimo,
              COALESCE(SUM(total_bruto), 0) AS bruto,
              COALESCE(SUM(impostos), 0) AS impostos,
              COALESCE(SUM(total_liquido), 0) AS liquido
         FROM comissoes GROUP BY periodo ORDER BY periodo DESC`),
    q(`SELECT s.nome AS rotulo, SUM(c.total_liquido) AS valor, COUNT(*) AS quantidade
         FROM comissoes c JOIN seguradoras s ON s.id = c.seguradora_id
        GROUP BY rotulo ORDER BY valor DESC`),

    // Por TIPO de lançamento (palavra da companhia): separa acerto retroativo da produção.
    q(`SELECT COALESCE(i.tipo_descricao, '—') AS rotulo,
              SUM(i.comissao) AS valor, COUNT(*) AS quantidade
         FROM comissoes_itens i
        GROUP BY rotulo ORDER BY valor DESC`),

    q(`SELECT c.competencia AS periodo,
              COALESCE(i.tipo_descricao, '—') AS rotulo,
              SUM(i.comissao) AS valor
         FROM comissoes_itens i
         JOIN comissoes c ON c.id = i.comissao_id
        GROUP BY periodo, rotulo ORDER BY periodo`),

    // Pelos VÍNCULOS do cliente: "de que é a carteira", não "quanto produziu".
    q(
      `SELECT r.nome AS rotulo, COUNT(DISTINCT sc.cliente_id) AS valor
         FROM seguradoras_clientes sc
         JOIN ramos r ON r.id = sc.ramo_id
         JOIN clientes c ON c.id = sc.cliente_id
        ${onde(carteira.condicao)}
        GROUP BY rotulo ORDER BY valor DESC`,
      v,
    ),
    q(
      `SELECT sg.nome AS rotulo, COUNT(DISTINCT sc.cliente_id) AS valor
         FROM seguradoras_clientes sc
         JOIN seguradoras sg ON sg.id = sc.seguradora_id
         JOIN clientes c ON c.id = sc.cliente_id
        ${onde(carteira.condicao)}
        GROUP BY rotulo ORDER BY valor DESC`,
      v,
    ),

    q(
      `SELECT x.apolices, COUNT(*) AS clientes
         FROM (SELECT a.cliente_id, COUNT(*) AS apolices
                 FROM apolices a ${juncaoCliente}
                ${onde('a.cliente_id IS NOT NULL', carteira.condicao)}
                GROUP BY a.cliente_id) x
        GROUP BY x.apolices ORDER BY x.apolices`,
      v,
    ),

    q(
      `WITH cr AS (
         SELECT DISTINCT a.cliente_id AS cliente, p.ramo_id AS ramo
           FROM apolices a
           JOIN produtos p ON p.id = a.produto_id
           ${juncaoCliente}
          ${onde('a.cliente_id IS NOT NULL', 'p.ramo_id IS NOT NULL', carteira.condicao)}
       ),
       n AS (SELECT cliente, COUNT(*) AS ramos FROM cr GROUP BY cliente)
       SELECT r.nome AS ramo, COUNT(*) AS clientes, SUM(n.ramos = 1) AS exclusivos
         FROM cr
         JOIN n ON n.cliente = cr.cliente
         JOIN ramos r ON r.id = cr.ramo
        GROUP BY r.nome ORDER BY clientes DESC`,
      v,
    ),

    clienteRepo.resumoCarteira(escopo),
    clienteRepo.movimentoMensal(24, escopo),

    // No FIM (array posicional). Mesma condição da dimensão `vencimentoMes` da gaveta.
    q(
      `SELECT DATE_FORMAT(a.vigencia_fim, '%Y-%m') AS periodo, s.nome AS seguradora,
              COUNT(*) AS apolices, COALESCE(SUM(a.premio_total), 0) AS premio
         FROM apolices a
         JOIN seguradoras s ON s.id = a.seguradora_id
         ${juncaoCliente}
        ${onde(
          condicaoEmVigor('a'),
          "a.vigencia_fim < DATE_ADD(DATE_FORMAT(CURDATE(), '%Y-%m-01'), INTERVAL 12 MONTH)",
          carteira.condicao,
        )}
        GROUP BY periodo, s.nome
        ORDER BY periodo, s.nome`,
      v,
    ),

    // Também no FIM.
    clienteRepo.clientesPorCarteira(escopo),
  ]);

  const t = totais[0];
  const r = renovacaoResumo[0];
  const fora = foraDaJanela[0];
  const com = comissaoApolice[0];

  const fatia = (linhas: RowDataPacket[]): Fatia[] =>
    linhas.map((l) => ({
      rotulo: String(l.rotulo),
      valor: Number(l.valor ?? 0),
      quantidade: l.quantidade === undefined ? undefined : Number(l.quantidade),
    }));

  // O mês corrente é o último balde da janela, por construção de INICIO_JANELA.
  const mesCorrente = periodoCorrente();

  const serie = porMes.map((l) => ({
    periodo: String(l.periodo),
    apolices: Number(l.apolices ?? 0),
    premio: Number(l.premio ?? 0),
    novos: Number(l.novos ?? 0),
    renovacoes: Number(l.renovacoes ?? 0),
    parcial: String(l.periodo) === mesCorrente,
  }));

  const apolices = Number(t?.apolices ?? 0);
  const comPremio = Number(t?.com_premio ?? 0);
  const premioTotal = Number(t?.premio ?? 0);
  const competencias = comissaoCompetencia.map((l) => String(l.periodo));

  const tipos = porTipoNegocio.map((l) => ({
    rotulo: l.rotulo === 'novo' ? 'Novo' : 'Renovação',
    apolices: Number(l.apolices ?? 0),
    premio: Number(l.premio ?? 0),
  }));
  const apolicesClassificadas = tipos.reduce((s, x) => s + x.apolices, 0);
  const renovadasNaJanela = tipos.find((x) => x.rotulo === 'Renovação')?.apolices ?? 0;
  const apolicesNaJanela = serie.reduce((s, m) => s + m.apolices, 0);
  // Só vale com a classificação COBRINDO a janela; com um tipo só daria 100% ou 0%.
  const classificacaoCobre =
    tipos.some((x) => x.rotulo === 'Novo') &&
    renovadasNaJanela > 0 &&
    apolicesClassificadas >= apolicesNaJanela * COBERTURA_MINIMA_DE_DATA;

  const comissaoTotal = Number(com?.total ?? 0);
  const premioBaseComissao = Number(com?.premio_base ?? 0);

  return {
    producao: {
      apolices,
      comPremio,
      premioTotal,
      // Divide pelas que TÊM prêmio: ausência de dado não é venda menor.
      ticketMedio: comPremio > 0 ? premioTotal / comPremio : null,
      movimentos: movimentos.map((l) => ({
        rotulo: String(l.rotulo),
        valor: Number(l.valor ?? 0),
      })),

      janelaMeses: JANELA_MESES,
      porMes: serie,
      foraDaJanela: {
        apolices: Number(fora?.apolices ?? 0),
        meses: Number(fora?.meses ?? 0),
        premio: Number(fora?.premio ?? 0),
      },

      porSeguradora: fatia(porSeguradora),
      porProduto: fatia(porProduto),
      porRamo: fatia(porRamo),
      porVendedor: fatia(porVendedor),
      porCanal: fatia(porCanal),
      porTipoNegocio: tipos,
    },

    renovacoes: {
      total: Number(r?.a_renovar ?? 0),
      em30: Number(r?.em30 ?? 0),
      em60: Number(r?.em60 ?? 0),
      em90: Number(r?.em90 ?? 0),
      premioEmRisco: Number(r?.premio_risco ?? 0),
      premioEm90: Number(r?.premio_em90 ?? 0),
      jaRenovadas: Number(r?.ja_renovadas ?? 0),
      canceladas: Number(r?.canceladas ?? 0),
      proporcaoRenovacao: classificacaoCobre ? renovadasNaJanela / apolicesClassificadas : null,
      classificacaoTipoNegocio: { classificadas: apolicesClassificadas, naJanela: apolicesNaJanela },
      porMes: vencimentosPorMes.map((l) => ({
        periodo: String(l.periodo),
        seguradora: String(l.seguradora),
        apolices: Number(l.apolices ?? 0),
        premio: Number(l.premio ?? 0),
      })),
      proximas: proximas.map((l) => ({
        numero: String(l.numero),
        segurado: String(l.nome_segurado ?? ''),
        seguradora: String(l.seguradora),
        produto: l.produto === null ? null : String(l.produto),
        vigenciaFim: l.vigencia_fim === null ? null : String(l.vigencia_fim).slice(0, 10),
        premio: l.premio_total === null ? null : Number(l.premio_total),
        diasParaVencer: Number(l.dias ?? 0),
        clienteUuid: l.cliente_uuid === null ? null : String(l.cliente_uuid),
        corretor: l.corretor === null ? null : String(l.corretor),
        telefone: l.telefone === null ? null : String(l.telefone),
        email: l.email === null ? null : String(l.email),
      })),
      semContato: proximas.filter((l) => !l.telefone && !l.email).length,
    },

    comissaoCarteira: {
      apolices: Number(com?.apolices ?? 0),
      total: comissaoTotal,
      percentualMedio:
        premioBaseComissao > 0 ? (comissaoTotal / premioBaseComissao) * 100 : null,
      porMes: comissaoApoliceMes.map((l) => ({
        periodo: String(l.periodo),
        valor: Number(l.valor ?? 0),
      })),
      porSeguradora: fatia(comissaoApoliceSeguradora),
      porVendedor: fatia(comissaoApoliceVendedor),
      porRamo: fatia(comissaoApoliceRamo),
    },

    receita: {
      competencias,
      bruto: Number(comissaoTotais[0]?.bruto ?? 0),
      impostos: Number(comissaoTotais[0]?.impostos ?? 0),
      liquido: Number(comissaoTotais[0]?.liquido ?? 0),
      porFilial: fatia(comissaoFilial),
      porCompetencia: comissaoCompetencia.map((l) => ({
        periodo: String(l.periodo),
        valor: Number(l.valor ?? 0),
      })),
      porSeguradora: fatia(comissaoSeguradora),
      porTipo: fatia(comissaoTipo),
      porCompetenciaTipo: comissaoTipoMes.map((l) => ({
        periodo: String(l.periodo),
        rotulo: String(l.rotulo),
        valor: Number(l.valor ?? 0),
      })),
      fechamento: comissaoFechamento.map((l) => ({
        competencia: String(l.periodo),
        ordens: Number(l.ordens ?? 0),
        primeiro: l.primeiro === null ? null : String(l.primeiro),
        ultimo: l.ultimo === null ? null : String(l.ultimo),
        bruto: Number(l.bruto ?? 0),
        impostos: Number(l.impostos ?? 0),
        liquido: Number(l.liquido ?? 0),
      })),
    },

    // Os grupos separados; `carteira` abaixo é a soma de todos.
    carteiras: porCarteira,
    // Fora do array de consultas acima, de propósito: ele é posicional.
    grupos: await grupoRepo.listarParaPaineis(),

    carteira: {
      total: resumoCarteira.total,
      ativos: resumoCarteira.ativos,
      comApoliceVigente: resumoCarteira.comApoliceVigente,
      semApoliceConhecida: resumoCarteira.semApoliceConhecida,
      inativos: resumoCarteira.inativos,
      prospectos: resumoCarteira.prospectos,
      inadimplentes: resumoCarteira.inadimplentes,
      novosNoAno: resumoCarteira.novosNoAno,
      perdidosNoAno: resumoCarteira.perdidosNoAno,
    },
    movimento,

    clientes: {
      porApolices: apolicesPorCliente.map((l) => ({
        apolices: Number(l.apolices ?? 0),
        clientes: Number(l.clientes ?? 0),
      })),
      crossSell: crossSell.map((l) => ({
        ramo: String(l.ramo),
        clientes: Number(l.clientes ?? 0),
        exclusivos: Number(l.exclusivos ?? 0),
      })),
    },

    sinistroPorRamo: fatia(sinistroPorRamo).map((f, i) => ({
      ...f,
      assistencias: Number(sinistroPorRamo[i]?.assistencias ?? 0),
    })),
    ramosPorCliente: fatia(ramosCliente),
    seguradorasPorCliente: fatia(seguradorasCliente),

    disponivel: {
      carteira: resumoCarteira.total > 0,
      clientesSemApoliceImportada: resumoCarteira.semApoliceConhecida > 0,
      saidasDeClientes: resumoCarteira.perdidosNoAno > 0 || resumoCarteira.inativos > 0,
      // A data de entrada precisa cobrir quase toda a carteira, senão a série mente.
      movimentoDeClientes:
        resumoCarteira.total > 0 &&
        resumoCarteira.comDataDeEntrada >= resumoCarteira.total * COBERTURA_MINIMA_DE_DATA &&
        movimento.some((m) => m.novos > 0 || m.perdidos > 0),
      producao: apolices > 0,
      premio: comPremio > 0,
      medirEmApolices: apolices > 0 && comPremio === 0,
      serieProducao: serie.filter((m) => m.premio > 0).length >= MESES_MINIMOS_PARA_SERIE,
      serieApolices: serie.filter((m) => m.apolices > 0).length >= MESES_MINIMOS_PARA_SERIE,
      serieRecortada: Number(fora?.apolices ?? 0) > 0,
      producaoPorSeguradora: Number(t?.seguradoras ?? 0) > 1,
      apolicesPorRamo: porRamo.length > 0,
      // Ter ramo não é ter prêmio por ramo: sem prêmio a barra sairia zerada.
      premioPorRamo: porRamo.length > 0 && comPremio > 0,
      ramoPorCliente: ramosCliente.length > 0,
      renovacoes: Number(r?.a_renovar ?? 0) > 0,
      historicoRenovacao: Number(r?.ja_renovadas ?? 0) > 0 || Number(r?.canceladas ?? 0) > 0,
      tipoNegocio: Number(t?.com_tipo ?? 0) > 0,
      receita: competencias.length > 0,
      serieReceita: competencias.length >= MESES_MINIMOS_PARA_SERIE,
      // Uma filial só não é distribuição.
      receitaPorFilial: comissaoFilial.length > 1,
      comissaoPorApolice: Number(com?.apolices ?? 0) > 0,
      frequenciaDeContratacao: apolicesPorCliente.some((l) => Number(l.apolices) > 1),
      crossSell: crossSell.some((l) => Number(l.clientes) > Number(l.exclusivos)),
      producaoPorVendedor: Number(t?.com_vendedor ?? 0) > 0 && porVendedor.length > 0,
      producaoPorCanal: porCanal.length > 0,
      frequenciaDeSinistro: sinistroPorRamo.length > 0,

      // Dependem de origem que não existe: proposta, meta, filial por apólice, veículo.
      propostas: false,
      metas: false,
      producaoPorFilial: false,
      // Só há o S/N de sinistro, não o valor pago: sinistralidade não se calcula.
      sinistros: false,
      veiculos: false,
      // Previsão pede mais de um ciclo; fora da janela é resíduo de vigência.
      previsoes: false,
    },
  };
}
