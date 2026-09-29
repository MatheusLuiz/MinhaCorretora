import * as repo from '../repositories/apolice.repository.js';
import type { ApoliceLinha, FiltroApolices } from '../repositories/apolice.repository.js';
import { binarioParaUuid } from '../utils/uuid.js';

/** Aceita string (coluna DATE, pelo `dateStrings` do pool) e `Date`. */
function dataIso(valor: string | Date | null): string | null {
  if (!valor) return null;
  if (typeof valor === 'string') return valor.slice(0, 10);

  const ano = valor.getFullYear();
  const mes = String(valor.getMonth() + 1).padStart(2, '0');
  const dia = String(valor.getDate()).padStart(2, '0');

  return `${ano}-${mes}-${dia}`;
}

export type SituacaoVigencia = 'vigente' | 'a_vencer' | 'vencida' | 'indefinida';

/** Sem fim de vigência é `indefinida`, nunca "vencida" (sumiria das renovações). */
function situacaoPorVigencia(inicio: string | null, fim: string | null): SituacaoVigencia {
  if (!fim) return 'indefinida';

  const hoje = new Date().toISOString().slice(0, 10);

  if (fim < hoje) return 'vencida';
  if (inicio && inicio > hoje) return 'a_vencer';

  return 'vigente';
}

export interface Apolice {
  id: string;
  numero: string;
  seguradora: string;
  produto: string | null;

  nomeSegurado: string;
  /** Preenchido quando a apólice está ligada a um cliente da base. */
  clienteId: string | null;
  clienteNome: string | null;
  /** Como o vínculo foi feito — `nome` merece revisão. */
  vinculoOrigem: string | null;

  emitidaEm: string | null;
  vigenciaInicio: string | null;
  vigenciaFim: string | null;
  situacao: SituacaoVigencia;

  premioTotal: number | null;
  premioLiquido: number | null;

  movimentos: number;
}

function paraApolice(linha: ApoliceLinha): Apolice {
  const inicio = dataIso(linha.vigencia_inicio);
  const fim = dataIso(linha.vigencia_fim);

  return {
    id: binarioParaUuid(linha.uuid),
    numero: linha.numero,
    seguradora: linha.seguradora,
    produto: linha.produto,

    nomeSegurado: linha.nome_segurado,
    clienteId: linha.cliente_uuid ? binarioParaUuid(linha.cliente_uuid) : null,
    clienteNome: linha.cliente_nome,
    vinculoOrigem: linha.vinculo_origem,

    emitidaEm: dataIso(linha.emitida_em),
    vigenciaInicio: inicio,
    vigenciaFim: fim,
    situacao: situacaoPorVigencia(inicio, fim),

    premioTotal: linha.premio_total === null ? null : Number(linha.premio_total),
    premioLiquido: linha.premio_liquido === null ? null : Number(linha.premio_liquido),

    movimentos: Number(linha.movimentos),
  };
}

export async function listar(filtro: FiltroApolices): Promise<{
  total: number;
  pagina: number;
  limite: number;
  paginas: number;
  apolices: Apolice[];
}> {
  const { total, linhas } = await repo.listar(filtro);

  return {
    total,
    pagina: filtro.pagina,
    limite: filtro.limite,
    paginas: Math.max(Math.ceil(total / filtro.limite), 1),
    apolices: linhas.map(paraApolice),
  };
}

export async function doCliente(clienteId: number): Promise<Apolice[]> {
  return (await repo.listarDoCliente(clienteId)).map(paraApolice);
}

export interface ResumoPainel extends repo.ResumoApolices {
  seguradoras: string[];
  /** Quantas órfãs por número de clientes com aquele nome. */
  conciliacao: { semCandidato: number; umCandidato: number; variosCandidatos: number };
}

export async function resumo(): Promise<ResumoPainel> {
  const [base, seguradoras, conciliacao] = await Promise.all([
    repo.resumo(),
    repo.seguradorasComApolice(),
    repo.resumoConciliacao(),
  ]);

  return { ...base, seguradoras, conciliacao };
}

