import type { PoolConnection, ResultSetHeader, RowDataPacket } from 'mysql2/promise';

import { pool } from '../database/pool.js';
import { condicaoDeCarteira, ESCOPO_TOTAL, type Escopo } from '../utils/escopo.js';
import { nomeEmCaixaAlta } from '../utils/texto.js';
import { uuidParaBinario } from '../utils/uuid.js';

// Recorte de carteira pelo CORRETOR da cotação (`produtor_id`), como nos clientes.

export type SituacaoCotacao = 'em_cotacao' | 'enviada' | 'fechada' | 'perdida';

export interface VeiculoCotacao {
  placa: string | null;
  chassi: string | null;
  fabricante: string | null;
  modelo: string | null;
  anoFabricacao: number | null;
  anoModelo: number | null;
  codigoFipe: string | null;
  uso: string | null;
  zeroKm: boolean | null;
  cepPernoite: string | null;
  condutorNome: string | null;
  condutorDocumento: string | null;
  condutorNascimento: string | null;
}

export interface NovaCotacao {
  clienteId: number;
  produtorId: number;
  criadoPorUuid: string;
  observacoes: string | null;
  tipoIds: number[];
  veiculo: VeiculoCotacao | null;
}

export async function criar(dados: NovaCotacao, conexao: PoolConnection): Promise<number> {
  const [r] = await conexao.execute<ResultSetHeader>(
    `INSERT INTO cotacoes (cliente_id, produtor_id, criado_por, observacoes)
     VALUES (?, ?, (SELECT id FROM usuarios WHERE uuid = ?), ?)`,
    [dados.clienteId, dados.produtorId, uuidParaBinario(dados.criadoPorUuid), dados.observacoes],
  );
  const id = r.insertId;

  await conexao.query(
    `INSERT INTO cotacao_tipos (cotacao_id, tipo_seguro_id)
     SELECT ?, t.id FROM tipos_seguro t WHERE t.ativo = 1 AND t.id IN (?)`,
    [id, dados.tipoIds],
  );

  const v = dados.veiculo;
  if (v) {
    await conexao.execute(
      `INSERT INTO cotacao_veiculos
         (cotacao_id, placa, chassi, fabricante, modelo, ano_fabricacao, ano_modelo, codigo_fipe,
          uso, zero_km, cep_pernoite, condutor_nome, condutor_documento, condutor_nascimento)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id, v.placa, v.chassi, v.fabricante, v.modelo, v.anoFabricacao, v.anoModelo, v.codigoFipe,
        v.uso, v.zeroKm === null ? null : v.zeroKm ? 1 : 0, v.cepPernoite,
        v.condutorNome ? nomeEmCaixaAlta(v.condutorNome) : null, v.condutorDocumento, v.condutorNascimento,
      ],
    );
  }

  return id;
}

export interface CotacaoResumo {
  id: string;
  situacao: SituacaoCotacao;
  cliente: { id: string; nome: string; cpfCnpj: string | null };
  corretor: string | null;
  tipos: string[];
  propostas: number;
  menorPremio: number | null;
  criadaEm: string;
  encerradaEm: string | null;
}

const iso = (v: unknown): string | null =>
  v instanceof Date ? v.toISOString() : v ? String(v) : null;

export async function listar(
  escopo: Escopo = ESCOPO_TOTAL,
  situacao?: SituacaoCotacao,
): Promise<CotacaoResumo[]> {
  const carteira = condicaoDeCarteira(escopo, 'ct.produtor_id');
  const condicoes: string[] = [];
  const valores: unknown[] = [];
  if (carteira.condicao) {
    condicoes.push(carteira.condicao);
    valores.push(...carteira.valores);
  }
  if (situacao) {
    condicoes.push('ct.situacao = ?');
    valores.push(situacao);
  }

  const [linhas] = await pool.query<RowDataPacket[]>(
    `SELECT BIN_TO_UUID(ct.uuid, 1) AS id, ct.situacao, ct.criado_em, ct.encerrada_em,
            BIN_TO_UUID(c.uuid, 1) AS cliente_id, c.nome AS cliente_nome, c.cpf_cnpj,
            pr.nome AS corretor,
            (SELECT GROUP_CONCAT(t.nome ORDER BY t.ordem SEPARATOR '|')
               FROM cotacao_tipos x JOIN tipos_seguro t ON t.id = x.tipo_seguro_id
              WHERE x.cotacao_id = ct.id) AS tipos,
            (SELECT COUNT(*) FROM cotacao_propostas p WHERE p.cotacao_id = ct.id) AS propostas,
            (SELECT MIN(p.premio) FROM cotacao_propostas p WHERE p.cotacao_id = ct.id) AS menor_premio
       FROM cotacoes ct
       JOIN clientes c ON c.id = ct.cliente_id
       LEFT JOIN produtores pr ON pr.id = ct.produtor_id
      ${condicoes.length ? `WHERE ${condicoes.join(' AND ')}` : ''}
      ORDER BY FIELD(ct.situacao, 'em_cotacao', 'enviada', 'fechada', 'perdida'), ct.criado_em DESC
      LIMIT 300`,
    valores,
  );

  return linhas.map((l) => ({
    id: String(l.id),
    situacao: l.situacao as SituacaoCotacao,
    cliente: { id: String(l.cliente_id), nome: String(l.cliente_nome), cpfCnpj: l.cpf_cnpj ? String(l.cpf_cnpj) : null },
    corretor: l.corretor ? String(l.corretor) : null,
    tipos: l.tipos ? String(l.tipos).split('|') : [],
    propostas: Number(l.propostas),
    menorPremio: l.menor_premio === null ? null : Number(l.menor_premio),
    criadaEm: iso(l.criado_em)!,
    encerradaEm: iso(l.encerrada_em),
  }));
}

export interface PropostaCotacao {
  id: number;
  seguradoraId: number;
  seguradora: string;
  tipoSeguroId: number;
  tipoSeguro: string;
  premio: number;
  franquia: number | null;
  formaPagamento: string | null;
  observacao: string | null;
  escolhida: boolean;
}

export interface CotacaoDetalhe extends CotacaoResumo {
  /** id interno — não sai na API (o controller o remove). */
  idInterno: number;
  observacoes: string | null;
  motivoPerda: string | null;
  tiposDetalhe: { id: number; nome: string; formulario: string }[];
  veiculo: VeiculoCotacao | null;
  propostas_: PropostaCotacao[];
}

/** Uma cotação pelo uuid, dentro do recorte. `null` fora dele ou inexistente. */
export async function buscar(uuid: string, escopo: Escopo = ESCOPO_TOTAL): Promise<CotacaoDetalhe | null> {
  const carteira = condicaoDeCarteira(escopo, 'ct.produtor_id');
  const [[l]] = await pool.query<RowDataPacket[]>(
    `SELECT ct.id AS id_interno, BIN_TO_UUID(ct.uuid, 1) AS id, ct.situacao, ct.criado_em,
            ct.encerrada_em, ct.observacoes, ct.motivo_perda,
            BIN_TO_UUID(c.uuid, 1) AS cliente_id, c.nome AS cliente_nome, c.cpf_cnpj,
            pr.nome AS corretor
       FROM cotacoes ct
       JOIN clientes c ON c.id = ct.cliente_id
       LEFT JOIN produtores pr ON pr.id = ct.produtor_id
      WHERE ct.uuid = ? ${carteira.condicao ? `AND ${carteira.condicao}` : ''}`,
    [uuidParaBinario(uuid), ...carteira.valores],
  );
  if (!l) return null;

  const id = Number(l.id_interno);
  const [[tipos], [[v]], [propostas]] = await Promise.all([
    pool.query<RowDataPacket[]>(
      `SELECT t.id, t.nome, t.formulario FROM cotacao_tipos x
         JOIN tipos_seguro t ON t.id = x.tipo_seguro_id
        WHERE x.cotacao_id = ? ORDER BY t.ordem, t.nome`,
      [id],
    ),
    pool.query<RowDataPacket[]>('SELECT * FROM cotacao_veiculos WHERE cotacao_id = ?', [id]),
    pool.query<RowDataPacket[]>(
      `SELECT p.id, p.seguradora_id, s.nome AS seguradora, p.tipo_seguro_id, t.nome AS tipo,
              p.premio, p.franquia, p.forma_pagamento, p.observacao, p.escolhida
         FROM cotacao_propostas p
         JOIN seguradoras s ON s.id = p.seguradora_id
         JOIN tipos_seguro t ON t.id = p.tipo_seguro_id
        WHERE p.cotacao_id = ?
        ORDER BY t.ordem, p.premio`,
      [id],
    ),
  ]);

  const lista: PropostaCotacao[] = propostas.map((p) => ({
    id: Number(p.id),
    seguradoraId: Number(p.seguradora_id),
    seguradora: String(p.seguradora),
    tipoSeguroId: Number(p.tipo_seguro_id),
    tipoSeguro: String(p.tipo),
    premio: Number(p.premio),
    franquia: p.franquia === null ? null : Number(p.franquia),
    formaPagamento: p.forma_pagamento ? String(p.forma_pagamento) : null,
    observacao: p.observacao ? String(p.observacao) : null,
    escolhida: p.escolhida === 1,
  }));

  return {
    idInterno: id,
    id: String(l.id),
    situacao: l.situacao as SituacaoCotacao,
    cliente: { id: String(l.cliente_id), nome: String(l.cliente_nome), cpfCnpj: l.cpf_cnpj ? String(l.cpf_cnpj) : null },
    corretor: l.corretor ? String(l.corretor) : null,
    tipos: tipos.map((t) => String(t.nome)),
    propostas: lista.length,
    menorPremio: lista.length ? Math.min(...lista.map((p) => p.premio)) : null,
    criadaEm: iso(l.criado_em)!,
    encerradaEm: iso(l.encerrada_em),
    observacoes: l.observacoes ? String(l.observacoes) : null,
    motivoPerda: l.motivo_perda ? String(l.motivo_perda) : null,
    tiposDetalhe: tipos.map((t) => ({ id: Number(t.id), nome: String(t.nome), formulario: String(t.formulario) })),
    veiculo: v
      ? {
          placa: v.placa, chassi: v.chassi, fabricante: v.fabricante, modelo: v.modelo,
          anoFabricacao: v.ano_fabricacao, anoModelo: v.ano_modelo, codigoFipe: v.codigo_fipe,
          uso: v.uso, zeroKm: v.zero_km === null ? null : v.zero_km === 1, cepPernoite: v.cep_pernoite,
          condutorNome: v.condutor_nome, condutorDocumento: v.condutor_documento,
          condutorNascimento: v.condutor_nascimento ? String(v.condutor_nascimento).slice(0, 10) : null,
        }
      : null,
    propostas_: lista,
  };
}

export async function adicionarProposta(
  cotacaoId: number,
  p: {
    seguradoraId: number;
    tipoSeguroId: number;
    premio: number;
    franquia: number | null;
    formaPagamento: string | null;
    observacao: string | null;
  },
): Promise<void> {
  await pool.execute(
    `INSERT INTO cotacao_propostas
       (cotacao_id, seguradora_id, tipo_seguro_id, premio, franquia, forma_pagamento, observacao)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [cotacaoId, p.seguradoraId, p.tipoSeguroId, p.premio, p.franquia, p.formaPagamento, p.observacao],
  );
}

export async function removerProposta(cotacaoId: number, propostaId: number): Promise<boolean> {
  const [r] = await pool.execute<ResultSetHeader>(
    'DELETE FROM cotacao_propostas WHERE id = ? AND cotacao_id = ?',
    [propostaId, cotacaoId],
  );
  return r.affectedRows > 0;
}

/** Fechada/perdida carimbam `encerrada_em`; reabrir apaga o carimbo, o motivo e a proposta escolhida. */
export async function definirSituacao(
  cotacaoId: number,
  situacao: SituacaoCotacao,
  motivoPerda: string | null,
  propostaEscolhidaId: number | null,
): Promise<void> {
  const conexao = await pool.getConnection();
  try {
    await conexao.beginTransaction();
    const encerra = situacao === 'fechada' || situacao === 'perdida';
    await conexao.execute(
      `UPDATE cotacoes
          SET situacao = ?, motivo_perda = ?,
              encerrada_em = ${encerra ? 'COALESCE(encerrada_em, CURRENT_TIMESTAMP(3))' : 'NULL'}
        WHERE id = ?`,
      [situacao, situacao === 'perdida' ? motivoPerda : null, cotacaoId],
    );
    await conexao.execute('UPDATE cotacao_propostas SET escolhida = (id <=> ?) WHERE cotacao_id = ?', [
      situacao === 'fechada' ? propostaEscolhidaId : null,
      cotacaoId,
    ]);
    await conexao.commit();
  } catch (erro) {
    await conexao.rollback();
    throw erro;
  } finally {
    conexao.release();
  }
}

/** O uuid público de uma cotação recém-criada. */
export async function uuidPorId(id: number): Promise<string> {
  const [[l]] = await pool.execute<RowDataPacket[]>(
    'SELECT BIN_TO_UUID(uuid, 1) AS id FROM cotacoes WHERE id = ?',
    [id],
  );
  return String(l!.id);
}
