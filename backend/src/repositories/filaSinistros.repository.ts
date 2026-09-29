import type { RowDataPacket } from 'mysql2/promise';

import { pool } from '../database/pool.js';
import { condicaoDeCarteira, type Escopo } from '../utils/escopo.js';
import { condicaoEmVigor } from '../utils/vigencia.js';

/**
 * Fila de sinistros e números do dashboard: `SITUACAO_SQL` e `recorte` servem às
 * duas consultas, para o número clicado ser o total da lista. Sinistro sem
 * cliente só aparece para `clientes.todos` (`NULL IN (...)` é falso).
 */

/**
 * Situação derivada dos DOIS status: o movimento manda (a Suhai deixa o processo
 * "Em análise" por um ano); "Recusado" vem do processo, porque o movimento diz "Liquidado".
 */
const SITUACAO_SQL = `CASE
    WHEN s.status_processo = 'Recusado' THEN 'recusado'
    WHEN s.status_movimento = 'Pendente' THEN 'em_analise'
    WHEN s.status_movimento IS NULL AND s.status_processo = 'Em análise' THEN 'em_analise'
    ELSE 'encerrado'
  END`;

/** A causa que o painel agrupa e a fila filtra (a mesma expressão nos dois); sem causa, a cobertura. */
const CAUSA_SQL = `COALESCE(NULLIF(TRIM(s.causa), ''), NULLIF(TRIM(s.cobertura), ''), 'Não informada')`;

export type SituacaoAcionamento = 'em_analise' | 'recusado' | 'encerrado';
export type TipoAcionamento = 'sinistro' | 'assistencia';

export interface FiltrosSinistro {
  tipo?: TipoAcionamento;
  situacao?: SituacaoAcionamento;
  /** Nome da seguradora, como o cadastro grafa. */
  seguradora?: string;
  /** `AAAA-MM` da ocorrência. */
  mes?: string;
  /** Causa como o painel agrupa (`CAUSA_SQL`). */
  causa?: string;
}

/** Teto da lista: a fila pagina na tela, mas não sem limite no servidor. */
const LIMITE_LISTA = 2000;

function recorte(escopo: Escopo): { condicao: string | null; valores: number[] } {
  return condicaoDeCarteira(escopo, 'c.produtor_id');
}

function onde(...partes: (string | null | undefined)[]): string {
  const validas = partes.filter((p): p is string => Boolean(p));
  return validas.length > 0 ? `WHERE ${validas.join(' AND ')}` : '';
}

export async function listar(escopo: Escopo, filtros: FiltrosSinistro): Promise<RowDataPacket[]> {
  const carteira = recorte(escopo);
  const condicoes: string[] = [];
  const valores: unknown[] = [...carteira.valores];

  if (carteira.condicao) condicoes.push(carteira.condicao);
  if (filtros.tipo) {
    condicoes.push('s.tipo = ?');
    valores.push(filtros.tipo);
  }
  if (filtros.situacao) {
    condicoes.push(`${SITUACAO_SQL} = ?`);
    valores.push(filtros.situacao);
  }
  if (filtros.seguradora) {
    condicoes.push('sg.nome = ?');
    valores.push(filtros.seguradora);
  }
  if (filtros.mes) {
    condicoes.push("DATE_FORMAT(s.ocorrido_em, '%Y-%m') = ?");
    valores.push(filtros.mes);
  }
  if (filtros.causa) {
    condicoes.push(`${CAUSA_SQL} = ?`);
    valores.push(filtros.causa);
  }
  valores.push(LIMITE_LISTA);

  // Sinistro antes de assistência, aberto antes de fechado, depois o mais recente.
  const [linhas] = await pool.query<RowDataPacket[]>(
    `SELECT s.id, s.numero, s.numero_apolice, s.tipo, s.ramo, s.cobertura, s.causa,
            s.ocorrido_em, s.comunicado_em, s.status_processo, s.status_movimento,
            ${SITUACAO_SQL} AS situacao,
            s.reserva, s.placa, s.veiculo, s.nome_sinistrado, s.vinculo_origem,
            sg.nome AS seguradora,
            BIN_TO_UUID(c.uuid, 1) AS cliente_uuid, c.nome AS cliente_nome,
            a.numero AS apolice_numero
       FROM sinistros s
       JOIN seguradoras sg ON sg.id = s.seguradora_id
       LEFT JOIN clientes c ON c.id = s.cliente_id
       LEFT JOIN apolices a ON a.id = s.apolice_id
      ${onde(...condicoes)}
      ORDER BY s.tipo = 'sinistro' DESC,
               ${SITUACAO_SQL} = 'em_analise' DESC,
               s.ocorrido_em IS NULL, s.ocorrido_em DESC, s.id DESC
      LIMIT ?`,
    valores,
  );
  return linhas;
}

