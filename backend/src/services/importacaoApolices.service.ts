import { randomUUID } from 'node:crypto';

import { logger } from '../config/logger.js';
import { pool } from '../database/pool.js';
import * as apoliceRepo from '../repositories/apolice.repository.js';
import * as seguradoraRepo from '../repositories/seguradora.repository.js';
import type { OrigemSistema } from '../repositories/cliente.repository.js';
import { AppError } from '../utils/AppError.js';
import { mapearCabecalho, normalizarNomeColuna, type ColunaMapeada } from './colunasImportacao.js';
import {
  COLUNAS_APOLICE,
  LAYOUTS_APOLICES_POR_CHAVE,
  TIPOS_MOVIMENTO_GLOBAIS,
  type TipoMovimento,
} from './modelosApolices.js';

/*
 * Cada linha do arquivo é um MOVIMENTO (emissão, endosso, fatura): agrupa por
 * número e deriva o cabeçalho da apólice. Sem CPF, a apólice entra sem cliente
 * e só se vincula por nome quando casa com exatamente um (`vinculo_origem = 'nome'`).
 */

function texto(valor: string | undefined, maximo: number): string | null {
  const limpo = (valor ?? '').trim().replace(/\s+/g, ' ');
  if (!limpo) return null;
  return limpo.length > maximo ? limpo.slice(0, maximo) : limpo;
}

function somenteDigitos(valor: string | undefined): string | null {
  const limpo = (valor ?? '').replace(/\D/g, '');
  return limpo || null;
}

/** Aceita ISO (`2026-09-21`) e brasileiro (`21/09/2026`). */
function data(valor: string | undefined): string | null {
  const limpo = (valor ?? '').trim();
  if (!limpo) return null;

  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(limpo);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;

  // Hora no fim é aceita: o CSV da Suhai escreve `25/09/2026 00:00:00`.
  const br = /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+\d{1,2}:\d{2}(?::\d{2})?)?$/.exec(limpo);
  if (br) return `${br[3]}-${br[2]!.padStart(2, '0')}-${br[1]!.padStart(2, '0')}`;

  return null;
}

/** Aceita `1330.35` e `1.330,35`: havendo vírgula, ela é o decimal e os pontos são milhar. */
function decimal(valor: string | undefined): string | null {
  const limpo = (valor ?? '').trim().replace(/^R\$\s*/i, '');
  if (!limpo) return null;

  const normalizado = limpo.includes(',')
    ? limpo.replace(/\./g, '').replace(',', '.')
    : limpo;

  const numero = Number(normalizado);
  return Number.isFinite(numero) ? numero.toFixed(2) : null;
}

function classificarMovimento(
  bruto: string | null,
  doLayout: Record<string, TipoMovimento> | undefined,
): { tipo: TipoMovimento; origem: string | null } {
  if (!bruto) return { tipo: 'outro', origem: null };

  const chave = normalizarNomeColuna(bruto);
  const tipo = doLayout?.[chave] ?? TIPOS_MOVIMENTO_GLOBAIS[chave] ?? 'outro';

  return { tipo, origem: bruto.slice(0, 40) };
}

export interface OpcoesImportacaoApolices {
  layout: string;
  arquivo: string;
  simular: boolean;
  origem?: OrigemSistema;
  /** Liga apólices órfãs quando o nome casa com exatamente um cliente. */
  vincularPorNome?: boolean;
  /** Sobrepõe a seguradora do layout (o mesmo formato pode vir de companhias diferentes). */
  seguradora?: string;
}

export interface ResultadoImportacaoApolices {
  lote: string;
  arquivo: string;
  layout: string;
  seguradora: string;
  simulacao: boolean;

  linhas: number;
  recusadas: number;
  motivosDeRecusa: Record<string, number>;

  apolices: number;
  movimentos: number;
  porTipo: Record<string, number>;
  produtos: string[];

  /** Apólices cujo cabeçalho ficou sem vigência/prêmio por só terem movimento derivado. */
  semCabecalhoCompleto: number;

  vinculadas: number;
  /** Ligadas pelo CPF/CNPJ — vínculo exato. */
  vinculadasPorDocumento: number;
  /** Vínculos por nome que o documento corrigiu. */
  vinculosCorrigidos: number;
  semCliente: number;

  mapeamento: ColunaMapeada[];
  colunasIgnoradas: string[];
}

