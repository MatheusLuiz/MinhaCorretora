import { randomUUID } from 'node:crypto';

import type { RequestHandler } from 'express';

import {
  idDoUsuarioDaRequisicao as idDoUsuario,
  usuarioDaRequisicao,
} from '../middlewares/autenticacao.js';
import * as apoliceRepo from '../repositories/apolice.repository.js';
import * as arquivoRepo from '../repositories/arquivoImportado.repository.js';
import * as modeloRepo from '../repositories/modeloRelatorio.repository.js';
import * as seguradoraRepo from '../repositories/seguradora.repository.js';
import * as auditoria from '../services/arquivoAuditoria.service.js';
import { importarApolices } from '../services/importacaoApolices.service.js';
import { guardarCorrecoes, resgatarCorrecoes } from '../services/correcoesPendentes.js';
import { importarCarteira, type Correcao } from '../services/importacaoCarteira.service.js';
import { importarPdfBradesco } from '../seguradoras/bradesco/importacao/importacaoPdf.service.js';
import { importarConsultaPorto } from '../seguradoras/porto-seguro/importacao/importacaoConsulta.service.js';
import {
  importarConsultaPortalPorto,
  LAYOUT_CONSULTA_PORTAL,
} from '../seguradoras/porto-seguro/importacao/importacaoConsultaPortal.service.js';
import { ehLayoutDetalheBradesco, importarComissaoBradesco } from '../seguradoras/bradesco/importacao/importacaoComissao.service.js';
import { importarReBradesco, LAYOUT_AUTO_ATIVAS, LAYOUT_RE_ATIVAS, LAYOUT_RE_ENCERRADAS } from '../seguradoras/bradesco/importacao/importacaoRe.service.js';
import { conferirExtrato } from '../seguradoras/porto-seguro/importacao/conferenciaExtratoComissao.service.js';
import { importarComissaoAnalitica } from '../seguradoras/porto-seguro/importacao/importacaoComissaoAnalitica.service.js';
import { importarDemonstrativoSuhai } from '../seguradoras/suhai/importacao/importacaoDemonstrativoComissao.service.js';
import {
  importarCanceladasTokio,
  importarEmitidasTokio,
  importarExtratoComissaoTokio,
  LAYOUT_CANCELADAS as TOKIO_CANCELADAS,
  LAYOUT_COMISSOES as TOKIO_COMISSOES,
  LAYOUT_EMITIDAS as TOKIO_EMITIDAS,
} from '../seguradoras/tokio-marine/importacao/importacaoTokio.service.js';
import { importarFinanceiro } from '../services/importacaoFinanceiro.service.js';
import { parseLinhaCsv } from '../services/importacaoClientes.service.js';
import { LAYOUTS_APOLICES, LAYOUTS_APOLICES_POR_CHAVE } from '../services/modelosApolices.js';
import { LAYOUTS_CARTEIRA, LAYOUTS_CARTEIRA_POR_CHAVE } from '../services/modelosCarteira.js';
import { LAYOUTS_FINANCEIRO, LAYOUTS_FINANCEIRO_POR_CHAVE } from '../services/modelosFinanceiro.js';
import { AppError } from '../utils/AppError.js';
import { decodificarTexto, detectarCodificacao } from '../utils/texto.js';
import { lerTabelaHtml, pareceTabelaHtml } from '../utils/tabelaHtml.js';
import { lerXlsBiff, pareceXlsBiff } from '../utils/xlsBiff.js';
import { parecePdf } from '../utils/pdf.js';
import { lerXlsx, pareceXlsx } from '../utils/xlsx.js';

// O corpo chega como binário cru (octet-stream): .xlsx é zip e lido como UTF-8 se corrompe.

function nomeDoArquivo(req: Parameters<RequestHandler>[0]): string {
  const bruto = req.get('x-nome-arquivo');
  if (!bruto) return 'planilha.xlsx';

  // Header vem do cliente e vai para o banco e a tela: só o basename, sem caractere de controle.
  const semCaminho = decodeURIComponent(bruto).split(/[\\/]/).pop() ?? '';

  return semCaminho.replace(/[^\p{L}\p{N}._ -]/gu, '').slice(0, 200) || 'planilha.xlsx';
}