/** Opções dos filtros: o que existe dentro do recorte, sem os outros filtros. */
export async function opcoesDeFiltro(
  escopo: Escopo,
): Promise<{ seguradoras: string[]; meses: string[] }> {
  const carteira = recorte(escopo);
  const [linhas] = await pool.query<RowDataPacket[]>(
    `SELECT DISTINCT sg.nome AS seguradora, DATE_FORMAT(s.ocorrido_em, '%Y-%m') AS mes
       FROM sinistros s
       JOIN seguradoras sg ON sg.id = s.seguradora_id
       LEFT JOIN clientes c ON c.id = s.cliente_id
      ${onde(carteira.condicao)}`,
    carteira.valores,
  );
  return {
    seguradoras: [...new Set(linhas.map((l) => String(l.seguradora)))].sort((a, b) =>
      a.localeCompare(b, 'pt-BR'),
    ),
    meses: [...new Set(linhas.map((l) => l.mes).filter((m): m is string => Boolean(m)))].sort((a, b) =>
      b.localeCompare(a),
    ),
  };
}

/**
 * Os números do dashboard. Cada um corresponde a um filtro da lista:
 * `sinistros`/`assistencias` = `?tipo=`, `emAnalise` = `?tipo=&status=em_analise`.
 */
export async function resumo(escopo: Escopo): Promise<{
  acionamentos: RowDataPacket[];
  porMes: RowDataPacket[];
  frequencia: RowDataPacket;
  tipos: RowDataPacket[];
}> {
  const carteira = recorte(escopo);

  const [acionamentos] = await pool.query<RowDataPacket[]>(
    `SELECT s.tipo, ${SITUACAO_SQL} AS situacao, COUNT(*) AS quantidade,
            COALESCE(SUM(s.reserva), 0) AS reserva
       FROM sinistros s
       LEFT JOIN clientes c ON c.id = s.cliente_id
      ${onde(carteira.condicao)}
      GROUP BY s.tipo, situacao`,
    carteira.valores,
  );

  // 12 meses de ocorrência; a tela completa os meses vazios com zero.
  const [porMes] = await pool.query<RowDataPacket[]>(
    `SELECT DATE_FORMAT(s.ocorrido_em, '%Y-%m') AS periodo, s.tipo, COUNT(*) AS quantidade
       FROM sinistros s
       LEFT JOIN clientes c ON c.id = s.cliente_id
      ${onde(
        's.ocorrido_em >= DATE_SUB(DATE_FORMAT(CURDATE(), \'%Y-%m-01\'), INTERVAL 11 MONTH)',
        carteira.condicao,
      )}
      GROUP BY periodo, s.tipo
      ORDER BY periodo`,
    carteira.valores,
  );

  // Frequência = apólices com SINISTRO ÷ COBERTAS (mesmo denominador do painel);
  // assistência conta à parte. Sem recorte por ramo: o Bradesco não tem ramo.
  const [[frequencia]] = await pool.query<RowDataPacket[]>(
    `SELECT COUNT(*) AS cobertas,
            COALESCE(SUM(a.possui_sinistro = 1), 0) AS com_sinistro,
            COALESCE(SUM(EXISTS (SELECT 1 FROM sinistros s2
                                  WHERE s2.apolice_id = a.id AND s2.tipo = 'assistencia')), 0)
              AS com_assistencia
       FROM apolices a
       JOIN clientes c ON c.id = a.cliente_id
      ${onde(
        `(a.possui_sinistro IS NOT NULL
          OR EXISTS (SELECT 1 FROM sinistros s WHERE s.seguradora_id = a.seguradora_id))`,
        carteira.condicao,
      )}`,
    carteira.valores,
  );

  // Por TIPO, não por ramo (o Bradesco não escreve ramo); tipo da apólice, senão o do produto.
  const [tipos] = await pool.query<RowDataPacket[]>(
    `SELECT COALESCE(t.nome, 'Sem tipo') AS tipo,
            COUNT(*) AS apolices,
            COALESCE(SUM(${condicaoEmVigor('a')}), 0) AS em_vigor,
            COALESCE(SUM(CASE WHEN ${condicaoEmVigor('a')} THEN a.premio_total END), 0) AS premio_em_vigor,
            COALESCE(SUM(CASE WHEN ${condicaoEmVigor('a')} AND a.premio_total IS NOT NULL THEN 1 END), 0)
              AS com_premio
       FROM apolices a
       JOIN clientes c ON c.id = a.cliente_id
       LEFT JOIN produtos p ON p.id = a.produto_id
       LEFT JOIN tipos_seguro t ON t.id = COALESCE(a.tipo_seguro_id, p.tipo_seguro_id)
      ${onde(carteira.condicao)}
      GROUP BY t.id, t.nome
      ORDER BY em_vigor DESC, apolices DESC`,
    carteira.valores,
  );

  return { acionamentos, porMes, frequencia: frequencia ?? ({} as RowDataPacket), tipos };
}

