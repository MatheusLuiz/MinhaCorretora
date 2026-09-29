import { randomUUID } from 'node:crypto';

import { logger } from '../config/logger.js';
import { pool } from '../database/pool.js';
import * as apoliceRepo from '../repositories/apolice.repository.js';
import * as clienteRepo from '../repositories/cliente.repository.js';
import * as repo from '../repositories/financeiro.repository.js';
import * as encerradaRepo from '../repositories/encerrada.repository.js';
import * as renovacaoRepo from '../repositories/renovacao.repository.js';
import * as sinistroRepo from '../repositories/sinistro.repository.js';
import { resolver as resolverLayout } from './layoutResolvido.js';
import { AppError } from '../utils/AppError.js';
import * as notificacoes from './notificacoes.service.js';
import {
  encontrarLinhaDeCabecalho,
  mapearCabecalho,
  normalizarNomeColuna,
  realinharColunasDeslocadas,
  type ColunaMapeada,
} from './colunasImportacao.js';
import {
  COLUNAS_COMISSAO,
  COLUNAS_ENCERRADA,
  COLUNAS_PARCELA,
  COLUNAS_RENOVACAO,
  COLUNAS_SINISTRO,
  LAYOUTS_FINANCEIRO_POR_CHAVE,
  STATUS_PARCELA,
  type StatusParcela,
} from './modelosFinanceiro.js';

/*
 * Parcelas, comissões, sinistros, renovações e encerradas. Parcela de apólice
 * que ainda não existe cria um cadastro mínimo (recusar esconderia dívida);
 * comissão vem agregada por filial e data, sem cliente.
 */

function texto(valor: string | undefined, maximo: number): string | null {
  const limpo = (valor ?? '').trim().replace(/\s+/g, ' ');
  if (!limpo) return null;
  return limpo.length > maximo ? limpo.slice(0, maximo) : limpo;
}

function inteiro(valor: string | undefined): number | null {
  const d = (valor ?? '').replace(/\D/g, '');
  return d ? Number(d) : null;
}

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

/** Valor monetário, BR ou ponto decimal. Negativo é estorno e passa. */
function decimal(valor: string | undefined): string | null {
  const limpo = (valor ?? '').trim().replace(/^R\$\s*/i, '');
  if (!limpo) return null;

  const normalizado = limpo.includes(',')
    ? limpo.replace(/\./g, '').replace(',', '.')
    : limpo;

  const numero = Number(normalizado);
  return Number.isFinite(numero) ? numero.toFixed(2) : null;
}

/**
 * Porto: `007-1391-100067890` (sucursal-ramo-apólice) reduz ao último bloco,
 * senão a parcela criaria uma apólice paralela. Só três grupos de dígitos.
 */
function numeroDeApolice(bruto: string | undefined): string | undefined {
  const v = (bruto ?? '').trim();
  if (!v) return bruto;

  return /^\d+-\d+-\d+$/.test(v) ? (v.split('-').pop() ?? v) : v;
}

/** Bradesco: o lançamento se identifica pela data + empresa ("Bradesco Vida…" → "VIDA"). */
function numeroPelaDataEFilial(pagoEm: string | null, filial: string | null): string | null {
  if (!pagoEm || !filial) return null;
  const palavras = filial
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .split(/\s+/)
    .filter((p) => p && p !== 'BRADESCO');
  return `${pagoEm} ${palavras[0] ?? 'EMPRESA'}`.slice(0, 20);
}

/**
 * Suhai: recibo `2026/6` que a planilha virou data (`01/06/2026`) volta a ser
 * `AAAA/N` — senão a reimportação duplicaria o lançamento.
 */
function numeroDoRecibo(bruto: string | null): string | null {
  const comoData = /^01\/(\d{2})\/(\d{4})$/.exec(bruto ?? '');
  return comoData ? `${comoData[2]}/${Number(comoData[1])}` : bruto;
}

/** Soma em centavos; null quando nenhuma retenção veio preenchida. */
function somaDeRetencoes(valores: (string | null)[]): string | null {
  const presentes = valores.filter((v): v is string => v !== null);
  if (presentes.length === 0) return null;
  return (presentes.reduce((s, v) => s + Math.round(Number(v) * 100), 0) / 100).toFixed(2);
}

function classificarStatus(bruto: string | null): { status: StatusParcela; origem: string | null } {
  if (!bruto) return { status: 'outro', origem: null };

  const chave = normalizarNomeColuna(bruto);
  return { status: STATUS_PARCELA[chave] ?? 'outro', origem: bruto.slice(0, 40) };
}

