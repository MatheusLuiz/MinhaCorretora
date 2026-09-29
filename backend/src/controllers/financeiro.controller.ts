import type { RequestHandler } from 'express';

import * as repo from '../repositories/financeiro.repository.js';
import { escopoDaRequisicao } from '../services/escopo.js';
import { AppError } from '../utils/AppError.js';

/** `DATE` vem como string pelo `dateStrings` do pool; `DATETIME` vem como Date. */
function dataIso(valor: unknown): string | null {
  if (!valor) return null;
  if (typeof valor === 'string') return valor.slice(0, 10);
  if (valor instanceof Date) return valor.toISOString().slice(0, 10);
  return null;
}

/** Filtro de seguradora da inadimplência: o NOME, como o cadastro grafa. Vazio = todas. */
function seguradoraDaConsulta(query: Record<string, unknown>): string | undefined {
  const nome = typeof query.seguradora === 'string' ? query.seguradora.trim() : '';
  return nome ? nome.slice(0, 60) : undefined;
}

export const resumo: RequestHandler = async (req, res, next) => {
  try {
    const escopo = await escopoDaRequisicao(req);
    const base = await repo.resumo(escopo, seguradoraDaConsulta(req.query));

    // O demonstrativo vem por filial, sem cliente: sem `comissoes.todas`, listas vazias (ratear seria inventar).
    const porFilial = escopo.comissoesTodas ? await repo.comissaoPorTipoDeServico() : [];

    const porCompetencia = escopo.comissoesTodas ? await repo.comissaoPorCompetencia() : [];

    res.json({
      ...base,
      comissaoPorFilial: porFilial.map((l) => ({
        rotulo: String(l.rotulo ?? '—'),
        valor: Number(l.valor ?? 0),
        lancamentos: Number(l.lancamentos ?? 0),
      })),
      comissaoPorCompetencia: porCompetencia.map((l) => ({
        rotulo: String(l.rotulo),
        valor: Number(l.valor ?? 0),
      })),
      // Para a tela explicar lista vazia por recorte, e não como "nenhum atraso".
      recorte: {
        carteiraPropria: escopo.produtorIds !== null,
        semCarteira: escopo.produtorIds !== null && escopo.produtorIds.length === 0,
        inadimplenciaCompleta: escopo.inadimplenciaCompleta,
        comissoesTodas: escopo.comissoesTodas,
      },
    });
  } catch (erro) {
    next(erro);
  }
};

export const inadimplencia: RequestHandler = async (req, res, next) => {
  try {
    const linhas = await repo.listarInadimplencia(
      500,
      await escopoDaRequisicao(req),
      seguradoraDaConsulta(req.query),
    );

    res.json({
      parcelas: linhas.map((l) => ({
        apolice: String(l.apolice),
        nomeSegurado: String(l.nome_segurado),
        temCliente: l.cliente_id !== null,
        clienteId: l.cliente_uuid === null ? null : String(l.cliente_uuid),
        // Null quando a apólice ainda não tem cliente: sem ele não há corretor.
        produtor: l.produtor === null || l.produtor === undefined ? null : String(l.produtor),
        situacaoCliente:
          l.situacao_cliente === null || l.situacao_cliente === undefined
            ? null
            : String(l.situacao_cliente),
        seguradora: String(l.seguradora),
        produto: l.produto === null ? null : String(l.produto),
        parcela: Number(l.parcela),
        vencimento: dataIso(l.vencimento),
        valor: Number(l.valor ?? 0),
        formaPagamento: l.forma_pagamento === null ? null : String(l.forma_pagamento),
        motivoRejeicao: l.motivo_rejeicao === null ? null : String(l.motivo_rejeicao),
        diasEmAtraso: Number(l.dias_em_atraso ?? 0),
      })),
    });
  } catch (erro) {
    next(erro);
  }
};