interface LinhaMovimento {
  numero: string;
  produto: string | null;
  nomeSegurado: string;
  documento: string | null;
  sequencia: number;
  tipo: TipoMovimento;
  tipoOrigem: string | null;
  emitidaEm: string | null;
  vigenciaInicio: string | null;
  vigenciaFim: string | null;
  premioTotal: string | null;
  premioLiquido: string | null;
  numeroRenovacao: string | null;
  canceladaEm: string | null;
  motivoCancelamento: string | null;
}

/** Lê a grade (CSV ou planilha, já convertida pelo chamador) e grava apólices e movimentos. */
export async function importarApolices(
  grade: string[][],
  opcoes: OpcoesImportacaoApolices,
): Promise<ResultadoImportacaoApolices> {
  const layout = LAYOUTS_APOLICES_POR_CHAVE.get(opcoes.layout);

  if (!layout) {
    throw AppError.unprocessable(`Layout de apólices desconhecido: ${opcoes.layout}`);
  }

  if (grade.length < 2) {
    throw AppError.unprocessable('O arquivo não tem linhas de dados.');
  }

  const lote = randomUUID();
  const cabecalho = grade[0]!;

  // A companhia precisa estar cadastrada e ativa: criá-la aqui partiria a
  // carteira entre nomes parecidos e ignoraria o interruptor da configuração.
  const cadastro = await seguradoraRepo.porChave(layout.seguradoraChave);

  if (!cadastro) {
    throw AppError.unprocessable(
      `A seguradora "${layout.seguradora}" não está cadastrada. ` +
        'Cadastre-a em Configurações → Seguradoras antes de importar.',
    );
  }

  if (!cadastro.ativa) {
    throw AppError.unprocessable(
      `A seguradora "${cadastro.nome}" está inativa. ` +
        'Reative-a em Configurações → Seguradoras para importar arquivos dela.',
    );
  }

  const nomeSeguradora = cadastro.nome;

  const { indice, colunas } = mapearCabecalho(
    cabecalho,
    new Set<string>(COLUNAS_APOLICE),
    layout.aliases,
  );

  const campo = (linha: string[], nome: string): string | undefined => {
    const i = indice.get(nome);
    return i === undefined ? undefined : linha[i];
  };

  const relatorio = (): string[] =>
    colunas
      .filter((c) => c.origem !== '')
      .map((c) =>
        c.canonica
          ? `  ${c.origem}  →  ${c.canonica}`
          : `  ${c.origem}  →  NÃO RECONHECIDA (chave para o mapa: "${normalizarNomeColuna(c.origem)}")`,
      );

  if (!indice.has('numero_apolice')) {
    throw AppError.unprocessable('Não encontrei a coluna com o número da apólice.', relatorio());
  }

  if (!indice.has('nome_segurado') && !indice.has('cpf_cnpj')) {
    throw AppError.unprocessable(
      'Não encontrei como identificar o segurado (nome ou CPF/CNPJ).',
      relatorio(),
    );
  }

  const movimentos: LinhaMovimento[] = [];
  const recusas: Record<string, number> = {};
  const recusar = (motivo: string): void => {
    recusas[motivo] = (recusas[motivo] ?? 0) + 1;
  };

  let linhasLidas = 0;

  for (const linha of grade.slice(1)) {
    if (!linha.some((c) => (c ?? '').trim() !== '')) continue;
    linhasLidas += 1;

    const numero = texto(campo(linha, 'numero_apolice'), 40);
    if (!numero) {
      recusar('sem número de apólice');
      continue;
    }

    const nomeSegurado = texto(campo(linha, 'nome_segurado'), 150);
    const documento = somenteDigitos(campo(linha, 'cpf_cnpj'));

    if (!nomeSegurado && !documento) {
      recusar('sem identificação do segurado');
      continue;
    }

    const sequenciaBruta = somenteDigitos(campo(linha, 'sequencia'));
    const { tipo, origem } = classificarMovimento(
      texto(campo(linha, 'tipo_emissao'), 40),
      layout.tiposDeMovimento,
    );

    movimentos.push({
      numero,
      produto: texto(campo(linha, 'produto'), 120),
      nomeSegurado: nomeSegurado ?? `(sem nome) ${documento}`,
      documento: documento && (documento.length === 11 || documento.length === 14) ? documento : null,
      // Sem "Emissão" (relatório de uma linha por apólice), é a primeira.
      sequencia: sequenciaBruta ? Number(sequenciaBruta) : 1,
      tipo,
      tipoOrigem: origem,
      emitidaEm: data(campo(linha, 'emitida_em')),
      vigenciaInicio: data(campo(linha, 'vigencia_inicio')),
      vigenciaFim: data(campo(linha, 'vigencia_fim')),
      premioTotal: decimal(campo(linha, 'premio_total')),
      premioLiquido: decimal(campo(linha, 'premio_liquido')),
      numeroRenovacao: texto(campo(linha, 'numero_renovacao'), 40),
      canceladaEm: data(campo(linha, 'cancelada_em')),
      motivoCancelamento: texto(campo(linha, 'motivo_cancelamento'), 120),
    });
  }

  const porNumero = new Map<string, LinhaMovimento[]>();
  for (const m of movimentos) {
    const lista = porNumero.get(m.numero);
    if (lista) lista.push(m);
    else porNumero.set(m.numero, [m]);
  }

  const produtos = [...new Set(movimentos.map((m) => m.produto).filter((p): p is string => !!p))];
  const porTipo: Record<string, number> = {};
  for (const m of movimentos) porTipo[m.tipo] = (porTipo[m.tipo] ?? 0) + 1;

  let semCabecalhoCompleto = 0;

  if (opcoes.simular) {
    // Relatório de CARTEIRA não gera movimento: a prévia não deve anunciá-los.
    const ehCarteira = layout.tipoArquivo === 'carteira';

    if (!ehCarteira) {
      for (const lista of porNumero.values()) {
        if (!lista.some((m) => m.tipo === 'apolice')) semCabecalhoCompleto += 1;
      }
    }

    return {
      lote,
      arquivo: opcoes.arquivo,
      layout: layout.chave,
      seguradora: nomeSeguradora,
      simulacao: true,
      linhas: linhasLidas,
      recusadas: Object.values(recusas).reduce((a, b) => a + b, 0),
      motivosDeRecusa: recusas,
      apolices: porNumero.size,
      movimentos: ehCarteira ? 0 : movimentos.length,
      porTipo: ehCarteira ? {} : porTipo,
      produtos,
      semCabecalhoCompleto,
      vinculadas: 0,
      vinculadasPorDocumento: 0,
      vinculosCorrigidos: 0,
      semCliente: porNumero.size,
      mapeamento: colunas,
      colunasIgnoradas: colunas
        .filter((c) => c.canonica === null && c.origem !== '')
        .map((c) => c.origem),
    };
  }

  const seguradoraId = cadastro.id;

  const cacheProdutos = new Map<string, number>();
  const resolverProduto = async (nome: string | null): Promise<number | null> => {
    if (!nome) return null;
    const emCache = cacheProdutos.get(nome);
    if (emCache !== undefined) return emCache;
    const id = await apoliceRepo.resolverProduto(nome, seguradoraId, null, null);
    cacheProdutos.set(nome, id);
    return id;
  };

  const conexao = await pool.getConnection();
  let gravadasMovimentos = 0;

  // CARTEIRA não gera movimento: um movimento inventado sem prêmio/emissão
  // sobrescreveria com nulo o que o relatório de movimentos já apurou.
  if (layout.tipoArquivo === 'carteira') {
    try {
      await conexao.beginTransaction();

      const carteira: apoliceRepo.ApoliceCarteira[] = [];

      for (const [numero, lista] of porNumero) {
        const linha = lista[0]!;

        carteira.push({
          seguradoraId,
          numero,
          produtoId: await resolverProduto(linha.produto),
          nomeSegurado: linha.nomeSegurado,
          documentoSegurado: linha.documento,
          vigenciaInicio: linha.vigenciaInicio,
          vigenciaFim: linha.vigenciaFim,
          numeroRenovacao: linha.numeroRenovacao,
          canceladaEm: linha.canceladaEm,
          motivoCancelamento: linha.motivoCancelamento,
          origemSistema: opcoes.origem ?? 'seguradora',
          origemArquivo: opcoes.arquivo,
          origemLote: lote,
        });
      }

      await apoliceRepo.inserirCarteira(carteira, conexao);
      await conexao.commit();
    } catch (erro) {
      await conexao.rollback();
      throw erro;
    } finally {
      conexao.release();
    }

    // O documento vence o nome: roda sempre que um arquivo trouxe CPF/CNPJ.
    const porDocumento = await apoliceRepo.vincularPorDocumento();
    const porNome = opcoes.vincularPorNome
      ? await apoliceRepo.vincularPorNomeExato(lote)
      : 0;

    const semClienteAgora = (await apoliceRepo.resumo()).semCliente;

    logger.info(
      { lote, arquivo: opcoes.arquivo, apolices: porNumero.size, porDocumento },
      'Importação de carteira concluída',
    );

    return {
      lote,
      arquivo: opcoes.arquivo,
      layout: layout.chave,
      seguradora: nomeSeguradora,
      simulacao: false,
      linhas: linhasLidas,
      recusadas: Object.values(recusas).reduce((a, b) => a + b, 0),
      motivosDeRecusa: recusas,
      apolices: porNumero.size,
      movimentos: 0,
      porTipo: {},
      produtos,
      semCabecalhoCompleto: 0,
      vinculadas: porDocumento.novos + porNome,
      vinculadasPorDocumento: porDocumento.novos,
      vinculosCorrigidos: porDocumento.corrigidos,
      semCliente: semClienteAgora,
      mapeamento: colunas,
      colunasIgnoradas: colunas
        .filter((c) => c.canonica === null && c.origem !== '')
        .map((c) => c.origem),
    };
  }

  try {
    await conexao.beginTransaction();

    const apolices: apoliceRepo.ApoliceImportada[] = [];

    for (const [numero, lista] of porNumero) {
      const base = lista.find((m) => m.tipo === 'apolice');

      if (!base) semCabecalhoCompleto += 1;

      // O nome mais confiável é o da emissão original; sem ela, o primeiro.
      const referencia = base ?? lista[0]!;

      apolices.push({
        seguradoraId,
        numero,
        produtoId: await resolverProduto(referencia.produto),

        clienteId: null,
        nomeSegurado: referencia.nomeSegurado,
        documentoSegurado: referencia.documento,
        vinculoOrigem: null,

        // Nulos de propósito: o cabeçalho é recalculado depois com TODOS os
        // movimentos gravados, não só os deste arquivo.
        emitidaEm: null,
        vigenciaInicio: null,
        vigenciaFim: null,
        premioTotal: null,
        premioLiquido: null,
        // Nulo preserva, pelo COALESCE do upsert, a comissão que a carteira apurou.
        comissao: null,
        percentualComissao: null,

        origemSistema: opcoes.origem ?? 'seguradora',
        origemArquivo: opcoes.arquivo,
        origemLote: lote,
      });
    }

    await apoliceRepo.inserirApolices(apolices, conexao);

    const ids = await apoliceRepo.mapearIdsPorNumero(
      apolices.map((a) => ({ seguradoraId: a.seguradoraId, numero: a.numero })),
      conexao,
    );

    const linhasMovimento: apoliceRepo.MovimentoImportado[] = [];

    for (const [numero, lista] of porNumero) {
      const apoliceId = ids.get(`${seguradoraId}|${numero}`);
      if (apoliceId === undefined) continue;

      for (const m of lista) {
        linhasMovimento.push({
          apoliceId,
          sequencia: m.sequencia,
          tipo: m.tipo,
          tipoOrigem: m.tipoOrigem,
          emitidaEm: m.emitidaEm,
          vigenciaInicio: m.vigenciaInicio,
          vigenciaFim: m.vigenciaFim,
          premioTotal: m.premioTotal,
          premioLiquido: m.premioLiquido,
          origemLote: lote,
        });
      }
    }

    gravadasMovimentos = await apoliceRepo.inserirMovimentos(linhasMovimento, conexao);

    // Dentro da transação, para acompanhar um eventual rollback dos movimentos.
    await apoliceRepo.recalcularCabecalhos([...ids.values()], conexao);

    await conexao.commit();
  } catch (erro) {
    await conexao.rollback();
    throw erro;
  } finally {
    conexao.release();
  }

  // Documento primeiro: ele é exato e corrige vínculos feitos por nome.
  const porDocumento = await apoliceRepo.vincularPorDocumento();
  const porNome = opcoes.vincularPorNome ? await apoliceRepo.vincularPorNomeExato(lote) : 0;
  const vinculadas = porDocumento.novos + porNome;

  logger.info(
    { lote, arquivo: opcoes.arquivo, apolices: porNumero.size, movimentos: movimentos.length, vinculadas },
    'Importação de apólices concluída',
  );

  return {
    lote,
    arquivo: opcoes.arquivo,
    layout: layout.chave,
    seguradora: nomeSeguradora,
    simulacao: false,
    linhas: linhasLidas,
    recusadas: Object.values(recusas).reduce((a, b) => a + b, 0),
    motivosDeRecusa: recusas,
    apolices: porNumero.size,
    movimentos: gravadasMovimentos,
    porTipo,
    produtos,
    semCabecalhoCompleto,
    vinculadas,
    vinculadasPorDocumento: porDocumento.novos,
    vinculosCorrigidos: porDocumento.corrigidos,
    semCliente: (await apoliceRepo.resumo()).semCliente,
    mapeamento: colunas,
    colunasIgnoradas: colunas
      .filter((c) => c.canonica === null && c.origem !== '')
      .map((c) => c.origem),
  };
}