/** Converte o corpo em grade de texto, seja .xlsx, .xls, HTML ou .csv. */
export function lerGrade(corpo: unknown): string[][] {
  // Piso de 32 bytes: barra corpo serializado por engano ("{}"); nenhum arquivo real é menor.
  if (!Buffer.isBuffer(corpo) || corpo.length < 32) {
    throw AppError.unprocessable(
      'Envie o arquivo no corpo da requisição — o conteúdo recebido está vazio ou truncado.',
    );
  }

  if (pareceXlsx(corpo)) return lerXlsx(corpo);

  // .xls BIFF de verdade (portal da Porto). Nunca pedir para salvar como .xlsx no Excel:
  // número de apólice longo vira notação científica.
  if (pareceXlsBiff(corpo)) return lerXlsBiff(corpo);

  // Relatório `.xls` que na verdade é `<table>` HTML (analítico de comissões da Porto).
  if (pareceTabelaHtml(corpo)) return lerTabelaHtml(corpo);

  // Bytes NUL denunciam binário disfarçado de CSV.
  if (corpo.includes(0)) {
    throw AppError.unprocessable('O arquivo precisa ser CSV de texto ou XLSX válido.');
  }

  // Detecta a codificação: CSV do Excel sai em windows-1252.
  const texto = decodificarTexto(corpo);
  const linhas = texto.split(/\r?\n/).filter((l) => l.trim() !== '');

  if (linhas.length === 0) return [];

  // Excel em português salva com `;` porque a vírgula é o separador decimal.
  const cabecalho = linhas[0]!;
  const pontoEVirgula =
    (cabecalho.match(/;/g) ?? []).length > (cabecalho.match(/,/g) ?? []).length;

  return linhas.map((l) =>
    (pontoEVirgula ? l.split(';').map((c) => c.trim().replace(/^"|"$/g, '')) : parseLinhaCsv(l)).map(semMarcacaoHtml),
  );
}

/** O CSV de assistências da Suhai traz a apólice como `<a href>`; o .xlsx e o .xls, só o número. */
function semMarcacaoHtml(celula: string): string {
  return celula.includes('<') ? celula.replace(/<[^>]*>/g, '').trim() : celula;
}

/** Seguradora escolhida na tela: sobrepõe a do layout e decide a pasta do arquivamento. */
function seguradoraDoPedido(req: Parameters<RequestHandler>[0]): string | undefined {
  const bruto = String(req.query.seguradora ?? '').trim();
  return bruto ? bruto.slice(0, 60) : undefined;
}

/**
 * Sob que nome arquivar o original. Não valida a chave: quem decide é `layoutResolvido`,
 * o único que conhece layouts de código e modelos cadastrados.
 */
async function descritorDoLayout(
  chave: string,
  familia: 'apolices' | 'financeiro' | 'carteira',
): Promise<{ seguradora: string; entidade?: 'parcelas' | 'comissoes' | 'sinistros' | 'renovacoes' | 'encerradas' }> {
  const doCodigo =
    familia === 'apolices'
      ? LAYOUTS_APOLICES_POR_CHAVE.get(chave)
      : familia === 'financeiro'
        ? LAYOUTS_FINANCEIRO_POR_CHAVE.get(chave)
        : LAYOUTS_CARTEIRA_POR_CHAVE.get(chave);

  if (doCodigo) {
    return {
      // Carteira arquiva sob a `origem` do layout (a pasta do portal).
      seguradora: 'origem' in doCodigo ? doCodigo.origem : doCodigo.seguradora,
      entidade: 'entidade' in doCodigo ? doCodigo.entidade : undefined,
    };
  }

  const modelo = (await modeloRepo.listar()).find((m) => m.chave === chave);

  return {
    seguradora: modelo?.seguradoraNome ?? 'outros',
    entidade: modelo?.entidade ?? undefined,
  };
}

/** Quem tem só `importacao.parcelas` vê e envia apenas os layouts de parcelas. */
function soParcelas(req: Parameters<RequestHandler>[0]): boolean {
  const permissoes = req.usuario?.permissoes ?? [];
  return !permissoes.includes('importacao.gerenciar') && permissoes.includes('importacao.parcelas');
}

