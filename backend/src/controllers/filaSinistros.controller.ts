import type { RequestHandler } from 'express';

import * as repo from '../repositories/filaSinistros.repository.js';
import { escopoDaRequisicao } from '../services/escopo.js';
import { AppError } from '../utils/AppError.js';

// Recorte de CARTEIRA, não de consulta: saem acionamentos um a um, com nome e placa.

const TIPOS = ['sinistro', 'assistencia'] as const;
const SITUACOES = ['em_analise', 'recusado', 'encerrado'] as const;
const MES = /^\d{4}-(0[1-9]|1[0-2])$/;

/** `DATE` vem como string pelo `dateStrings` do pool; `DATETIME` vem como Date. */
function dataIso(valor: unknown): string | null {
  if (!valor) return null;
  if (typeof valor === 'string') return valor.slice(0, 10);
  if (valor instanceof Date) return valor.toISOString().slice(0, 10);
  return null;
}

function numeroOuNulo(valor: unknown): number | null {
  if (valor === null || valor === undefined) return null;
  const n = Number(valor);
  return Number.isFinite(n) ? n : null;
}

function texto(valor: unknown): string | null {
  return typeof valor === 'string' && valor.trim() ? valor.trim() : null;
}

/** Valor fora da lista é RECUSADO: ignorar devolveria a fila inteira sob um link que promete um recorte. */
function filtrosDaConsulta(query: Record<string, unknown>): repo.FiltrosSinistro {
  const filtros: repo.FiltrosSinistro = {};

  const tipo = texto(query.tipo);
  if (tipo) {
    if (!(TIPOS as readonly string[]).includes(tipo)) throw AppError.badRequest('Tipo de acionamento inválido.');
    filtros.tipo = tipo as repo.TipoAcionamento;
  }

  const status = texto(query.status);
  if (status) {
    if (!(SITUACOES as readonly string[]).includes(status)) throw AppError.badRequest('Situação inválida.');
    filtros.situacao = status as repo.SituacaoAcionamento;
  }

  const seguradora = texto(query.seguradora);
  if (seguradora) filtros.seguradora = seguradora.slice(0, 60);

  const mes = texto(query.mes);
  if (mes) {
    if (!MES.test(mes)) throw AppError.badRequest('Mês inválido: use AAAA-MM.');
    filtros.mes = mes;
  }

  const causa = texto(query.causa);
  if (causa) filtros.causa = causa.slice(0, 120);

  return filtros;
}

export const listar: RequestHandler = async (req, res, next) => {
  try {
    const filtros = filtrosDaConsulta(req.query as Record<string, unknown>);
    const escopo = await escopoDaRequisicao(req);
    const [linhas, opcoes] = await Promise.all([repo.listar(escopo, filtros), repo.opcoesDeFiltro(escopo)]);

    res.json({
      acionamentos: linhas.map((l) => ({
        id: Number(l.id),
        numero: String(l.numero),
        tipo: l.tipo as repo.TipoAcionamento,
        situacao: l.situacao as repo.SituacaoAcionamento,
        statusProcesso: l.status_processo ?? null,
        statusMovimento: l.status_movimento ?? null,
        ocorridoEm: dataIso(l.ocorrido_em),
        comunicadoEm: dataIso(l.comunicado_em),
        seguradora: String(l.seguradora),
        ramo: l.ramo ?? null,
        cobertura: l.cobertura ?? null,
        causa: l.causa ?? null,
        reserva: numeroOuNulo(l.reserva),
        placa: l.placa ?? null,
        veiculo: l.veiculo ?? null,
        nomeSinistrado: l.nome_sinistrado ?? null,
        clienteUuid: l.cliente_uuid ?? null,
        clienteNome: l.cliente_nome ?? null,
        vinculoOrigem: l.vinculo_origem ?? null,
        // O número como a companhia escreveu; `apoliceNaBase` diz se ligou.
        numeroApolice: String(l.numero_apolice),
        apoliceNaBase: l.apolice_numero !== null && l.apolice_numero !== undefined,
      })),
      opcoes,
    });
  } catch (erro) {
    next(erro);
  }
};

export const resumo: RequestHandler = async (req, res, next) => {
  try {
    const escopo = await escopoDaRequisicao(req);
    const [base, equipe] = await Promise.all([repo.resumo(escopo), repo.resumoDaEquipe(escopo)]);
    const centavos = (v: unknown): number => Math.round(Number(v ?? 0) * 100) / 100;

    const contar = (tipo: repo.TipoAcionamento, situacao?: repo.SituacaoAcionamento): number =>
      base.acionamentos
        .filter((l) => l.tipo === tipo && (!situacao || l.situacao === situacao))
        .reduce((t, l) => t + Number(l.quantidade ?? 0), 0);
    const reservaEmAnalise = base.acionamentos
      .filter((l) => l.tipo === 'sinistro' && l.situacao === 'em_analise')
      .reduce((t, l) => t + Number(l.reserva ?? 0), 0);

    res.json({
      sinistros: {
        total: contar('sinistro'),
        emAnalise: contar('sinistro', 'em_analise'),
        recusados: contar('sinistro', 'recusado'),
        // Reserva (o que a companhia separou), não valor pago.
        reservaEmAnalise: Math.round(reservaEmAnalise * 100) / 100,
      },
      assistencias: {
        total: contar('assistencia'),
        emAnalise: contar('assistencia', 'em_analise'),
      },
      frequencia: {
        cobertas: Number(base.frequencia?.cobertas ?? 0),
        comSinistro: Number(base.frequencia?.com_sinistro ?? 0),
        comAssistencia: Number(base.frequencia?.com_assistencia ?? 0),
      },
      porMes: base.porMes.map((l) => ({
        periodo: String(l.periodo),
        tipo: l.tipo as repo.TipoAcionamento,
        quantidade: Number(l.quantidade ?? 0),
      })),
      tipos: base.tipos.map((l) => ({
        tipo: String(l.tipo),
        apolices: Number(l.apolices ?? 0),
        emVigor: Number(l.em_vigor ?? 0),
        premioEmVigor: Math.round(Number(l.premio_em_vigor ?? 0) * 100) / 100,
        // Sem isso, "R$ 0,00" pareceria carteira sem valor quando a origem não informa.
        comPremio: Number(l.com_premio ?? 0),
      })),
      // Campos NOVOS vão no fim (tela e backend convivem em versões diferentes).
      porSeguradora: equipe.porSeguradora.map((l) => ({
        seguradora: String(l.seguradora),
        tipo: l.tipo as repo.TipoAcionamento,
        situacao: l.situacao as repo.SituacaoAcionamento,
        quantidade: Number(l.quantidade ?? 0),
        reserva: centavos(l.reserva),
      })),
      porCausa: equipe.porCausa.map((l) => ({
        causa: String(l.causa),
        tipo: l.tipo as repo.TipoAcionamento,
        quantidade: Number(l.quantidade ?? 0),
      })),
      idadeDosAbertos: equipe.idadeDosAbertos.map((l) => ({
        tipo: l.tipo as repo.TipoAcionamento,
        faixa: String(l.faixa),
        quantidade: Number(l.quantidade ?? 0),
      })),
      cobertura: equipe.cobertura.map((l) => ({
        seguradora: String(l.seguradora),
        emVigor: Number(l.em_vigor ?? 0),
        comMarca: Number(l.com_marca ?? 0),
        temRelatorio: Number(l.tem_relatorio ?? 0) === 1,
      })),
      semCliente: equipe.semCliente,
    });
  } catch (erro) {
    next(erro);
  }
};