/** `Setembro/2026` → `2026-09`. Também aceita `09/2026` e `2026-09`. */
function competencia(bruto: string | null, fallbackArquivo: string): string {
  const MESES: Record<string, string> = {
    janeiro: '01', fevereiro: '02', marco: '03', abril: '04', maio: '05', junho: '06',
    julho: '07', agosto: '08', setembro: '09', outubro: '10', novembro: '11', dezembro: '12',
  };

  const texto = (bruto ?? '').trim();

  const porNome = /^([A-Za-zçÇãÃéÉ]+)\s*\/\s*(\d{4})$/.exec(texto);
  if (porNome) {
    const mes = MESES[normalizarNomeColuna(porNome[1]!)];
    if (mes) return `${porNome[2]}-${mes}`;
  }

  const numerico = /^(\d{1,2})\s*\/\s*(\d{4})$/.exec(texto);
  if (numerico) return `${numerico[2]}-${numerico[1]!.padStart(2, '0')}`;

  const iso = /^(\d{4})-(\d{2})/.exec(texto);
  if (iso) return `${iso[1]}-${iso[2]}`;

  // Último recurso: a competência no nome do arquivo (`comissao_mensal_09_2026.xlsx`).
  const doNome = /(\d{2})[_-](\d{4})/.exec(fallbackArquivo);
  if (doNome) return `${doNome[2]}-${doNome[1]}`;

  return new Date().toISOString().slice(0, 7);
}

export interface OpcoesImportacaoFinanceiro {
  layout: string;
  arquivo: string;
  simular: boolean;
  /** Muda a situação dos clientes com parcela atrasada para `inadimplente`. */
  marcarInadimplentes?: boolean;
  /** Sobrepõe a seguradora do layout. */
  seguradora?: string;
  /** Lote imposto por quem chama — ver `OpcoesCarteira.lote`. */
  lote?: string;
}

export interface ResultadoFinanceiro {
  lote: string;
  arquivo: string;
  layout: string;
  entidade: 'parcelas' | 'comissoes' | 'sinistros' | 'renovacoes' | 'encerradas';
  simulacao: boolean;

  linhas: number;
  gravadas: number;
  recusadas: number;
  motivosDeRecusa: Record<string, number>;

  /** Parcelas: apólices que precisaram ser criadas como cadastro mínimo. */
  apolicesCriadas: number;
  /** Parcelas: quantas ficaram sem cliente, porque a apólice está órfã. */
  semCliente: number;
  /** Parcelas: clientes que seriam (ou foram) marcados inadimplentes. */
  clientesInadimplentes: number;
  inadimplentesMarcados: number;
  /** Parcelas: avisos de PRIMEIRO atraso criados para os corretores. */
  corretoresAvisados?: number;
  /** Parcelas: clientes no primeiro atraso sem corretor com usuário para avisar. */
  primeiroAtrasoSemCorretor?: number;
  /** Parcelas: cadastros consertados com o nome/telefone limpos da cobrança. */
  nomesDesmascarados?: number;
  telefonesGanhos?: number;

  /** Sinistros: quantos de cada tipo, e quantos ficaram sem cliente. */
  sinistros?: number;
  assistencias?: number;
  sinistrosSemCliente?: number;

  /** Renovações: quantas, quantas com prêmio calculado, sem cliente e % levado à apólice. */
  renovacoes?: number;
  renovacoesComPremio?: number;
  renovacoesSemCliente?: number;
  renovacoesComissaoNaApolice?: number;

  /** Encerradas: quantas, quantas renovadas (mesmo veículo), antes do prazo e sem cliente. */
  encerradas?: number;
  encerradasRenovadas?: number;
  encerradasAntesDoPrazo?: number;
  encerradasSemCliente?: number;

  /** Comissões: competência apurada e soma líquida. */
  competencia?: string;
  totalLiquido?: number;

  mapeamento: ColunaMapeada[];
  colunasIgnoradas: string[];
  /** Em que linha da planilha o cabeçalho foi encontrado (base 1). */
  linhaDoCabecalho: number;
}