/** Layouts oferecidos na tela; companhia inativa ou não cadastrada fica de fora (e vai em `ocultos`). */
export const listarLayouts: RequestHandler = async (req, res, next) => {
  try {
    const restrito = soParcelas(req);
    const cadastro = new Map(
      (await seguradoraRepo.comChave()).map((s) => [s.chave, s]),
    );

    const ativa = (chave: string): boolean => cadastro.get(chave)?.ativa === true;
    const nomeDe = (chave: string, queda: string): string => cadastro.get(chave)?.nome ?? queda;

    // Modelos cadastrados entram na mesma lista dos de código; o modelo aponta a companhia por id.
    const idsAtivos = new Set(
      [...cadastro.values()].filter((s) => s.ativa).map((s) => s.id),
    );

    const doCadastro = (await modeloRepo.listar()).filter(
      (m) => m.seguradoraId === null || idsAtivos.has(m.seguradoraId),
    );

    const daFamilia = (familia: string) =>
      doCadastro
        .filter((m) => m.familia === familia)
        .map((m) => ({
          chave: m.chave,
          nome: m.nome,
          seguradora: m.seguradoraNome ?? '',
          descricao: m.descricao ?? `Modelo cadastrado · ${Object.keys(m.colunas).length} colunas mapeadas`,
          entidade: m.entidade ?? undefined,
          observacoes: [
            'Formato cadastrado pela tela, não escrito no código.',
            `${Object.keys(m.colunas).length} coluna(s) mapeada(s) para campos do sistema.`,
          ],
        }));

    const catalogo = {
      apolices: [
        ...LAYOUTS_APOLICES.filter((l) => ativa(l.seguradoraChave)).map((l) => ({
          chave: l.chave,
          nome: l.nome,
          seguradora: nomeDe(l.seguradoraChave, l.seguradora),
          descricao: l.descricao,
          tipoArquivo: l.tipoArquivo,
          observacoes: l.observacoes,
        })),
        ...daFamilia('apolices'),
      ],
      // Layout sem companhia própria (a seguradora vem de uma coluna) fica sempre na lista.
      carteira: [
        ...LAYOUTS_CARTEIRA.filter((l) => !l.seguradoraChave || ativa(l.seguradoraChave)).map((l) => ({
          chave: l.chave,
          nome: l.nome,
          seguradora: l.seguradoraChave ? nomeDe(l.seguradoraChave, l.origem) : l.origem,
          sistema: !l.seguradoraChave,
          ...(l.aceita ? { aceita: l.aceita } : {}),
          descricao: l.descricao,
          observacoes: l.observacoes,
        })),
        ...daFamilia('carteira'),
      ],
      financeiro: [
        ...LAYOUTS_FINANCEIRO.filter((l) => !l.interno && ativa(l.seguradoraChave)).map((l) => ({
          chave: l.chave,
          nome: l.nome,
          seguradora: nomeDe(l.seguradoraChave, l.seguradora),
          descricao: l.descricao,
          entidade: l.entidade,
          ...(l.aceita ? { aceita: l.aceita } : {}),
          observacoes: l.observacoes,
        })),
        ...daFamilia('financeiro'),
      ],
      // O que ficou de fora e por quê, para a tela explicar onde reativar.
      ocultos: [...LAYOUTS_APOLICES, ...LAYOUTS_FINANCEIRO]
        .filter((l) => !ativa(l.seguradoraChave))
        .map((l) => ({
          nome: l.nome,
          seguradora: nomeDe(l.seguradoraChave, l.seguradora),
          motivo: cadastro.has(l.seguradoraChave) ? 'inativa' : 'nao_cadastrada',
        })),
    };

    res.json(
      restrito
        ? {
            apolices: [],
            carteira: [],
            financeiro: catalogo.financeiro.filter((l) => l.entidade === 'parcelas'),
            ocultos: [],
          }
        : catalogo,
    );
  } catch (erro) {
    next(erro);
  }
};

export const importarApolicesPelaTela: RequestHandler = async (req, res, next) => {
  try {
    // A chave é validada por `layoutResolvido`, dentro do importador.
    const chave = String(req.query.layout ?? '');

    const simular = req.query.simular === 'true';
    const nome = nomeDoArquivo(req);

    const resultado = await importarApolices(lerGrade(req.body), {
      layout: chave,
      arquivo: nome,
      simular,
      vincularPorNome: req.query.vincular === 'true',
      seguradora: seguradoraDoPedido(req),
    });

    // Só arquiva o que gravou: cópia sem carga correspondente confunde a auditoria.
    const guardado = simular
      ? null
      : await auditoria.guardar({
          lote: resultado.lote,
          conteudo: req.body as Buffer,
          nomeOriginal: nome,
          entidade: 'apolices',
          seguradora: resultado.seguradora,
          layout: chave,
          origemSistema: 'seguradora',
          importadoPor: await idDoUsuario(req),
          resultado: { ...resultado, mapeamento: undefined },
        });

    res.json({ ...resultado, duplicataDe: guardado?.duplicataDe ?? null });
  } catch (erro) {
    next(erro);
  }
};

