import type { RequestHandler } from 'express';

import * as clienteRepo from '../repositories/cliente.repository.js';
import * as repo from '../repositories/filaCadastro.repository.js';
import * as grupoRepo from '../repositories/grupoCliente.repository.js';
import { escopoDaRequisicao } from '../services/escopo.js';

// Recorte de CARTEIRA, não de consulta: a fila é para corrigir cadastro, e corrigir é da carteira.

/** `DATE` chega como string pelo `dateStrings` do pool; agregado pode vir como Date. */
function dataIso(valor: unknown): string | null {
  if (!valor) return null;
  if (typeof valor === 'string') return valor.slice(0, 10);
  if (valor instanceof Date) return valor.toISOString().slice(0, 10);
  return null;
}

const ehPendencia = (x: unknown): x is repo.Pendencia =>
  typeof x === 'string' && Object.prototype.hasOwnProperty.call(repo.PENDENCIAS, x);
const ehSituacao = (x: unknown): x is repo.Situacao =>
  typeof x === 'string' && (repo.SITUACOES as readonly string[]).includes(x);

/** Valor desconhecido é IGNORADO: link de uma versão futura abre a fila inteira, não um erro. */
function filtroDaConsulta(query: Record<string, unknown>): repo.FiltroFila {
  const busca = typeof query.busca === 'string' ? query.busca.trim().slice(0, 80) : '';
  return {
    pendencia: ehPendencia(query.pendencia) ? query.pendencia : undefined,
    situacao: ehSituacao(query.situacao) ? query.situacao : undefined,
    busca: busca || undefined,
  };
}

const bandeira = (v: unknown): boolean => Number(v) === 1;

export const listar: RequestHandler = async (req, res, next) => {
  try {
    const escopo = await escopoDaRequisicao(req);
    const filtro = filtroDaConsulta(req.query);
    const linhas = await repo.listar(escopo, filtro);
    // Só conta à parte quando bateu no teto: no caso comum a lista É o total.
    const total = linhas.length >= repo.LIMITE_FILA ? await repo.contar(escopo, filtro) : linhas.length;

    res.json({
      total,
      limite: repo.LIMITE_FILA,
      clientes: linhas.map((l) => ({
        uuid: String(l.uuid),
        nome: String(l.nome),
        documento: l.cpf_cnpj ? String(l.cpf_cnpj) : String(l.cpf_cnpj_numeros),
        tipoPessoa: l.tipo_pessoa === 'J' ? 'J' : 'F',
        situacao: l.situacao_chave ? String(l.situacao_chave) : null,
        situacaoNome: l.situacao ? String(l.situacao) : null,
        telefone: l.telefone ? String(l.telefone) : null,
        email: l.email ? String(l.email) : null,
        pendencias: (Object.keys(repo.PENDENCIAS) as repo.Pendencia[]).filter((chave) =>
          chave === 'sem_contato' ? bandeira(l.sem_telefone) && bandeira(l.sem_email) : bandeira(l[chave]),
        ),
        apolicesEmVigor: Number(l.em_vigor ?? 0),
        proximoVencimento: dataIso(l.proximo_vencimento),
        seguradoras: l.seguradoras ? String(l.seguradoras) : null,
      })),
      recorte: {
        carteiraPropria: escopo.produtorIds !== null,
        semCarteira: escopo.produtorIds !== null && escopo.produtorIds.length === 0,
      },
    });
  } catch (erro) {
    next(erro);
  }
};

export const resumo: RequestHandler = async (req, res, next) => {
  try {
    const escopo = await escopoDaRequisicao(req);
    const [r, porCarteira, entradasPorMes, grupos] = await Promise.all([
      repo.resumo(escopo),
      clienteRepo.clientesPorCarteira(escopo),
      repo.entradasPorMes(escopo),
      grupoRepo.listarParaPaineis(),
    ]);
    const n = (v: unknown): number => Number(v ?? 0);

    res.json({
      porCarteira,
      grupos,
      entradasPorMes,
      total: n(r.total),
      naFila: n(r.na_fila),
      situacao: {
        ativo: n(r.ativos),
        inadimplente: n(r.inadimplentes),
        inativo: n(r.inativos),
        prospecto: n(r.prospectos),
        semSituacao: n(r.sem_situacao),
      },
      pendencias: Object.fromEntries(
        (Object.keys(repo.PENDENCIAS) as repo.Pendencia[]).map((chave) => [chave, n(r[chave])]),
      ) as Record<repo.Pendencia, number>,
      recorte: {
        carteiraPropria: escopo.produtorIds !== null,
        semCarteira: escopo.produtorIds !== null && escopo.produtorIds.length === 0,
      },
    });
  } catch (erro) {
    next(erro);
  }
};
