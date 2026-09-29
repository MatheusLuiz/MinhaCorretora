import type { RowDataPacket } from 'mysql2/promise';

import { pool } from '../database/pool.js';
import { condicaoDeCarteira, type Escopo } from '../utils/escopo.js';
import { condicaoEmVigor } from '../utils/vigencia.js';

/**
 * Fila de cadastro e resumo do dashboard de Clientes: as bandeiras de pendência
 * são calculadas UMA vez, em `BASE`, para o número clicado bater com a lista.
 */

/** Máscara LGPD pela POSIÇÃO do X (seguido de minúscula); caixa alta nunca casa, de propósito. */
const REGEX_MASCARA = "'(^|[^[:alpha:]])X{2,}[a-z]'";

/**
 * Uma linha por cliente, com as bandeiras (0/1). Endereço só conta com rua OU CEP;
 * telefone é o PRINCIPAL por subconsulta (JOIN por tipo duplicaria o cliente).
 */
function base(escopo: Escopo): { sql: string; valores: Array<string | number> } {
  const carteira = condicaoDeCarteira(escopo, 'c.produtor_id');
  const sql = `
    SELECT c.id,
           BIN_TO_UUID(c.uuid, 1) AS uuid,
           c.nome,
           c.cpf_cnpj,
           c.cpf_cnpj_numeros,
           c.tipo_pessoa,
           sit.chave AS situacao_chave,
           sit.nome  AS situacao,
           (SELECT t.completo FROM telefones t
             WHERE t.cliente_id = c.id
             ORDER BY t.principal DESC, t.id LIMIT 1) AS telefone,
           (SELECT e.endereco FROM emails e
             WHERE e.cliente_id = c.id
             ORDER BY e.principal DESC, e.id LIMIT 1) AS email,
           NOT EXISTS (SELECT 1 FROM telefones t WHERE t.cliente_id = c.id) AS sem_telefone,
           NOT EXISTS (SELECT 1 FROM emails e WHERE e.cliente_id = c.id) AS sem_email,
           NOT EXISTS (SELECT 1 FROM enderecos en
                        WHERE en.cliente_id = c.id
                          AND (en.logradouro IS NOT NULL OR en.cep IS NOT NULL)) AS sem_endereco,
           (c.data_nascimento IS NULL) AS sem_nascimento,
           (c.produtor_id IS NULL) AS sem_corretor,
           (c.nome COLLATE utf8mb4_bin REGEXP ${REGEX_MASCARA}) AS nome_mascarado,
           (sit.chave = 'inativo') AS inativo,
           (sit.chave = 'inadimplente') AS inadimplente,
           (SELECT COUNT(*) FROM apolices a
             WHERE a.cliente_id = c.id AND ${condicaoEmVigor('a')}) AS em_vigor,
           (SELECT MIN(a.vigencia_fim) FROM apolices a
             WHERE a.cliente_id = c.id AND ${condicaoEmVigor('a')}) AS proximo_vencimento,
           (SELECT GROUP_CONCAT(DISTINCT s.nome ORDER BY s.nome SEPARATOR ', ')
              FROM apolices a JOIN seguradoras s ON s.id = a.seguradora_id
             WHERE a.cliente_id = c.id) AS seguradoras
      FROM clientes c
      LEFT JOIN situacoes_cliente sit ON sit.id = c.situacao_id
     ${carteira.condicao ? `WHERE ${carteira.condicao}` : ''}`;
  return { sql, valores: carteira.valores };
}

/** Condição de cada pendência sobre a tabela derivada `f`. */
export const PENDENCIAS = {
  sem_contato: 'f.sem_telefone = 1 AND f.sem_email = 1',
  sem_telefone: 'f.sem_telefone = 1',
  sem_email: 'f.sem_email = 1',
  sem_endereco: 'f.sem_endereco = 1',
  sem_nascimento: 'f.sem_nascimento = 1',
  sem_corretor: 'f.sem_corretor = 1',
  nome_mascarado: 'f.nome_mascarado = 1',
  inativo: 'f.inativo = 1',
  inadimplente: 'f.inadimplente = 1',
} as const;

export type Pendencia = keyof typeof PENDENCIAS;

/** Situações que o filtro aceita — chaves de `situacoes_cliente`. */
export const SITUACOES = ['prospecto', 'ativo', 'inadimplente', 'inativo'] as const;
export type Situacao = (typeof SITUACOES)[number];

/** A fila só lista quem tem ALGUMA pendência. */
const ALGUMA_PENDENCIA = `(${Object.values(PENDENCIAS)
  .map((c) => `(${c})`)
  .join(' OR ')})`;

/** Teto da lista; constante no SQL sem placeholder (`LIMIT ?` no `execute` falha no MySQL 8). */
export const LIMITE_FILA = 2000;

export interface FiltroFila {
  pendencia?: Pendencia;
  situacao?: Situacao;
  /** Nome (ignora acento e caixa, pela collation) ou dígitos do CPF/CNPJ. */
  busca?: string;
}