export const importarFinanceiroPelaTela: RequestHandler = async (req, res, next) => {
  try {
    const chave = String(req.query.layout ?? '');
    const layout = await descritorDoLayout(chave, 'financeiro');

    // A lista filtrada da tela é conveniência; a recusa aqui é a regra.
    if (soParcelas(req) && (layout.entidade !== 'parcelas' || LAYOUTS_FINANCEIRO_POR_CHAVE.get(chave)?.interno)) {
      throw AppError.forbidden('Seu perfil importa apenas relatórios de parcelas pendentes.');
    }

    const simular = req.query.simular === 'true';
    const nome = nomeDoArquivo(req);

    // O extrato da Porto não é carga de `comissoes`: só confere e guarda as ordens em `extratos_comissao`.
    if (chave === 'porto-comissao-extrato') {
      const lote = randomUUID();
      const resultado = await conferirExtrato(lerGrade(req.body), { simular, lote, arquivo: nome });

      const guardado = resultado.gravacao
        ? await auditoria.guardar({
            lote,
            conteudo: req.body as Buffer,
            nomeOriginal: nome,
            entidade: 'comissoes',
            seguradora: layout.seguradora,
            layout: chave,
            origemSistema: 'seguradora',
            importadoPor: await idDoUsuario(req),
            resultado: { ...resultado },
          })
        : null;

      res.json({ ...resultado, duplicataDe: guardado?.duplicataDe ?? null });
      return;
    }

    const resultado =
      ehLayoutDetalheBradesco(chave)
        ? await importarComissaoBradesco(lerGrade(req.body), { layout: chave, arquivo: nome, simular })
        : chave === 'porto-comissao-analitica'
        ? await importarComissaoAnalitica(lerGrade(req.body), {
            layout: chave,
            arquivo: nome,
            simular,
          })
        : chave === 'suhai-comissoes-demonstrativo'
        ? await importarDemonstrativoSuhai(lerGrade(req.body), { layout: chave, arquivo: nome, simular })
        : chave === TOKIO_COMISSOES
        ? await importarExtratoComissaoTokio(lerGrade(req.body), { arquivo: nome, simular })
        : await importarFinanceiro(lerGrade(req.body), {
      layout: chave,
      arquivo: nome,
      simular,
      marcarInadimplentes: req.query.marcarInadimplentes === 'true',
      seguradora: seguradoraDoPedido(req),
    });

    const guardado = simular
      ? null
      : await auditoria.guardar({
          lote: resultado.lote,
          conteudo: req.body as Buffer,
          nomeOriginal: nome,
          entidade: resultado.entidade,
          seguradora: seguradoraDoPedido(req) ?? layout.seguradora,
          layout: chave,
          origemSistema: 'seguradora',
          importadoPor: await idDoUsuario(req),
          resultado: { ...resultado, mapeamento: undefined },
        });

    res.json({ ...resultado, duplicataDe: guardado?.duplicataDe ?? null });
  } catch (erro) {
    next(erro);
  }
};

/** Guarda as correções da conferência e devolve um bilhete para o pedido de importação seguinte. */
export const guardarCorrecoesDaTela: RequestHandler = (req, res, next) => {
  try {
    const corpo = req.body as { correcoes?: unknown };

    if (!Array.isArray(corpo?.correcoes)) {
      throw AppError.unprocessable('Envie a lista de correções.');
    }

    // Mesmo teto da lista de pendências que a tela recebe.
    if (corpo.correcoes.length > 200) {
      throw AppError.unprocessable('Máximo de 200 correções por conferência.');
    }

    const correcoes: Correcao[] = corpo.correcoes.map((c) => {
      const item = c as Record<string, unknown>;
      const linha = Number(item.linha);

      if (!Number.isInteger(linha) || linha < 2) {
        throw AppError.unprocessable('Número de linha inválido na correção.');
      }

      return {
        linha,
        documento: item.documento ? String(item.documento).slice(0, 25) : undefined,
        produtor: item.produtor ? String(item.produtor).slice(0, 120) : undefined,
        ignorar: item.ignorar === true,
      };
    });

    res.json({
      bilhete: guardarCorrecoes(correcoes, usuarioDaRequisicao(req).id),
      total: correcoes.length,
    });
  } catch (erro) {
    next(erro);
  }
};

