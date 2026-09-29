import type { PoolConnection, RowDataPacket } from 'mysql2/promise';

import { pool } from '../database/pool.js';
import { nomeEmCaixaAlta } from '../utils/texto.js';

export interface DadosVeiculo {
  placa: string | null;
  chassi: string | null;
  fabricante: string | null;
  modelo: string | null;
  anoFabricacao: number | null;
  anoModelo: number | null;
  codigoFipe: string | null;
  combustivel: string | null;
  tipoVeiculo: string | null;
  uso: string | null;
  zeroKm: boolean | null;
  antifurto: string | null;
  kitGas: boolean | null;
  cepPernoite: string | null;
  pernoiteGaragem: boolean | null;
  condutorNome: string | null;
  condutorDocumento: string | null;
  condutorNascimento: string | null;
  observacoes: string | null;
}

const COLUNAS = [
  'placa', 'chassi', 'fabricante', 'modelo', 'ano_fabricacao', 'ano_modelo', 'codigo_fipe',
  'combustivel', 'tipo_veiculo', 'uso', 'zero_km', 'antifurto', 'kit_gas', 'cep_pernoite',
  'pernoite_garagem', 'condutor_nome', 'condutor_documento', 'condutor_nascimento', 'observacoes',
] as const;

const bool = (v: boolean | null): number | null => (v === null ? null : v ? 1 : 0);

function valores(v: DadosVeiculo): unknown[] {
  return [
    v.placa, v.chassi, v.fabricante, v.modelo, v.anoFabricacao, v.anoModelo, v.codigoFipe,
    v.combustivel, v.tipoVeiculo, v.uso, bool(v.zeroKm), v.antifurto, bool(v.kitGas),
    v.cepPernoite, bool(v.pernoiteGaragem),
    v.condutorNome ? nomeEmCaixaAlta(v.condutorNome) : null,
    v.condutorDocumento, v.condutorNascimento, v.observacoes,
  ];
}

/**
 * `importacao` ACRESCENTA (`COALESCE`; placa nova troca a antiga); `manual` grava o formulário inteiro.
 * `origem` não muda no UPDATE de importação: corrigido à mão continua "manual".
 */
export async function gravar(
  apoliceId: number,
  dados: DadosVeiculo,
  origem: 'importacao' | 'manual',
  conexao?: PoolConnection,
): Promise<void> {
  const executor = conexao ?? pool;
  const atualizacao =
    origem === 'importacao'
      ? COLUNAS.map((c) => `${c} = COALESCE(novo.${c}, apolice_veiculos.${c})`).join(', ')
      : [...COLUNAS.map((c) => `${c} = novo.${c}`), 'origem = novo.origem'].join(', ');

  await executor.query(
    `INSERT INTO apolice_veiculos (apolice_id, ${COLUNAS.join(', ')}, origem)
     VALUES (?, ${COLUNAS.map(() => '?').join(', ')}, ?) AS novo
     ON DUPLICATE KEY UPDATE ${atualizacao}`,
    [apoliceId, ...valores(dados), origem],
  );
}

export interface VeiculoLinha extends RowDataPacket {
  apolice_id: number;
  placa: string | null;
  chassi: string | null;
  fabricante: string | null;
  modelo: string | null;
  ano_fabricacao: number | null;
  ano_modelo: number | null;
  codigo_fipe: string | null;
  combustivel: string | null;
  tipo_veiculo: string | null;
  uso: string | null;
  zero_km: number | null;
  antifurto: string | null;
  kit_gas: number | null;
  cep_pernoite: string | null;
  pernoite_garagem: number | null;
  condutor_nome: string | null;
  condutor_documento: string | null;
  condutor_nascimento: string | null;
  observacoes: string | null;
  origem: 'importacao' | 'manual';
}

/** Veículos de várias apólices de uma vez, por id da apólice. */
export async function porApolices(apoliceIds: number[]): Promise<Map<number, VeiculoLinha>> {
  if (apoliceIds.length === 0) return new Map();

  const [linhas] = await pool.query<VeiculoLinha[]>(
    `SELECT apolice_id, ${COLUNAS.join(', ')}, origem
       FROM apolice_veiculos
      WHERE apolice_id IN (?)`,
    [apoliceIds],
  );

  return new Map(linhas.map((l) => [Number(l.apolice_id), l]));
}

/** A apólice pelo número; o documento desempata (a chave inclui o segurado), senão a mais recente. */
export async function apoliceIdPorNumero(
  seguradoraChave: string,
  numero: string,
  documento: string | null,
): Promise<number | null> {
  const [linhas] = await pool.execute<RowDataPacket[]>(
    `SELECT a.id
       FROM apolices a
       JOIN seguradoras s ON s.id = a.seguradora_id
      WHERE s.chave = ? AND a.numero = ?
      ORDER BY (a.documento_segurado <=> ?) DESC, a.id DESC
      LIMIT 1`,
    [seguradoraChave, numero, documento],
  );
  return linhas[0] ? Number(linhas[0].id) : null;
}

/** Tipo explícito na apólice. `sobrescrever = false` respeita o que já estava. */
export async function definirTipoDaApolice(
  apoliceId: number,
  tipoId: number,
  sobrescrever: boolean,
): Promise<void> {
  await pool.execute(
    sobrescrever
      ? 'UPDATE apolices SET tipo_seguro_id = ? WHERE id = ?'
      : 'UPDATE apolices SET tipo_seguro_id = COALESCE(tipo_seguro_id, ?) WHERE id = ?',
    [tipoId, apoliceId],
  );
}