/** As condições do filtro sobre `f` e os valores delas, na ordem. */
function condicoesDoFiltro(filtro: FiltroFila): { condicoes: string[]; params: Array<string | number> } {
  const condicoes = [ALGUMA_PENDENCIA];
  const params: Array<string | number> = [];

  if (filtro.pendencia) condicoes.push(PENDENCIAS[filtro.pendencia]);
  if (filtro.situacao) {
    condicoes.push('f.situacao_chave = ?');
    params.push(filtro.situacao);
  }
  if (filtro.busca) {
    // Só dígitos e pontuação de documento = CPF/CNPJ; qualquer letra = nome.
    const digitos = filtro.busca.replace(/\D/g, '');
    if (digitos.length >= 3 && /^[\d\s./-]+$/.test(filtro.busca)) {
      condicoes.push('f.cpf_cnpj_numeros LIKE ?');
      params.push(`%${digitos}%`);
    } else {
      condicoes.push('f.nome LIKE ?');
      params.push(`%${filtro.busca}%`);
    }
  }
  return { condicoes, params };
}

export async function listar(escopo: Escopo, filtro: FiltroFila): Promise<RowDataPacket[]> {
  const { sql, valores } = base(escopo);
  const { condicoes, params: doFiltro } = condicoesDoFiltro(filtro);
  const params = [...valores, ...doFiltro];

  // Ordem do que mais atrapalha: sem contato, cliente antes de inativo, mais pendências, vencimento mais próximo.
  const [linhas] = await pool.execute<RowDataPacket[]>(
    `SELECT f.* ,
            (f.sem_telefone + f.sem_email + f.sem_endereco + f.sem_nascimento
             + f.sem_corretor + f.nome_mascarado) AS pendencias_cadastro
       FROM (${sql}) f
      WHERE ${condicoes.join(' AND ')}
      ORDER BY (f.sem_telefone = 1 AND f.sem_email = 1) DESC,
               (f.situacao_chave = 'inativo') ASC,
               f.sem_telefone DESC,
               pendencias_cadastro DESC,
               f.proximo_vencimento IS NULL, f.proximo_vencimento,
               f.nome
      LIMIT ${LIMITE_FILA}`,
    params,
  );
  return linhas;
}

/** Total de clientes da fila com o filtro, sem o teto — para dizer "mostrando 2.000 de N". */
export async function contar(escopo: Escopo, filtro: FiltroFila): Promise<number> {
  const { sql, valores } = base(escopo);
  const { condicoes, params: doFiltro } = condicoesDoFiltro(filtro);
  const params = [...valores, ...doFiltro];
  const [[linha]] = await pool.execute<RowDataPacket[]>(
    `SELECT COUNT(*) AS n FROM (${sql}) f WHERE ${condicoes.join(' AND ')}`,
    params,
  );
  return Number(linha?.n ?? 0);
}

/** Os números do dashboard, com as MESMAS condições de `PENDENCIAS`: barra e fila batem por construção. */
export async function resumo(escopo: Escopo): Promise<RowDataPacket> {
  const { sql, valores } = base(escopo);
  const somas = Object.entries(PENDENCIAS)
    .map(([chave, cond]) => `SUM(CASE WHEN ${cond} THEN 1 ELSE 0 END) AS ${chave}`)
    .join(',\n           ');
  const [[linha]] = await pool.execute<RowDataPacket[]>(
    `SELECT COUNT(*) AS total,
            SUM(CASE WHEN ${ALGUMA_PENDENCIA} THEN 1 ELSE 0 END) AS na_fila,
            SUM(CASE WHEN f.situacao_chave = 'ativo' THEN 1 ELSE 0 END) AS ativos,
            SUM(CASE WHEN f.situacao_chave = 'inadimplente' THEN 1 ELSE 0 END) AS inadimplentes,
            SUM(CASE WHEN f.situacao_chave = 'inativo' THEN 1 ELSE 0 END) AS inativos,
            SUM(CASE WHEN f.situacao_chave = 'prospecto' THEN 1 ELSE 0 END) AS prospectos,
            SUM(CASE WHEN f.situacao_chave IS NULL THEN 1 ELSE 0 END) AS sem_situacao,
           ${somas}
       FROM (${sql}) f`,
    valores,
  );
  return linha!;
}

/** Clientes que ENTRARAM em cada um dos últimos 12 meses, com a condição da dimensão `entradaMes`. */
export async function entradasPorMes(
  escopo: Escopo,
): Promise<{ mes: string; clientes: number; comSeguro: number }[]> {
  const carteira = condicaoDeCarteira(escopo, 'c.produtor_id');
  const condicoes = [
    "c.cliente_desde >= DATE_FORMAT(DATE_SUB(CURDATE(), INTERVAL 11 MONTH), '%Y-%m-01')",
    'c.cliente_desde <= LAST_DAY(CURDATE())',
    carteira.condicao,
  ].filter(Boolean);
  const [linhas] = await pool.execute<RowDataPacket[]>(
    `SELECT DATE_FORMAT(c.cliente_desde, '%Y-%m') AS mes, COUNT(*) AS clientes,
            SUM(sit.chave IN ('ativo', 'inadimplente')) AS com_seguro
       FROM clientes c
       LEFT JOIN situacoes_cliente sit ON sit.id = c.situacao_id
      WHERE ${condicoes.join(' AND ')}
      GROUP BY mes
      ORDER BY mes`,
    carteira.valores,
  );
  return linhas.map((l) => ({ mes: String(l.mes), clientes: Number(l.clientes), comSeguro: Number(l.com_seguro ?? 0) }));
}
