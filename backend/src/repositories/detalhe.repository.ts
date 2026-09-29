import type { RowDataPacket } from 'mysql2/promise';

import { pool } from '../database/pool.js';
import { condicaoDeCarteira, ESCOPO_TOTAL, type Escopo } from '../utils/escopo.js';
import { CLIENTE_SEM_APOLICE_EM_VIGOR, clienteCancelouEntre } from '../utils/cancelamento.js';
import { condicaoEmVigor, condicaoSituacaoAtiva } from '../utils/vigencia.js';

// As duas pontas do valor `AAAA-MM:AAAA-MM` das dimensões de cancelamento.
const CANCELADO_DE = "SUBSTRING_INDEX(?, ':', 1)";
const CANCELADO_ATE = "SUBSTRING_INDEX(?, ':', -1)";

/**
 * O que está por trás de cada número dos painéis. A dimensão é uma CHAVE
 * (condição constante aqui, valor por `?`) e toda consulta aplica `condicaoDeCarteira`.
 * `BIN_TO_UUID(x, 1)`: sem a flag o uuid parece válido e só falha na tela.
 */

/** As dimensões que os painéis sabem detalhar. */
export type Dimensao =
  | 'seguradora'
  | 'ramo'
  | 'produto'
  | 'vendedor'
  | 'canal'
  | 'tipoNegocio'
  | 'celula'
  | 'mes'
  | 'semPremio'
  | 'comSinistro'
  | 'sinistroRamo'
  | 'assistenciaRamo'
  | 'provisoria'
  | 'vencimento'
  | 'vencimentoMes'
  | 'aRenovar'
  | 'todasApolices'
  | 'situacaoCliente'
  | 'entradaMes'
  | 'crossSellRamo'
  | 'quantidadeApolices'
  | 'carteiraDoVendedor'
  | 'situacaoPorNome'
  | 'uf'
  | 'tipoPessoa'
  | 'faixaRenda'
  | 'seguradoraDoCliente'
  | 'cancelados'
  | 'canceladosPerdidos';

export interface FiltroDetalhe {
  dimensao: Dimensao;
  /** O rótulo clicado. Para `mes` é `AAAA-MM`; para `vencimento`, os dias. */
  valor: string;
  /** Recorte adicional de mês, quando a dimensão já é outra. */
  periodo?: string;
  /** Limita aos 12 meses da janela dos gráficos. */
  naJanela?: boolean;
}

export interface ItemApolice {
  uuid: string;
  numero: string;
  numeroProposta: string | null;
  provisoria: boolean;
  seguradora: string;
  produto: string | null;
  ramo: string | null;
  segurado: string;
  documento: string | null;
  clienteUuid: string | null;
  vendedor: string | null;
  canal: string | null;
  vigenciaInicio: string | null;
  vigenciaFim: string | null;
  premio: number | null;
  comissao: number | null;
  tipoNegocio: string | null;
  possuiSinistro: boolean | null;
}

export interface ItemCliente {
  uuid: string;
  nome: string;
  documento: string | null;
  situacao: string;
  corretor: string | null;
  telefone: string | null;
  email: string | null;
  apolices: number;
  premio: number;
  comissao: number;
}

export type ResultadoDetalhe =
  | { tipo: 'apolices'; total: number; mostrando: number; itens: ItemApolice[] }
  | { tipo: 'clientes'; total: number; mostrando: number; itens: ItemCliente[] };

/** Teto da lista; o total real vem junto para a tela dizer "300 de N". */
const MAXIMO = 300;