/** Importa CARTEIRA (cliente e apólice na mesma linha) — a única carga que cadastra cliente. */
export const importarCarteiraPelaTela: RequestHandler = async (req, res, next) => {
  try {
    const chave = String(req.query.layout ?? '');
    const layout = await descritorDoLayout(chave, 'carteira');

    const simular = req.query.simular === 'true';
    const nome = nomeDoArquivo(req);
    const corpo = req.body as Buffer;

    const bilhete = String(req.query.correcoes ?? '').trim();

    let correcoes: Correcao[] | undefined;

    if (bilhete) {
      try {
        correcoes = resgatarCorrecoes(bilhete, usuarioDaRequisicao(req).id);
      } catch (falha) {
        // Gravar sem as correções que a pessoa conferiu seria pior que não gravar.
        throw AppError.unprocessable(
          falha instanceof Error ? falha.message : 'Correções indisponíveis.',
        );
      }
    }

    // PDF só entra pelo layout do Bradesco; em outro, recusa em vez de virar grade de lixo binário.
    const ehPdf = Buffer.isBuffer(corpo) && parecePdf(corpo);
    if (ehPdf && chave !== 'bradesco-historico-apolice') {
      throw AppError.unprocessable(
        'Este layout não lê PDF. PDF só entra pelo "Bradesco — Histórico da apólice (PDF)".',
      );
    }

    const resultado = ehPdf
      ? await importarPdfBradesco(corpo, { arquivo: nome, simular })
      : chave === 'porto-consulta-apolices'
        ? await importarConsultaPorto(lerGrade(corpo), { layout: chave, arquivo: nome, simular })
        : chave === LAYOUT_CONSULTA_PORTAL
          ? await importarConsultaPortalPorto(lerGrade(corpo), { arquivo: nome, simular })
          : chave === TOKIO_EMITIDAS
          ? await importarEmitidasTokio(lerGrade(corpo), { arquivo: nome, simular })
          : chave === TOKIO_CANCELADAS
          ? await importarCanceladasTokio(lerGrade(corpo), { arquivo: nome, simular })
          : chave === LAYOUT_RE_ATIVAS || chave === LAYOUT_RE_ENCERRADAS || chave === LAYOUT_AUTO_ATIVAS
          ? await importarReBradesco(lerGrade(corpo), { layout: chave, arquivo: nome, simular })
          : await importarCarteira(lerGrade(corpo), {
          layout: chave,
          arquivo: nome,
          simular,
          codificacao: Buffer.isBuffer(corpo) ? detectarCodificacao(corpo) : 'utf-8',
          correcoes,
        });

    const guardado = simular
      ? null
      : await auditoria.guardar({
          lote: resultado.lote,
          conteudo: corpo,
          nomeOriginal: nome,
          // `clientes`: o desfazer apaga clientes E apólices do lote.
          entidade: 'clientes',
          seguradora: seguradoraDoPedido(req) ?? layout.seguradora,
          layout: chave,
          origemSistema: 'seguradora',
          importadoPor: await idDoUsuario(req),
          resultado: { ...resultado, mapeamento: undefined },
        });

    res.json({ ...resultado, duplicataDe: guardado?.duplicataDe ?? null });
  } catch (erro) {
    next(erro);
  }
};

export const listarArquivos: RequestHandler = async (_req, res, next) => {
  try {
    res.json({ arquivos: await arquivoRepo.listar(100) });
  } catch (erro) {
    next(erro);
  }
};

/** Devolve a cópia guardada, conferindo o hash antes de entregar. */
export const baixarArquivo: RequestHandler = async (req, res, next) => {
  try {
    const { nome, conteudo } = await auditoria.recuperar(String(req.params.lote));

    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${nome.replace(/[^\w.\- ]/g, '_')}"`,
    );
    res.send(conteudo);
  } catch (erro) {
    next(erro);
  }
};

/** Desfaz uma importação pelo lote; o registro fica marcado como desfeito (com motivo) para a auditoria. */
export const desfazerImportacao: RequestHandler = async (req, res, next) => {
  try {
    const lote = String(req.params.lote);
    const motivo = String((req.body as { motivo?: string } | undefined)?.motivo ?? '').trim();

    if (motivo.length < 5) {
      throw AppError.unprocessable(
        'Descreva por que esta importação está sendo desfeita (mínimo 5 caracteres).',
      );
    }

    const registro = await arquivoRepo.buscarPorLote(lote);
    if (!registro) throw AppError.notFound('Lote não encontrado.');

    const removidos = await arquivoRepo.desfazer(lote, await idDoUsuario(req), motivo);
    const resumo = await apoliceRepo.resumo();

    res.json({ lote, removidos, resumo });
  } catch (erro) {
    next(erro);
  }
};