export async function importarFinanceiro(
  grade: string[][],
  opcoes: OpcoesImportacaoFinanceiro,
): Promise<ResultadoFinanceiro> {
  const doCodigo = LAYOUTS_FINANCEIRO_POR_CHAVE.get(opcoes.layout);
  const layout = await resolverLayout(opcoes.layout, doCodigo, 'financeiro');

  if (!layout.entidade) {
    throw AppError.unprocessable(
      `O modelo "${layout.nome}" não diz se é de parcelas ou de comissões. ` +
        'Corrija o cadastro do modelo antes de importar.',
    );
  }

  const conhecidas = new Set<string>(
    layout.entidade === 'parcelas'
      ? COLUNAS_PARCELA
      : layout.entidade === 'sinistros'
        ? COLUNAS_SINISTRO
        : layout.entidade === 'renovacoes'
          ? COLUNAS_RENOVACAO
          : layout.entidade === 'encerradas'
            ? COLUNAS_ENCERRADA
            : COLUNAS_COMISSAO,
  );

  // O demonstrativo tem título e totalizador antes da tabela: busca por conteúdo.
  const indiceCabecalho = encontrarLinhaDeCabecalho(grade, layout.aliases, conhecidas);

  if (indiceCabecalho < 0) {
    throw AppError.unprocessable(
      'Não encontrei a linha de cabeçalho nesta planilha.',
      (grade[0] ?? []).filter(Boolean).map((c) => `  ${c}  →  "${normalizarNomeColuna(c)}"`),
    );
  }

  if (doCodigo?.colunasDeslocadas) {
    try {
      grade = realinharColunasDeslocadas(grade, indiceCabecalho);
    } catch (erro) {
      throw AppError.unprocessable(erro instanceof Error ? erro.message : 'Colunas desalinhadas.');
    }
  }

  const { indice, colunas } = mapearCabecalho(
    grade[indiceCabecalho]!,
    conhecidas,
    layout.aliases,
  );

  const campo = (linha: string[], nome: string): string | undefined => {
    const i = indice.get(nome);
    return i === undefined ? undefined : linha[i];
  };

  const lote = opcoes.lote ?? randomUUID();
  const recusas: Record<string, number> = {};
  const recusar = (motivo: string): void => {
    recusas[motivo] = (recusas[motivo] ?? 0) + 1;
  };

  const dados = grade.slice(indiceCabecalho + 1).filter((l) => l.some((c) => (c ?? '').trim()));

  const base = {
    lote,
    arquivo: opcoes.arquivo,
    layout: layout.chave,
    entidade: layout.entidade,
    simulacao: opcoes.simular,
    linhas: dados.length,
    motivosDeRecusa: recusas,
    mapeamento: colunas,
    colunasIgnoradas: colunas
      .filter((c) => c.canonica === null && c.origem !== '')
      .map((c) => c.origem),
    linhaDoCabecalho: indiceCabecalho + 1,
  };

  // Cadastrada e ativa: `layoutResolvido` já validou.
  const seguradoraId = layout.seguradoraId ?? 0;

  if (layout.entidade === 'parcelas') {
    if (!indice.has('numero_apolice')) {
      throw AppError.unprocessable(
        'Não encontrei a coluna com o número da apólice.',
        colunas.filter((c) => c.origem).map((c) => `  ${c.origem}  →  ${c.canonica ?? 'NÃO RECONHECIDA'}`),
      );
    }

    interface LinhaParcela {
      numeroApolice: string;
      nomeSegurado: string;
      produto: string | null;
      sequencia: number;
      numero: number;
      vencimento: string | null;
      vencimentoOriginal: string | null;
      valor: string | null;
      iof: string | null;
      formaPagamento: string | null;
      /** Do CADASTRO, não da parcela — a cobrança traz sem máscara. */
      telefone: string | null;
      status: StatusParcela;
      statusOrigem: string | null;
      motivoRejeicao: string | null;
      dataRejeicao: string | null;
    }

    const linhas: LinhaParcela[] = [];

    for (const l of dados) {
      const numeroApolice = texto(numeroDeApolice(campo(l, 'numero_apolice')), 40);

      // Rodapé (Porto repete título e filtros depois dos dados, com `Valor = 0.00`)
      // não é recusa: só conta quem tem valor ou parcela sem apólice.
      if (!numeroApolice) {
        const temValor = Number(decimal(campo(l, 'valor')) ?? 0) !== 0;
        const temParcela = (inteiro(campo(l, 'numero_parcela')) ?? 0) > 0;

        if (temValor || temParcela) recusar('sem número de apólice');
        continue;
      }

      const numero = inteiro(campo(l, 'numero_parcela'));
      if (numero === null) {
        recusar('sem número de parcela');
        continue;
      }

      const bruto = texto(campo(l, 'status'), 40);
      const diasAtraso = inteiro(campo(l, 'dias_atraso'));
      // Sem status: decidem os dias de atraso; senão o `statusPadrao` do layout.
      const { status, origem } = bruto
        ? classificarStatus(bruto)
        : diasAtraso !== null
          ? { status: diasAtraso > 0 ? ('atrasado' as const) : ('aberto' as const), origem: `${diasAtraso} dia(s) de atraso` }
          : { status: doCodigo?.statusPadrao ?? 'outro', origem: null };

      linhas.push({
        numeroApolice,
        nomeSegurado: texto(campo(l, 'nome_segurado'), 150) ?? '(sem nome)',
        produto: texto(campo(l, 'produto'), 120),
        sequencia: inteiro(campo(l, 'sequencia_emissao')) ?? 1,
        numero,
        vencimento: data(campo(l, 'vencimento')),
        vencimentoOriginal: data(campo(l, 'vencimento_original')),
        valor: decimal(campo(l, 'valor')),
        iof: decimal(campo(l, 'iof')),
        formaPagamento: texto(campo(l, 'forma_pagamento'), 40),
        telefone: texto(campo(l, 'telefone'), 30),
        status,
        statusOrigem: origem,
        motivoRejeicao: texto(campo(l, 'motivo_rejeicao'), 120),
        dataRejeicao: data(campo(l, 'data_rejeicao')),
      });
    }

    if (opcoes.simular) {
      const numeros = [...new Set(linhas.map((l) => l.numeroApolice))];
      const existentes = await apoliceRepo.mapearIdsPorNumero(
        numeros.map((n) => ({ seguradoraId, numero: n })),
      );

      return {
        ...base,
        gravadas: 0,
        recusadas: Object.values(recusas).reduce((a, b) => a + b, 0),
        apolicesCriadas: numeros.length - existentes.size,
        semCliente: 0,
        clientesInadimplentes: 0,
        inadimplentesMarcados: 0,
      };
    }

    // Apólice que falta entra como cadastro mínimo, senão a dívida some do total.
    const porNumero = new Map<string, LinhaParcela>();
    for (const l of linhas) if (!porNumero.has(l.numeroApolice)) porNumero.set(l.numeroApolice, l);

    const antes = await apoliceRepo.mapearIdsPorNumero(
      [...porNumero.keys()].map((n) => ({ seguradoraId, numero: n })),
    );

    const faltantes = [...porNumero.values()].filter(
      (l) => !antes.has(`${seguradoraId}|${l.numeroApolice}`),
    );

    let gravadas = 0;
    let enriquecidos = { nomes: 0, telefones: 0 };
    const conexao = await pool.getConnection();

    try {
      await conexao.beginTransaction();

      if (faltantes.length > 0) {
        const cacheProduto = new Map<string, number>();

        const novas: apoliceRepo.ApoliceCarteira[] = [];
        for (const l of faltantes) {
          let produtoId: number | null = null;

          if (l.produto) {
            const emCache = cacheProduto.get(l.produto);
            produtoId =
              emCache ?? (await apoliceRepo.resolverProduto(l.produto, seguradoraId, null, null, conexao));
            cacheProduto.set(l.produto, produtoId);
          }

          novas.push({
            seguradoraId,
            numero: l.numeroApolice,
            produtoId,
            nomeSegurado: l.nomeSegurado,
            documentoSegurado: null,
            vigenciaInicio: null,
            vigenciaFim: null,
            numeroRenovacao: null,
            canceladaEm: null,
            motivoCancelamento: null,
            origemSistema: 'seguradora',
            origemArquivo: opcoes.arquivo,
            origemLote: lote,
          });
        }

        await apoliceRepo.inserirCarteira(novas, conexao);
      }

      const ids = await apoliceRepo.mapearIdsPorNumero(
        [...porNumero.keys()].map((n) => ({ seguradoraId, numero: n })),
        conexao,
      );

      const aGravar: repo.ParcelaImportada[] = [];

      for (const l of linhas) {
        const apoliceId = ids.get(`${seguradoraId}|${l.numeroApolice}`);
        if (apoliceId === undefined) {
          recusar('apólice não pôde ser criada');
          continue;
        }

        aGravar.push({
          apoliceId,
          sequenciaEmissao: l.sequencia,
          numero: l.numero,
          vencimento: l.vencimento,
          vencimentoOriginal: l.vencimentoOriginal,
          valor: l.valor,
          iof: l.iof,
          formaPagamento: l.formaPagamento,
          status: l.status,
          statusOrigem: l.statusOrigem,
          motivoRejeicao: l.motivoRejeicao,
          dataRejeicao: l.dataRejeicao,
          origemArquivo: opcoes.arquivo,
          origemLote: lote,
        });
      }

      gravadas = await repo.inserirParcelas(aGravar, conexao);

      // A cobrança da Porto é a única fonte de nome e telefone sem máscara.
      enriquecidos = await clienteRepo.enriquecerPeloSegurado(
        linhas.map((l) => ({
          apoliceId: ids.get(`${seguradoraId}|${l.numeroApolice}`) ?? 0,
          nome: l.nomeSegurado,
          telefone: l.telefone,
        })),
        conexao,
      );

      await conexao.commit();
    } catch (erro) {
      await conexao.rollback();
      throw erro;
    } finally {
      conexao.release();
    }

    await apoliceRepo.vincularPorDocumento();

    const emPotencial = await repo.contarInadimplentesEmPotencial();
    const marcados = opcoes.marcarInadimplentes ? await repo.marcarInadimplentes() : 0;

    // Depois do commit: o aviso de primeiro atraso aponta para parcelas gravadas.
    const aviso = await notificacoes.avisarPrimeiroAtraso();

    const resumoAtual = await repo.resumo();

    logger.info(
      { lote, arquivo: opcoes.arquivo, parcelas: gravadas, marcados },
      'Importação de parcelas concluída',
    );

    return {
      ...base,
      gravadas,
      recusadas: Object.values(recusas).reduce((a, b) => a + b, 0),
      apolicesCriadas: faltantes.length,
      semCliente: resumoAtual.apolicesComAtraso - resumoAtual.clientesInadimplentes,
      clientesInadimplentes: emPotencial,
      inadimplentesMarcados: marcados,
      corretoresAvisados: aviso.avisos,
      primeiroAtrasoSemCorretor: aviso.semDestinatario,
      nomesDesmascarados: enriquecidos.nomes,
      telefonesGanhos: enriquecidos.telefones,
    };
  }

  if (layout.entidade === 'encerradas') {
    if (!indice.has('numero_apolice') || !indice.has('vigencia_fim')) {
      throw AppError.unprocessable(
        'Este arquivo não parece uma lista de apólices encerradas: falta o número da apólice ou o fim da vigência.',
        colunas.filter((c) => c.origem).map((c) => `  ${c.origem}  →  ${c.canonica ?? 'NÃO RECONHECIDA'}`),
      );
    }

    const itens: encerradaRepo.EncerradaImportada[] = [];

    for (const l of dados) {
      // "639-0 / 251167": a apólice é o último pedaço; a sucursal, o primeiro.
      const bruto = (campo(l, 'numero_apolice') ?? '').trim();
      const partes = bruto.split('/').map((p) => p.trim());
      const numeroApolice = texto(partes[partes.length - 1], 40);
      const vigenciaFim = data(campo(l, 'vigencia_fim'));
      const nome = texto(campo(l, 'nome_segurado'), 150);
      if (!numeroApolice || !vigenciaFim || !nome) {
        recusar(!numeroApolice ? 'sem número de apólice' : !vigenciaFim ? 'sem fim de vigência' : 'sem segurado');
        continue;
      }

      const placa = (campo(l, 'placa') ?? '').replace(/[^a-z0-9]/gi, '').toUpperCase();
      const endosso = (campo(l, 'teve_endosso') ?? '').trim().toUpperCase();

      itens.push({
        seguradoraId,
        numeroApolice,
        sucursal: partes.length > 1 ? texto(partes[0]!.split('-')[0], 10) : null,
        nomeSegurado: nome,
        // "AAVISAR" é zero km sem placa — guardá-la juntaria carros diferentes.
        placa: /^[A-Z]{3}\d[A-Z0-9]\d{2}$/.test(placa) ? placa : null,
        teveEndosso: endosso.startsWith('S') ? true : endosso.startsWith('N') ? false : null,
        emitidaEm: data(campo(l, 'emitida_em')),
        vigenciaInicio: data(campo(l, 'vigencia_inicio')),
        vigenciaFim,
        origemArquivo: opcoes.arquivo,
        origemLote: lote,
      });
    }

    const antesDoPrazo = itens.filter(
      (i) =>
        i.vigenciaInicio !== null &&
        (Date.parse(i.vigenciaFim) - Date.parse(i.vigenciaInicio)) / 86_400_000 < 350,
    ).length;

    if (opcoes.simular) {
      return {
        ...base,
        gravadas: 0,
        recusadas: Object.values(recusas).reduce((a, b) => a + b, 0),
        apolicesCriadas: 0,
        semCliente: 0,
        clientesInadimplentes: 0,
        inadimplentesMarcados: 0,
        encerradas: itens.length,
        encerradasAntesDoPrazo: antesDoPrazo,
      };
    }

    const conexao = await pool.getConnection();
    let gravadas = 0;
    let vinculo = { porApolice: 0, renovadas: 0, porNome: 0, semVinculo: 0 };

    try {
      await conexao.beginTransaction();
      gravadas = await encerradaRepo.inserirEncerradas(itens, conexao);
      vinculo = await encerradaRepo.vincularEncerradas(seguradoraId, conexao);
      await conexao.commit();
    } catch (erro) {
      await conexao.rollback();
      throw erro;
    } finally {
      conexao.release();
    }

    logger.info(
      { lote, arquivo: opcoes.arquivo, encerradas: itens.length, ...vinculo },
      'Importação de apólices encerradas concluída',
    );

    return {
      ...base,
      gravadas,
      recusadas: Object.values(recusas).reduce((a, b) => a + b, 0),
      apolicesCriadas: 0,
      semCliente: 0,
      clientesInadimplentes: 0,
      inadimplentesMarcados: 0,
      encerradas: itens.length,
      encerradasRenovadas: vinculo.renovadas,
      encerradasAntesDoPrazo: antesDoPrazo,
      encerradasSemCliente: vinculo.semVinculo,
    };
  }

  if (layout.entidade === 'renovacoes') {
    if (!indice.has('numero_apolice') || !indice.has('vigencia_fim')) {
      throw AppError.unprocessable(
        'Este arquivo não parece uma lista de apólices a renovar: falta o número da apólice ou o fim da vigência.',
        colunas.filter((c) => c.origem).map((c) => `  ${c.origem}  →  ${c.canonica ?? 'NÃO RECONHECIDA'}`),
      );
    }

    const simNao = (v: string | undefined): boolean | null => {
      const t = (v ?? '').trim().toUpperCase();
      return t === 'S' || t === 'SIM' ? true : t === 'N' || t === 'NAO' || t === 'NÃO' ? false : null;
    };

    const itens: renovacaoRepo.RenovacaoImportada[] = [];

    for (const l of dados) {
      const numeroApolice = texto(campo(l, 'numero_apolice'), 40);
      const vigenciaFim = data(campo(l, 'vigencia_fim'));
      const nome = texto(campo(l, 'nome_segurado'), 150);
      if (!numeroApolice || !vigenciaFim || !nome) {
        recusar(!numeroApolice ? 'sem número de apólice' : !vigenciaFim ? 'sem fim de vigência' : 'sem segurado');
        continue;
      }

      // Placa fora do padrão ("AAV-ISAR", a avisar) é carro sem placa.
      const placa = (campo(l, 'placa') ?? '').replace(/[^a-z0-9]/gi, '').toUpperCase();
      // "..." sozinho é modelo que o portal cortou até sumir.
      const veiculo = texto(campo(l, 'veiculo'), 120);
      const percentual = decimal(campo(l, 'percentual_comissao'));
      const premio = decimal(campo(l, 'premio_renovacao'));

      itens.push({
        seguradoraId,
        numeroApolice,
        vigenciaFim,
        nomeSegurado: nome,
        sucursal: texto(campo(l, 'sucursal'), 10),
        agencia: texto(campo(l, 'agencia'), 10),
        percentualComissao: percentual === null ? null : Number(percentual),
        veiculo: veiculo && !/^\.+$/.test(veiculo) ? veiculo : null,
        placa: /^[A-Z]{3}\d[A-Z0-9]\d{2}$/.test(placa) ? placa : null,
        sinistros: inteiro(campo(l, 'sinistros')),
        classeBonus: inteiro(campo(l, 'classe_bonus')),
        // "-" é renovação ainda não calculada — não é prêmio zero.
        premioRenovacao: premio === null || Number(premio) === 0 ? null : Number(premio),
        cotadoOutroCorretor: simNao(campo(l, 'cotado_outro_corretor')),
        temResidencial: simNao(campo(l, 'tem_residencial')),
        origemArquivo: opcoes.arquivo,
        origemLote: lote,
      });
    }

    const comPremio = itens.filter((i) => i.premioRenovacao !== null).length;

    if (opcoes.simular) {
      return {
        ...base,
        gravadas: 0,
        recusadas: Object.values(recusas).reduce((a, b) => a + b, 0),
        apolicesCriadas: 0,
        semCliente: 0,
        clientesInadimplentes: 0,
        inadimplentesMarcados: 0,
        renovacoes: itens.length,
        renovacoesComPremio: comPremio,
      };
    }

    const conexao = await pool.getConnection();
    let gravadas = 0;
    let vinculo = { porApolice: 0, porNome: 0, semVinculo: 0, comissaoNaApolice: 0 };

    try {
      await conexao.beginTransaction();
      gravadas = await renovacaoRepo.inserirRenovacoes(itens, conexao);
      vinculo = await renovacaoRepo.vincularRenovacoes(seguradoraId, conexao);
      await conexao.commit();
    } catch (erro) {
      await conexao.rollback();
      throw erro;
    } finally {
      conexao.release();
    }

    logger.info(
      { lote, arquivo: opcoes.arquivo, renovacoes: itens.length, ...vinculo },
      'Importação de apólices a renovar concluída',
    );

    return {
      ...base,
      gravadas,
      recusadas: Object.values(recusas).reduce((a, b) => a + b, 0),
      apolicesCriadas: 0,
      semCliente: 0,
      clientesInadimplentes: 0,
      inadimplentesMarcados: 0,
      renovacoes: itens.length,
      renovacoesComPremio: comPremio,
      renovacoesSemCliente: vinculo.semVinculo,
      renovacoesComissaoNaApolice: vinculo.comissaoNaApolice,
    };
  }

  if (layout.entidade === 'sinistros') {
    if (!indice.has('numero_sinistro') || !indice.has('numero_apolice')) {
      throw AppError.unprocessable(
        'Este arquivo não parece um relatório de sinistros: falta o número do sinistro ou da apólice.',
        colunas.filter((c) => c.origem).map((c) => `  ${c.origem}  →  ${c.canonica ?? 'NÃO RECONHECIDA'}`),
      );
    }

    const sinistros: sinistroRepo.SinistroImportado[] = [];

    for (const l of dados) {
      const numero = texto(campo(l, 'numero_sinistro'), 30);
      const numeroApolice = texto(campo(l, 'numero_apolice'), 40);
      if (!numero || !numeroApolice) {
        recusar(numero ? 'sem número de apólice' : 'sem número do sinistro');
        continue;
      }

      const ramo = texto(campo(l, 'ramo'), 80);
      const placa = texto(campo(l, 'placa'), 10);

      sinistros.push({
        seguradoraId,
        numero,
        numeroApolice,
        nomeSinistrado: texto(campo(l, 'nome_segurado'), 150),
        // Ramo "42 - ASSIST 24h" (Suhai) é assistência, não sinistro.
        tipo: /assist/i.test(ramo ?? '') ? 'assistencia' : 'sinistro',
        ramo,
        cobertura: texto(campo(l, 'cobertura'), 120),
        causa: texto(campo(l, 'causa'), 120),
        ocorridoEm: data(campo(l, 'ocorrido_em')),
        comunicadoEm: data(campo(l, 'comunicado_em')),
        statusProcesso: texto(campo(l, 'status_processo'), 40),
        statusMovimento: texto(campo(l, 'status_movimento'), 40),
        reserva: decimal(campo(l, 'reserva')),
        reservaRo: decimal(campo(l, 'reserva_ro')),
        // `YYY9999` é veículo zero sem placa na Suhai.
        placa: placa && !/^Y{3}9{4}$/i.test(placa) ? placa.toUpperCase() : null,
        veiculo: texto(campo(l, 'veiculo'), 150),
        origemArquivo: opcoes.arquivo,
        origemLote: lote,
      });
    }

    const assistencias = sinistros.filter((s) => s.tipo === 'assistencia').length;

    if (opcoes.simular) {
      return {
        ...base,
        gravadas: 0,
        recusadas: Object.values(recusas).reduce((a, b) => a + b, 0),
        apolicesCriadas: 0,
        semCliente: 0,
        clientesInadimplentes: 0,
        inadimplentesMarcados: 0,
        sinistros: sinistros.length - assistencias,
        assistencias,
      };
    }

    const conexao = await pool.getConnection();
    let gravadas = 0;
    let vinculo = { porApolice: 0, porNome: 0, semVinculo: 0 };

    try {
      await conexao.beginTransaction();
      gravadas = await sinistroRepo.inserirSinistros(sinistros, conexao);
      vinculo = await sinistroRepo.vincularSinistros(seguradoraId, conexao);
      await conexao.commit();
    } catch (erro) {
      await conexao.rollback();
      throw erro;
    } finally {
      conexao.release();
    }

    logger.info(
      { lote, arquivo: opcoes.arquivo, sinistros: sinistros.length, ...vinculo },
      'Importação de sinistros concluída',
    );

    return {
      ...base,
      gravadas,
      recusadas: Object.values(recusas).reduce((a, b) => a + b, 0),
      apolicesCriadas: 0,
      semCliente: 0,
      clientesInadimplentes: 0,
      inadimplentesMarcados: 0,
      sinistros: sinistros.length - assistencias,
      assistencias,
      sinistrosSemCliente: vinculo.semVinculo,
    };
  }

  // Comissões.
  if ((!indice.has('numero') && !doCodigo?.numeroPelaDataEFilial) || !indice.has('total_liquido')) {
    throw AppError.unprocessable(
      'Este arquivo não parece o demonstrativo de comissão.',
      colunas.filter((c) => c.origem).map((c) => `  ${c.origem}  →  ${c.canonica ?? 'NÃO RECONHECIDA'}`),
    );
  }

  // A competência fica no totalizador, ACIMA do cabeçalho.
  const acimaDoCabecalho = grade
    .slice(0, indiceCabecalho)
    .flat()
    .filter(Boolean)
    .join(' ');

  const mesAno = /([A-Za-zçÇ]+\s*\/\s*\d{4})/.exec(acimaDoCabecalho)?.[1] ?? null;
  const comp = competencia(mesAno, opcoes.arquivo);

  const lancamentos: repo.ComissaoImportada[] = [];

  for (const l of dados) {
    const pagoEm = data(campo(l, 'pago_em'));
    const filial = texto(campo(l, 'filial'), 80);
    const totalBruto = decimal(campo(l, 'total_bruto'));
    const totalLiquido = decimal(campo(l, 'total_liquido'));

    // Dia sem crédito (Bradesco): bruto e líquido zerados não são pagamento.
    if (doCodigo?.recusarValorZero && Number(totalBruto ?? 0) === 0 && Number(totalLiquido ?? 0) === 0) {
      recusar('crédito zerado — não houve pagamento no dia');
      continue;
    }

    const bruto = texto(campo(l, 'numero'), 20);
    const numero = doCodigo?.numeroPelaDataEFilial
      ? numeroPelaDataEFilial(pagoEm, filial)
      : doCodigo?.reciboAnoBarraNumero
        ? numeroDoRecibo(bruto)
        : bruto;
    if (!numero) {
      recusar(doCodigo?.numeroPelaDataEFilial ? 'sem data ou empresa do lançamento' : 'sem número do lançamento');
      continue;
    }

    const estabelecimento = texto(campo(l, 'codigo_estabelecimento'), doCodigo?.estabelecimentoSoDigitos ? 200 : 20);
    const impostos =
      decimal(campo(l, 'impostos')) ??
      somaDeRetencoes([campo(l, 'irrf'), campo(l, 'iss'), campo(l, 'inss')].map(decimal)) ??
      (doCodigo?.impostosPelaDiferenca && totalBruto !== null && totalLiquido !== null
        ? (Math.round((Number(totalBruto) - Number(totalLiquido)) * 100) / 100).toFixed(2)
        : null);

    lancamentos.push({
      seguradoraId,
      competencia: doCodigo?.competenciaPeloPagamento && pagoEm ? pagoEm.slice(0, 7) : comp,
      corretora: texto(campo(l, 'corretora'), 120),
      filial,
      codigoCliente: texto(campo(l, 'codigo_cliente'), 20),
      codigoEstabelecimento:
        doCodigo?.estabelecimentoSoDigitos && estabelecimento
          ? estabelecimento.replace(/\D/g, '').slice(0, 20) || null
          : estabelecimento,
      numero,
      tipo: texto(campo(l, 'tipo'), 40),
      totalBruto,
      desconto: decimal(campo(l, 'desconto')),
      impostos,
      totalLiquido,
      pagoEm,
      formaPagamento: texto(campo(l, 'forma_pagamento'), 40),
      origemArquivo: opcoes.arquivo,
      origemLote: lote,
    });
  }

  const somaLiquida = lancamentos.reduce((s, l) => s + Number(l.totalLiquido ?? 0), 0);

  if (opcoes.simular) {
    return {
      ...base,
      gravadas: 0,
      recusadas: Object.values(recusas).reduce((a, b) => a + b, 0),
      apolicesCriadas: 0,
      semCliente: 0,
      clientesInadimplentes: 0,
      inadimplentesMarcados: 0,
      competencia: comp,
      totalLiquido: somaLiquida,
    };
  }

  const gravadas = await repo.inserirComissoes(lancamentos);

  logger.info(
    { lote, arquivo: opcoes.arquivo, competencia: comp, lancamentos: gravadas },
    'Importação de comissões concluída',
  );

  return {
    ...base,
    gravadas,
    recusadas: Object.values(recusas).reduce((a, b) => a + b, 0),
    apolicesCriadas: 0,
    semCliente: 0,
    clientesInadimplentes: 0,
    inadimplentesMarcados: 0,
    competencia: comp,
    totalLiquido: somaLiquida,
  };
}