/** Cada dimensão e sua condição; `alvo` decide se a resposta é de apólices ou de clientes. */
const DIMENSOES: Record<Dimensao, { condicao: string | null; alvo: 'apolices' | 'clientes' }> = {
  seguradora: { condicao: 's.nome = ?', alvo: 'apolices' },
  ramo: { condicao: 'r.nome = ?', alvo: 'apolices' },
  produto: { condicao: 'p.nome = ?', alvo: 'apolices' },
  vendedor: { condicao: 'vend.nome = ?', alvo: 'apolices' },
  canal: { condicao: 'cn.nome = ?', alvo: 'apolices' },
  tipoNegocio: { condicao: 'a.tipo_negocio = ?', alvo: 'apolices' },
  celula: { condicao: 'a.celula = ?', alvo: 'apolices' },
  mes: { condicao: "DATE_FORMAT(a.vigencia_inicio, '%Y-%m') = ?", alvo: 'apolices' },

  // Os três abaixo ignoram o valor: a própria dimensão já é a pergunta.
  semPremio: { condicao: 'a.premio_total IS NULL', alvo: 'apolices' },
  comSinistro: { condicao: 'a.possui_sinistro = 1', alvo: 'apolices' },
// As apólices COM sinistro de um ramo: o numerador da frequência.
  sinistroRamo: { condicao: 'a.possui_sinistro = 1 AND r.nome = ?', alvo: 'apolices' },
// As que acionaram ASSISTÊNCIA, contadas à parte do sinistro, como no painel.
  assistenciaRamo: {
    condicao:
      "EXISTS (SELECT 1 FROM sinistros s WHERE s.apolice_id = a.id AND s.tipo = 'assistencia') AND r.nome = ?",
    alvo: 'apolices',
  },
  provisoria: { condicao: 'a.numero_provisorio = 1', alvo: 'apolices' },
  todasApolices: { condicao: null, alvo: 'apolices' },

  // Os dias entram por `?`, nunca montando `INTERVAL ${dias} DAY` (injeção).
  vencimento: {
    condicao:
      `${condicaoSituacaoAtiva('a')} AND a.vigencia_fim BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL ? DAY)`,
    alvo: 'apolices',
  },

  // Mesma condição da agregação do painel, para o total da gaveta bater com a coluna.
  vencimentoMes: {
    condicao: `${condicaoEmVigor('a')} AND DATE_FORMAT(a.vigencia_fim, '%Y-%m') = ?`,
    alvo: 'apolices',
  },

  // Sem teto em dias: vida e VGBL têm vigência de décadas.
  aRenovar: {
    condicao: condicaoEmVigor('a'),
    alvo: 'apolices',
  },

  // O que `resumoCarteira` conta: a gaveta tem de bater com o cartão.
  situacaoCliente: { condicao: 'sit.chave = ?', alvo: 'clientes' },
  // Quem ENTROU no mês, pela mesma condição de `clientesPorCarteira`.
  entradaMes: {
    condicao: "DATE_FORMAT(c.cliente_desde, '%Y-%m') = ?",
    alvo: 'clientes',
  },
  crossSellRamo: { condicao: 'r.nome = ?', alvo: 'clientes' },
  quantidadeApolices: { condicao: null, alvo: 'clientes' },
  carteiraDoVendedor: { condicao: 'prod.nome = ?', alvo: 'clientes' },

  // Espelham exatamente as agregações de `distribuicoesDeClientes`, para a gaveta bater.
  situacaoPorNome: { condicao: 'sit.nome = ?', alvo: 'clientes' },
  uf: {
    condicao: `EXISTS (SELECT 1 FROM enderecos e
                         JOIN municipios mu ON mu.id = e.municipio_id
                        WHERE e.cliente_id = c.id AND e.tipo = 'principal' AND mu.uf = ?)`,
    alvo: 'clientes',
  },
  tipoPessoa: { condicao: "CASE c.tipo_pessoa WHEN 'J' THEN 'Jurídica' ELSE 'Física' END = ?", alvo: 'clientes' },
  faixaRenda: {
    condicao: 'EXISTS (SELECT 1 FROM faixas_renda f WHERE f.id = c.faixa_renda_id AND f.descricao = ?)',
    alvo: 'clientes',
  },
  seguradoraDoCliente: {
    condicao: `EXISTS (SELECT 1 FROM seguradoras_clientes sc
                         JOIN seguradoras sg ON sg.id = sc.seguradora_id
                        WHERE sc.cliente_id = c.id AND sg.nome = ?)`,
    alvo: 'clientes',
  },

  // Valor `AAAA-MM:AAAA-MM` entra DUAS vezes por `?`; mesmas condições de `cancelamento.repository`.
  cancelados: {
    condicao: clienteCancelouEntre(CANCELADO_DE, CANCELADO_ATE),
    alvo: 'clientes',
  },
  canceladosPerdidos: {
    condicao: `${clienteCancelouEntre(CANCELADO_DE, CANCELADO_ATE)} AND ${CLIENTE_SEM_APOLICE_EM_VIGOR}`,
    alvo: 'clientes',
  },
};

/** Junta partes num WHERE, descartando as vazias. */
function onde(...partes: (string | null | undefined)[]): string {
  const validas = partes.filter((p): p is string => Boolean(p));
  return validas.length > 0 ? `WHERE ${validas.join(' AND ')}` : '';
}

