import type { RequestHandler } from 'express';

import { idDoUsuarioDaRequisicao } from '../middlewares/autenticacao.js';
import * as repo from '../repositories/cliente.repository.js';
import type { OrigemSistema } from '../repositories/cliente.repository.js';
import * as auditoria from '../services/arquivoAuditoria.service.js';
import { importar, linhasDeTexto } from '../services/importacaoClientes.service.js';
import { gerarCsvModelo, MODELOS, MODELOS_POR_CHAVE } from '../services/modelosImportacao.js';
import { AppError } from '../utils/AppError.js';

// O corpo chega como `text/csv` cru (sempre um arquivo só); o limite de tamanho fica na rota.

function nomeDoArquivo(req: Parameters<RequestHandler>[0]): string {
  const bruto = req.get('x-nome-arquivo');
  if (!bruto) return 'planilha.csv';

  // Header vem do cliente e vai para o banco e a tela: só o basename, sem caractere de controle.
  return decodeURIComponent(bruto)
    .replace(/^.*[\\/]/, '')
    .replace(/[^\p{L}\p{N}._ -]/gu, '')
    .slice(0, 120) || 'planilha.csv';
}

function corpoCsv(req: Parameters<RequestHandler>[0]): string {
  const corpo = req.body;

  if (typeof corpo !== 'string' || corpo.trim() === '') {
    throw AppError.unprocessable('Envie o conteúdo da planilha no corpo da requisição.');
  }

  return corpo;
}

/** Companhia escolhida na tela: só define a pasta do arquivamento (sem ela, `sem-seguradora/`). */
function seguradoraDoPedido(req: Parameters<RequestHandler>[0]): string | null {
  const bruto = String(req.query.seguradora ?? '').trim();
  return bruto ? bruto.slice(0, 60) : null;
}

/** Prévia obrigatória: a importação ESPELHA o arquivo, e coluna ausente apaga o que havia. */
export const previa: RequestHandler = async (req, res, next) => {
  try {
    const modeloChave = String(req.query.modelo ?? 'completo');
    const modelo = MODELOS_POR_CHAVE.get(modeloChave);

    if (!modelo) {
      throw AppError.unprocessable(`Modelo desconhecido: ${modeloChave}`);
    }

    res.json(
      await importar(linhasDeTexto(corpoCsv(req)), {
        origem: modelo.grupo === 'seguradora' ? 'seguradora' : 'manual',
        arquivo: nomeDoArquivo(req),
        simular: true,
        situacaoPadrao: modelo.situacaoPadrao,
        aliases: modelo.aliases,
        seguradoraPadrao: modelo.seguradoraPadrao,
      }),
    );
  } catch (erro) {
    next(erro);
  }
};

export const executar: RequestHandler = async (req, res, next) => {
  try {
    const modeloChave = String(req.query.modelo ?? 'completo');
    const modelo = MODELOS_POR_CHAVE.get(modeloChave);

    if (!modelo) {
      throw AppError.unprocessable(`Modelo desconhecido: ${modeloChave}`);
    }

    const origem = (String(req.query.origem ?? 'manual') || 'manual') as OrigemSistema;
    const origemValida: OrigemSistema = ['seguradora', 'manual'].includes(origem)
      ? origem
      : 'manual';

    const csv = corpoCsv(req);
    const nome = nomeDoArquivo(req);

    const resultado = await importar(linhasDeTexto(csv), {
      origem: origemValida,
      arquivo: nome,
      simular: false,
      situacaoPadrao: modelo.situacaoPadrao,
      aliases: modelo.aliases,
      seguradoraPadrao: modelo.seguradoraPadrao,
    });

    const guardado = await auditoria.guardar({
      lote: resultado.lote,
      conteudo: Buffer.from(csv, 'utf8'),
      nomeOriginal: nome,
      entidade: 'clientes',
      seguradora: seguradoraDoPedido(req) ?? modelo.seguradora ?? null,
      layout: modeloChave,
      origemSistema: origemValida,
      importadoPor: await idDoUsuarioDaRequisicao(req),
      resultado: { ...resultado, mapeamento: undefined },
    });

    res.json({ ...resultado, duplicataDe: guardado?.duplicataDe ?? null });
  } catch (erro) {
    next(erro);
  }
};

export const listarModelos: RequestHandler = async (req, res, next) => {
  try {
    // Cadastro ESPELHA o arquivo (pode apagar contatos): só para `importacao.gerenciar`.
    if (!req.usuario?.permissoes.includes('importacao.gerenciar')) {
      res.json({ modelos: [] });
      return;
    }

    res.json({
      modelos: MODELOS.map((m) => ({
        chave: m.chave,
        nome: m.nome,
        descricao: m.descricao,
        grupo: m.grupo,
        seguradora: m.seguradora ?? null,
        situacaoPadrao: m.situacaoPadrao,
        colunas: m.colunas,
        observacoes: m.observacoes,
        /** Quantas colunas o layout traduz por conta própria. */
        aliases: Object.keys(m.aliases ?? {}).length,
      })),
      situacoes: await repo.listarSituacoes(),
    });
  } catch (erro) {
    next(erro);
  }
};

export const baixarModelo: RequestHandler = (req, res, next) => {
  try {
    const modelo = MODELOS_POR_CHAVE.get(String(req.params.chave));

    if (!modelo) {
      throw AppError.notFound('Modelo não encontrado.');
    }

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="modelo-${modelo.chave}.csv"`,
    );
    res.send(gerarCsvModelo(modelo));
  } catch (erro) {
    next(erro);
  }
};

/** Escapa um valor para CSV com separador `;`. */
function celula(valor: unknown): string {
  if (valor === null || valor === undefined) return '';

  const texto =
    valor instanceof Date
      ? valor.toISOString().slice(0, 10)
      : String(valor);

  // Injeção de fórmula: =, +, - e @ no início viram fórmula no Excel.
  const seguro = /^[=+\-@]/.test(texto) ? `'${texto}` : texto;

  return /[;"\n\r]/.test(seguro) ? `"${seguro.replace(/"/g, '""')}"` : seguro;
}

/** Exporta a base no formato que o importador lê (exportar, editar, reimportar sem perder dado). */
export const exportar: RequestHandler = async (req, res, next) => {
  try {
    const situacao = req.query.situacao ? String(req.query.situacao) : undefined;
    const linhas = await repo.exportarParaPlanilha(situacao);

    const colunas =
      linhas.length > 0
        ? Object.keys(linhas[0]!).filter((c) => c !== 'constructor')
        : [];

    const partes: string[] = [];
    // BOM: sem ele o Excel lê como Latin-1.
    partes.push('﻿');
    partes.push(colunas.join(';'));

    for (const linha of linhas) {
      partes.push('\n');
      partes.push(colunas.map((c) => celula((linha as Record<string, unknown>)[c])).join(';'));
    }

    const hoje = new Date().toISOString().slice(0, 10);

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="clientes-${situacao ?? 'todos'}-${hoje}.csv"`,
    );
    res.send(partes.join(''));
  } catch (erro) {
    next(erro);
  }
};