/** O que o dashboard de Sinistros acrescenta ao resumo, com o mesmo recorte e situação da lista. */
export async function resumoDaEquipe(escopo: Escopo): Promise<{
  porSeguradora: RowDataPacket[];
  porCausa: RowDataPacket[];
  idadeDosAbertos: RowDataPacket[];
  cobertura: RowDataPacket[];
  semCliente: number;
}> {
  const carteira = recorte(escopo);

  const [porSeguradora] = await pool.query<RowDataPacket[]>(
    `SELECT sg.nome AS seguradora, s.tipo, ${SITUACAO_SQL} AS situacao,
            COUNT(*) AS quantidade, COALESCE(SUM(s.reserva), 0) AS reserva
       FROM sinistros s
       JOIN seguradoras sg ON sg.id = s.seguradora_id
       LEFT JOIN clientes c ON c.id = s.cliente_id
      ${onde(carteira.condicao)}
      GROUP BY sg.nome, s.tipo, situacao`,
    carteira.valores,
  );

  const [porCausa] = await pool.query<RowDataPacket[]>(
    // Subconsulta: `only_full_group_by` não aceita agrupar pelo apelido da expressão.
    `SELECT x.causa, x.tipo, COUNT(*) AS quantidade
       FROM (SELECT ${CAUSA_SQL} AS causa, s.tipo
               FROM sinistros s
               LEFT JOIN clientes c ON c.id = s.cliente_id
              ${onde(carteira.condicao)}) x
      GROUP BY x.causa, x.tipo
      ORDER BY quantidade DESC`,
    carteira.valores,
  );

  // Idade do que está EM ANÁLISE desde a comunicação (senão a ocorrência), em faixas.
  const [idadeDosAbertos] = await pool.query<RowDataPacket[]>(
    `SELECT x.tipo, x.faixa, COUNT(*) AS quantidade
       FROM (SELECT s.tipo,
                    CASE
                      WHEN COALESCE(s.comunicado_em, s.ocorrido_em) IS NULL THEN 'sem_data'
                      WHEN DATEDIFF(CURDATE(), COALESCE(s.comunicado_em, s.ocorrido_em)) <= 15 THEN 'ate15'
                      WHEN DATEDIFF(CURDATE(), COALESCE(s.comunicado_em, s.ocorrido_em)) <= 30 THEN 'ate30'
                      WHEN DATEDIFF(CURDATE(), COALESCE(s.comunicado_em, s.ocorrido_em)) <= 60 THEN 'ate60'
                      ELSE 'mais60'
                    END AS faixa
               FROM sinistros s
               LEFT JOIN clientes c ON c.id = s.cliente_id
              ${onde(`${SITUACAO_SQL} = 'em_analise'`, carteira.condicao)}) x
      GROUP BY x.tipo, x.faixa`,
    carteira.valores,
  );

  // Sem relatório de sinistros da companhia, "zero" é falta de dado; `com_marca` é o
  // S/N da origem, o único sinal das companhias sem relatório.
  const [cobertura] = await pool.query<RowDataPacket[]>(
    `SELECT sg.nome AS seguradora,
            COUNT(*) AS em_vigor,
            COALESCE(SUM(a.possui_sinistro = 1), 0) AS com_marca,
            EXISTS (SELECT 1 FROM sinistros s WHERE s.seguradora_id = sg.id) AS tem_relatorio
       FROM apolices a
       JOIN seguradoras sg ON sg.id = a.seguradora_id
       JOIN clientes c ON c.id = a.cliente_id
      ${onde(condicaoEmVigor('a'), carteira.condicao)}
      GROUP BY sg.id, sg.nome
      ORDER BY em_vigor DESC`,
    carteira.valores,
  );

  // Só quem vê a base inteira enxerga o acionamento sem cliente.
  const [semCliente] = await pool.query<RowDataPacket[]>(
    `SELECT COUNT(*) AS n FROM sinistros s LEFT JOIN clientes c ON c.id = s.cliente_id
      ${onde('s.cliente_id IS NULL', carteira.condicao)}`,
    carteira.valores,
  );

  return { porSeguradora, porCausa, idadeDosAbertos, cobertura, semCliente: Number(semCliente[0]?.n ?? 0) };
}