export async function detalhar(
  filtro: FiltroDetalhe,
  escopo: Escopo = ESCOPO_TOTAL,
): Promise<ResultadoDetalhe> {
  const dimensao = DIMENSOES[filtro.dimensao];
  if (!dimensao) throw new Error(`Dimensão desconhecida: ${filtro.dimensao}`);

  return dimensao.alvo === 'apolices'
    ? detalharApolices(filtro, dimensao.condicao, escopo)
    : detalharClientes(filtro, dimensao.condicao, escopo);
}

/** Primeiro dia do mês que abre a janela — a mesma do painel. */
const INICIO_JANELA = "DATE_FORMAT(DATE_SUB(CURDATE(), INTERVAL 11 MONTH), '%Y-%m-01')";

async function detalharApolices(
  filtro: FiltroDetalhe,
  condicao: string | null,
  escopo: Escopo,
): Promise<ResultadoDetalhe> {
  const carteira = condicaoDeCarteira(escopo, 'c.produtor_id');

  // A ordem dos valores segue a ordem das condições no WHERE.
  const valores: unknown[] = [];
  if (condicao?.includes('?')) valores.push(filtro.valor);
  if (filtro.periodo) valores.push(filtro.periodo);
  valores.push(...carteira.valores);

  const juncoes = `
    JOIN seguradoras s ON s.id = a.seguradora_id
    LEFT JOIN produtos p ON p.id = a.produto_id
    LEFT JOIN ramos r ON r.id = p.ramo_id
    LEFT JOIN clientes c ON c.id = a.cliente_id
    LEFT JOIN produtores vend ON vend.id = a.produtor_id
    LEFT JOIN canais_producao cn ON cn.id = a.canal_id`;

  const filtros = onde(
    condicao,
    filtro.periodo ? "DATE_FORMAT(a.vigencia_inicio, '%Y-%m') = ?" : null,
    filtro.naJanela ? `a.vigencia_inicio >= ${INICIO_JANELA}` : null,
    carteira.condicao,
  );

  const [contagem] = await pool.query<RowDataPacket[]>(
    `SELECT COUNT(*) AS total FROM apolices a ${juncoes} ${filtros}`,
    valores,
  );

  const [linhas] = await pool.query<RowDataPacket[]>(
    `SELECT BIN_TO_UUID(a.uuid, 1) AS uuid, a.numero, a.numero_proposta, a.numero_provisorio,
            s.nome AS seguradora, p.nome AS produto, r.nome AS ramo,
            a.nome_segurado, a.documento_segurado, BIN_TO_UUID(c.uuid, 1) AS cliente_uuid,
            vend.nome AS vendedor, cn.nome AS canal,
            a.vigencia_inicio, a.vigencia_fim, a.premio_total, a.comissao,
            a.tipo_negocio, a.possui_sinistro
       FROM apolices a ${juncoes} ${filtros}
      ORDER BY a.premio_total DESC, a.vigencia_inicio DESC
      LIMIT ${MAXIMO}`,
    valores,
  );

  return {
    tipo: 'apolices',
    total: Number(contagem[0]?.total ?? 0),
    mostrando: linhas.length,
    itens: linhas.map((l) => ({
      uuid: String(l.uuid),
      numero: String(l.numero),
      numeroProposta: l.numero_proposta === null ? null : String(l.numero_proposta),
      provisoria: l.numero_provisorio === 1,
      seguradora: String(l.seguradora),
      produto: l.produto === null ? null : String(l.produto),
      ramo: l.ramo === null ? null : String(l.ramo),
      segurado: String(l.nome_segurado ?? ''),
      documento: l.documento_segurado === null ? null : String(l.documento_segurado),
      clienteUuid: l.cliente_uuid === null ? null : String(l.cliente_uuid),
      vendedor: l.vendedor === null ? null : String(l.vendedor),
      canal: l.canal === null ? null : String(l.canal),
      vigenciaInicio: l.vigencia_inicio === null ? null : String(l.vigencia_inicio).slice(0, 10),
      vigenciaFim: l.vigencia_fim === null ? null : String(l.vigencia_fim).slice(0, 10),
      premio: l.premio_total === null ? null : Number(l.premio_total),
      comissao: l.comissao === null ? null : Number(l.comissao),
      tipoNegocio: l.tipo_negocio === null ? null : String(l.tipo_negocio),
      possuiSinistro: l.possui_sinistro === null ? null : l.possui_sinistro === 1,
    })),
  };
}