/** `de`/`ate` em `AAAA-MM` → datas com `ate` EXCLUSIVO; mês inteiro, porque comissão se confere por mês. */
function periodoDaConsulta(
  query: Record<string, unknown>,
  obrigatorio: boolean,
): { de: string; ate: string; meses: string[] } | null {
  const de = typeof query.de === 'string' ? query.de : '';
  const ate = typeof query.ate === 'string' ? query.ate : '';
  if (!de && !ate && !obrigatorio) return null;

  const mes = /^(\d{4})-(0[1-9]|1[0-2])$/;
  const a = mes.exec(de);
  const b = mes.exec(ate);
  if (!a || !b) throw AppError.unprocessable('Período inválido: use AAAA-MM em "de" e "ate".');
  if (de > ate) throw AppError.unprocessable('O início do período precisa ser antes do fim.');

  const meses: string[] = [];
  let ano = Number(a[1]);
  let m = Number(a[2]);
  while (`${ano}-${String(m).padStart(2, '0')}` <= ate) {
    meses.push(`${ano}-${String(m).padStart(2, '0')}`);
    if (++m > 12) { m = 1; ano++; }
    if (meses.length > 60) throw AppError.unprocessable('Período longo demais: no máximo 5 anos.');
  }

  return { de: `${de}-01`, ate: `${ano}-${String(m).padStart(2, '0')}-01`, meses };
}

/** Comissão do período: recebida (pela data do pagamento) e a receber (pelo vencimento). */
export const comissaoPeriodo: RequestHandler = async (req, res, next) => {
  try {
    const escopo = await escopoDaRequisicao(req);
    if (!escopo.comissoesTodas) throw AppError.forbidden('Comissão da corretora exige comissoes.todas.');

    const periodo = periodoDaConsulta(req.query, true)!;
    const dados = await repo.comissaoNoPeriodo(periodo.de, periodo.ate, escopo);

    res.json({ meses: periodo.meses, ...dados });
  } catch (erro) {
    next(erro);
  }
};

/** A receber parcela a parcela; mesmas regras de `comissaoPeriodo`, para fila e painel baterem. */
export const parcelasAReceber: RequestHandler = async (req, res, next) => {
  try {
    const escopo = await escopoDaRequisicao(req);
    if (!escopo.comissoesTodas) throw AppError.forbidden('Comissão da corretora exige comissoes.todas.');

    const periodo = periodoDaConsulta(req.query, true)!;
    res.json({ parcelas: await repo.parcelasAReceber(periodo.de, periodo.ate, escopo) });
  } catch (erro) {
    next(erro);
  }
};

export const comissoes: RequestHandler = async (req, res, next) => {
  try {
    // O arquivo não diz de quem é cada lançamento: sem `comissoes.todas`, lista vazia.
    if (!(await escopoDaRequisicao(req)).comissoesTodas) {
      res.json({ lancamentos: [] });
      return;
    }

    // Com período, a lista acompanha o filtro da tela; sem, os mais recentes.
    const periodo = periodoDaConsulta(req.query, false);
    const linhas = await repo.listarLancamentos(periodo?.de, periodo?.ate);

    res.json({
      lancamentos: linhas.map((l) => ({
        competencia: String(l.competencia),
        seguradora: String(l.seguradora),
        filial: l.filial === null ? null : String(l.filial),
        tipoServico: l.tipo_servico === null ? null : String(l.tipo_servico),
        numero: String(l.numero),
        tipo: l.tipo === null ? null : String(l.tipo),
        totalBruto: Number(l.total_bruto ?? 0),
        desconto: Number(l.desconto ?? 0),
        impostos: Number(l.impostos ?? 0),
        totalLiquido: Number(l.total_liquido ?? 0),
        pagoEm: dataIso(l.pago_em),
        formaPagamento: l.forma_pagamento === null ? null : String(l.forma_pagamento),
      })),
    });
  } catch (erro) {
    next(erro);
  }
};

/** Comissão por CLIENTE, de `apolices.comissao`, no recorte de carteira. */
export const comissaoPorCliente: RequestHandler = async (req, res, next) => {
  try {
    const escopo = await escopoDaRequisicao(req);
    // Sem `de`/`ate`, a carteira inteira.
    const periodo = periodoDaConsulta(req.query, false) ?? undefined;

    const [clientes, totais] = await Promise.all([
      repo.comissaoPorCliente(escopo, 100, periodo),
      repo.totaisComissaoDaCarteira(escopo, periodo),
    ]);

    res.json({ clientes, totais });
  } catch (erro) {
    next(erro);
  }
};