async function detalharClientes(
  filtro: FiltroDetalhe,
  condicao: string | null,
  escopo: Escopo,
): Promise<ResultadoDetalhe> {
  const carteira = condicaoDeCarteira(escopo, 'c.produtor_id');

  // Cross-sell e frequência são sobre o CONJUNTO de apólices do cliente: vão no HAVING.
  const soEsseRamo = filtro.dimensao === 'crossSellRamo';
  const porQuantidade = filtro.dimensao === 'quantidadeApolices';

  // O valor da dimensão, uma vez por placeholder (os cancelamentos usam dois).
  const valores: unknown[] = [];
  for (let n = (condicao ?? '').split('?').length - 1; n > 0; n--) valores.push(filtro.valor);
  valores.push(...carteira.valores);

  const tendo: string[] = [];
  if (soEsseRamo) {
    // Clientes daquele ramo que não têm nenhum outro: é onde o cross-sell mora.
    tendo.push('COUNT(DISTINCT p.ramo_id) = 1');
  }
  if (porQuantidade) {
    tendo.push('COUNT(DISTINCT a.id) = ?');
  }

  const juncoes = `
    LEFT JOIN apolices a ON a.cliente_id = c.id
    LEFT JOIN produtos p ON p.id = a.produto_id
    LEFT JOIN ramos r ON r.id = p.ramo_id
    LEFT JOIN situacoes_cliente sit ON sit.id = c.situacao_id
    LEFT JOIN produtores prod ON prod.id = c.produtor_id`;

  // Subconsulta, não WHERE: o HAVING precisa contar TODOS os ramos do cliente.
  const filtroRamo = soEsseRamo
    ? `EXISTS (SELECT 1 FROM apolices a2
                 JOIN produtos p2 ON p2.id = a2.produto_id
                 JOIN ramos r2 ON r2.id = p2.ramo_id
                WHERE a2.cliente_id = c.id AND r2.nome = ?)`
    : null;

  const filtros = onde(soEsseRamo ? filtroRamo : condicao, carteira.condicao);
  if (porQuantidade) valores.push(Number(filtro.valor));

  const having = tendo.length > 0 ? `HAVING ${tendo.join(' AND ')}` : '';

  const base = `
      FROM clientes c ${juncoes}
     ${filtros}
     GROUP BY c.id
     ${having}`;

  const [contagem] = await pool.query<RowDataPacket[]>(
    `SELECT COUNT(*) AS total FROM (SELECT c.id ${base}) x`,
    valores,
  );

  // SUM simples: as junções são N:1, e DISTINCT somaria uma vez só valores iguais.
  const [linhas] = await pool.query<RowDataPacket[]>(
    `SELECT BIN_TO_UUID(c.uuid, 1) AS uuid, c.nome, c.cpf_cnpj, sit.chave AS situacao,
            prod.nome AS corretor,
            (SELECT t.completo FROM telefones t
              WHERE t.cliente_id = c.id ORDER BY t.principal DESC, t.id LIMIT 1) AS telefone,
            (SELECT e.endereco FROM emails e
              WHERE e.cliente_id = c.id ORDER BY e.principal DESC, e.id LIMIT 1) AS email,
            COUNT(DISTINCT a.id) AS apolices,
            COALESCE(SUM(a.premio_total), 0) AS premio,
            COALESCE(SUM(a.comissao), 0) AS comissao
       ${base}
      ORDER BY premio DESC, c.nome
      LIMIT ${MAXIMO}`,
    valores,
  );

  return {
    tipo: 'clientes',
    total: Number(contagem[0]?.total ?? 0),
    mostrando: linhas.length,
    itens: linhas.map((l) => ({
      uuid: String(l.uuid),
      nome: String(l.nome ?? ''),
      documento: l.cpf_cnpj === null ? null : String(l.cpf_cnpj),
      situacao: String(l.situacao ?? ''),
      corretor: l.corretor === null ? null : String(l.corretor),
      telefone: l.telefone === null ? null : String(l.telefone),
      email: l.email === null ? null : String(l.email),
      apolices: Number(l.apolices ?? 0),
      premio: Number(l.premio ?? 0),
      comissao: Number(l.comissao ?? 0),
    })),
  };
}
