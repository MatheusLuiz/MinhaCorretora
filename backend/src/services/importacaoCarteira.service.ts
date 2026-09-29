import { createHash, randomUUID } from 'node:crypto';

import { pool } from '../database/pool.js';
import * as apoliceRepo from '../repositories/apolice.repository.js';
import * as clienteRepo from '../repositories/cliente.repository.js';
import * as seguradoraRepo from '../repositories/seguradora.repository.js';
import { cnpjEhValido, cpfEhValido, formatarDocumento } from '../utils/documento.js';
import { AppError } from '../utils/AppError.js';
import { mapearCabecalho, normalizarNomeColuna } from './colunasImportacao.js';
import { resolver as resolverLayout } from './layoutResolvido.js';
import { LAYOUTS_CARTEIRA_POR_CHAVE, type LayoutCarteira } from './modelosCarteira.js';

/*
 * Importação de CARTEIRA: cliente e apólice na mesma linha (relatório de vigentes).
 * ACRESCENTA, nunca espelha: o arquivo só traz nome/documento/produtor, e
 * espelhar apagaria telefone, e-mail e endereço de quem já está na base.
 */

/** Linha que o importador não resolve sozinho; sobe editável para a tela. */
export interface Pendencia {
  /** Linha no arquivo, contando o cabeçalho como 1 (como no Excel). */
  linha: number;
  tipo:
    | 'sem_documento'
    | 'documento_invalido'
    | 'sem_apolice'
    | 'apolice_ilegivel'
    | 'sem_corretor';
  /** O que impede, em uma frase. */
  descricao: string;
  /** Se dá para resolver digitando, e qual campo. */
  corrigivel: 'documento' | 'produtor' | null;

  nome: string;
  documento: string;
  apolice: string;
  seguradora: string;
  produtor: string;
}

/** O que a tela devolve preenchido, por linha. */
export interface Correcao {
  linha: number;
  documento?: string;
  produtor?: string;
  /** Tira a linha da carga — usado quando o dado não existe mesmo. */
  ignorar?: boolean;
}

export interface ResultadoCarteira {
  lote: string;
  arquivo: string;
  layout: string;
  simulacao: boolean;
  codificacao: string;

  linhas: number;
  recusadas: number;
  motivosDeRecusa: Record<string, number>;

  clientes: {
    novos: number;
    existentes: number;
    gravados: number;
    /** Contatos gravados. Mascarados pelo portal são descartados, não contam. */
    emails: number;
    telefones: number;
    /** Quantos mudaram de situação no recálculo que roda ao fim da carga. */
    ativados: number;
    inativados: number;
  };
  apolices: {
    novas: number;
    existentes: number;
    gravadas: number;
    semNumero: number;
    numeroIlegivel: number;
    vinculadas: number;
    /** Entraram com identificador provisório, por não terem número utilizável. */
    provisorias: number;
    /** Provisórias que receberam o número verdadeiro nesta carga. */
    promovidas: number;
    /** Provisórias que trocaram `PROV-<hash>` pelo `PROP-<proposta>`. */
    renumeradas: number;
    /** Provisórias descartadas por já existir a mesma apólice com número real. */
    duplicatasRemovidas: number;
  };

  seguradorasNovas: string[];
  mapeamento: { origem: string; canonica: string | null; via: string | null }[];
  colunasIgnoradas: string[];
  amostraIlegivel: string[];

  /** Limitada a MAXIMO_PENDENCIAS; o total continua nos contadores. */
  pendencias: Pendencia[];
  pendenciasOcultas: number;
  /** Quantas de cada tipo o arquivo tem, inclusive as que não couberam na lista. */
  pendenciasPorTipo: Record<string, number>;
  /** Documentos digitados na correção que já têm dono na base (pode ser erro de digitação). */
  documentosJaCadastrados: { linha: number; documento: string; cliente: string }[];
}

export interface OpcoesCarteira {
  layout: string;
  arquivo: string;
  simular: boolean;
  codificacao?: string;
  /** Preenchimentos feitos na tela, por número de linha. */
  correcoes?: Correcao[];
  /** Lote imposto por quem chama: o PDF do Bradesco vira carteira + parcelas no MESMO lote. */
  lote?: string;
}

const MAXIMO_PENDENCIAS = 200;

/** Situação declarada pela companhia. Valor desconhecido vira null, nunca 'ativa'. */
const SITUACOES_CIA: Record<string, 'ativa' | 'cancelada' | 'nao_vigente' | 'suspensa'> = {
  ATIVO: 'ativa',
  ATIVA: 'ativa',
  VIGENTE: 'ativa',
  CANCELADO: 'cancelada',
  CANCELADA: 'cancelada',
  'NAO VIGENTE': 'nao_vigente',
  SUSPENSO: 'suspensa',
  SUSPENSA: 'suspensa',
};

function situacaoDaCompanhia(
  valor: string | undefined,
): 'ativa' | 'cancelada' | 'nao_vigente' | 'suspensa' | null {
  const chave = (valor ?? '')
    .trim()
    .toUpperCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');

  return SITUACOES_CIA[chave] ?? null;
}

/** Ordem das pendências por acionabilidade: o que bloqueia e tem conserto vem antes. */
const PRIORIDADE: Record<Pendencia['tipo'], number> = {
  documento_invalido: 1,
  sem_documento: 2,
  sem_apolice: 3,
  sem_corretor: 4,
  apolice_ilegivel: 5,
};

/** Teto da coleta: arquivo mal formatado não monta um array gigante só para cortar. */
const MAXIMO_COLETADO = 5_000;

/**
 * Número de apólice destruído pelo Excel (float): `3,1002E+14` colapsa centenas
 * de apólices diferentes num texto só. Irrecuperável aqui.
 */
function numeroIlegivel(valor: string): boolean {
  const v = valor.trim();

  if (/^[\d.,]+E[+-]?\d+$/i.test(v)) return true;

  // Float expandido com milhar (`28.522.026.004.106.500.000.000`); apólice real tem até 16 dígitos.
  return apenasDigitos(v).length > 20;
}

const apenasDigitos = (v: string): string => v.replace(/\D/g, '');

/** Tira o milhar que o Excel pôs no número (só dígitos em grupos de três), senão a mesma apólice vira duas. */
function normalizarNumeroApolice(bruto: string): string {
  const v = bruto.trim();
  return /^\d{1,3}(\.\d{3})+$/.test(v) ? v.replace(/\./g, '') : v;
}

/**
 * Identidade do contrato sem o número: ponte para trocar o provisório pelo
 * número verdadeiro numa reimportação, sem duplicar a apólice.
 */
function chaveNaturalDoContrato(r: LinhaCarteira): string {
  const partes = [
    r.seguradora.trim().toUpperCase(),
    r.documento,
    r.vigenciaInicio ?? '',
    r.vigenciaFim ?? '',
    r.premioTotal ?? '',
    (r.produto ?? '').trim().toUpperCase(),
  ];

  return createHash('sha1').update(partes.join('|')).digest('hex');
}

/**
 * Identificador provisório: `PROP-<proposta>` (achável na origem) ou, sem
 * proposta, `PROV-<hash>`. Derivado, não aleatório, para reimportar sem duplicar.
 */
function numeroProvisorio(chaveNatural: string, proposta: string | null): string {
  const p = (proposta ?? '').trim();
  return p ? `PROP-${p}` : `PROV-${chaveNatural.slice(0, 12)}`;
}

/**
 * Valor mascarado pelo portal (LGPD); a máscara muda por campo:
 * nome `Fulano XXXXer` (X no COMEÇO de pedaço de palavra, antes de minúscula —
 * `FICTIXX` não é máscara), telefone `9XX45-XX67`, e-mail `jxxxxxxx2@` (minúsculo).
 */
function mascarado(valor: string | null | undefined, campo: 'nome' | 'telefone' | 'email'): boolean {
  const v = valor ?? '';
  if (!v) return false;

  if (campo === 'telefone') return /X{2,}/.test(v);
  if (campo === 'nome') return /(?:^|[^\p{L}])X{2,}\p{Ll}/u.test(v);

  // Só antes do @: um domínio pode conter "xxx" legitimamente.
  return /x{4,}/i.test(v.split('@')[0] ?? '');
}

/**
 * CNPJ com 15 dígitos (zero à esquerda) perde o zero; CPF da Suhai, gravado
 * como número, recupera os zeros da frente (o dígito verificador confere depois).
 */
export function normalizarDocumento(bruto: string): string {
  let d = (bruto ?? '').replace(/\D/g, '');

  if (d.length === 15 && d.startsWith('0')) d = d.slice(1);
  if (d.length === 12 && d.startsWith('0')) d = d.slice(1);

  if (d.length >= 9 && d.length <= 10) d = d.padStart(11, '0');
  if (d.length === 13) d = d.padStart(14, '0');

  return d;
}

/** Primeiro valor não vazio entre colunas candidatas (produtor muda de coluna conforme a campanha). */
function primeiroPreenchido(
  linha: string[],
  colunas: number[],
  max: number,
): string | null {
  for (const i of colunas) {
    const v = texto(linha[i], max);
    if (v) return v;
  }
  return null;
}

/** `DD/MM/AAAA` → `AAAA-MM-DD`; aceita hora no fim (CSV da Suhai). */
function data(bruto: string | undefined): string | null {
  const v = (bruto ?? '').trim();
  if (!v) return null;

  const br = v.match(/^(\d{2})\/(\d{2})\/(\d{4})(?:\s+\d{1,2}:\d{2}(?::\d{2})?)?$/);
  if (br) return `${br[3]}-${br[2]}-${br[1]}`;

  const iso = v.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return iso ? `${iso[1]}-${iso[2]}-${iso[3]}` : null;
}

/**
 * `10.811,84` → `10811.84`. Célula numérica de .xlsx chega `297.07`: sem
 * vírgula, o ponto só é milhar quando separa grupos de três.
 */
function decimal(bruto: string | undefined): string | null {
  const v = (bruto ?? '').trim();
  if (!v) return null;

  const brasileiro = v.includes(',') || /^-?\d{1,3}(\.\d{3})+$/.test(v);
  const n = Number(brasileiro ? v.replace(/\./g, '').replace(',', '.') : v);
  return Number.isFinite(n) && n !== 0 ? n.toFixed(2) : null;
}

/** Líquido + adicional + IOF; sem líquido não há total (adicional vazio conta zero). */
function premioTotalSomado(
  liquido: string | null,
  adicional: string | null,
  iof: string | null,
): string | null {
  if (liquido === null) return null;

  const centavos = [liquido, adicional, iof].reduce(
    (soma, v) => soma + (v === null ? 0 : Math.round(Number(v) * 100)),
    0,
  );
  return (centavos / 100).toFixed(2);
}

/** Para comparar nomes: sem acento, sem caixa, espaços únicos. */
function semAcento(v: string): string {
  return v
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/** "Inadimplência — parcela 1 de 12": a apólice não tem outra coluna para a parcela. */
function motivoDoCancelamento(
  motivo: string | null,
  parcela: string | null,
  total: string | null,
): string | null {
  if (!motivo) return null;
  if (!parcela) return motivo;
  return `${motivo} — parcela ${parcela}${total ? ` de ${total}` : ''}`;
}

function texto(bruto: string | undefined, max = 150): string | null {
  const v = (bruto ?? '').trim().replace(/\s+/g, ' ');
  return v ? v.slice(0, max) : null;
}

interface LinhaCarteira {
  documento: string;
  nome: string;
  nomeSocial: string | null;
  seguradora: string;
  produto: string | null;
  ramo: string | null;
  produtor: string | null;
  estrutura: string | null;
  apolice: string | null;
  vigenciaInicio: string | null;
  vigenciaFim: string | null;
  emitidaEm: string | null;
  premioTotal: string | null;
  premioLiquido: string | null;
  /** O que a apólice GERA, não o que foi pago (não somar com o demonstrativo). */
  comissao: string | null;
  percentualComissao: string | null;
  tipoNegocio: 'novo' | 'renovacao' | null;
  numeroProposta: string | null;
  propostaCia: string | null;
  email: string | null;
  celular: string | null;
  nascimento: string | null;
  sexo: 'M' | 'F' | null;
  endereco: {
    logradouro: string | null;
    numero: string | null;
    complemento: string | null;
    bairro: string | null;
    cidade: string | null;
    uf: string | null;
    cep: string | null;
  } | null;
  celula: string | null;
  possuiSinistro: boolean | null;
  /** O que a COMPANHIA declara. null = esta origem não informa. */
  situacaoCia: 'ativa' | 'cancelada' | 'nao_vigente' | 'suspensa' | null;
  endosso: string | null;
  canceladaEm: string | null;
  motivoCancelamento: string | null;
  canalCodigo: string | null;
  canalNome: string | null;
  seguradoraCodigo: string | null;
  produtoCodigo: string | null;

  chaveNatural?: string;
  /** O número da origem se perdeu; o atual é provisório. */
  provisoria?: boolean;
}

/**
 * Monta o número de várias colunas quando o layout pede (Porto: `ramo-sucursal-apólice`,
 * como nas outras portas da Porto). Acrescenta uma coluna ao fim da grade.
 */
function comNumeroMontado(grade: string[][], layout: LayoutCarteira | undefined): string[][] {
  const regra = layout?.montarNumero;
  if (!regra) return grade;
  const cabecalho = (grade[0] ?? []).map((c) => normalizarNomeColuna(c));
  const posicoes = regra.partes.map((p) => cabecalho.indexOf(p));
  const reserva = regra.senao ? cabecalho.indexOf(regra.senao) : -1;
  // O leitor de .xlsx corta as células vazias do fim da linha: completar, senão
  // o número montado cai numa coluna do meio.
  const largura = (grade[0] ?? []).length;
  return grade.map((linha, i) => {
    if (i === 0) return [...linha, regra.coluna];
    const partes = posicoes.map((p) => (p >= 0 ? (linha[p] ?? '').trim() : ''));
    const numero = partes.every(Boolean)
      ? partes.join('-')
      : reserva >= 0
        ? (linha[reserva] ?? '').trim()
        : '';
    const completa = linha.length < largura ? [...linha, ...Array<string>(largura - linha.length).fill('')] : linha;
    return [...completa, numero];
  });
}

export async function importarCarteira(
  gradeRecebida: string[][],
  opcoes: OpcoesCarteira,
): Promise<ResultadoCarteira> {
  if (gradeRecebida.length < 2) {
    throw AppError.unprocessable(
      'O arquivo não tem linhas de dados. Verifique se ele foi anexado corretamente.',
    );
  }

  // Layout do código (com tratamentos próprios) ou do cadastro de modelos.
  const doCodigo: LayoutCarteira | undefined = LAYOUTS_CARTEIRA_POR_CHAVE.get(opcoes.layout);
  const grade = comNumeroMontado(gradeRecebida, doCodigo);
  const layout = await resolverLayout(opcoes.layout, doCodigo, 'carteira');

  const origemSistema = 'seguradora' as const;

  const lote = opcoes.lote ?? randomUUID();
  const cabecalho = grade[0] ?? [];

  // O mapa global de `mapearCabecalho` não conhece "numero_apolice".
  const CONHECIDAS = new Set([
    'cpf_cnpj', 'nome_civil', 'nome_social', 'seguradora', 'produto',
    'ramo_descricao', 'produtor', 'estrutura_vendas', 'numero_apolice',
    'vigencia_inicio', 'vigencia_fim', 'emitida_em', 'premio_total', 'premio_liquido',
    'premio_adicional', 'premio_iof',
    'comissao', 'percentual_comissao', 'tipo_negocio',
    'numero_proposta', 'proposta_cia', 'celula', 'possui_sinistro',
    'canal_codigo', 'canal_nome', 'seguradora_codigo', 'produto_codigo',
    'situacao_cia', 'endosso',
    'cancelada_em', 'motivo_cancelamento', 'parcela_cancelada', 'qtd_parcelas', 'corretora',
    'email', 'celular', 'data_nascimento', 'sexo',
    'logradouro', 'numero_endereco', 'complemento', 'bairro', 'cidade', 'uf', 'cep',
  ]);

  const mapa = mapearCabecalho(cabecalho, CONHECIDAS, layout.aliases);

  // Várias colunas podem mapear para a mesma canônica (produtor: RENOVAÇÕES, NOVOS...).
  const colunasDe = (canonica: string): number[] =>
    mapa.colunas
      .map((m, i) => (m.canonica === canonica ? i : -1))
      .filter((i) => i >= 0);

  const coluna = (canonica: string): number => colunasDe(canonica)[0] ?? -1;

  const colunasProdutor = colunasDe('produtor');

  const col = {
    documento: coluna('cpf_cnpj'),
    nome: coluna('nome_civil'),
    nomeSocial: coluna('nome_social'),
    seguradora: coluna('seguradora'),
    produto: coluna('produto'),
    ramo: coluna('ramo_descricao'),
    produtor: coluna('produtor'),
    estrutura: coluna('estrutura_vendas'),
    apolice: coluna('numero_apolice'),
    vigenciaInicio: coluna('vigencia_inicio'),
    vigenciaFim: coluna('vigencia_fim'),
    emissao: coluna('emitida_em'),
    premioTotal: coluna('premio_total'),
    premioLiquido: coluna('premio_liquido'),
    premioAdicional: coluna('premio_adicional'),
    premioIof: coluna('premio_iof'),
    comissao: coluna('comissao'),
    percentualComissao: coluna('percentual_comissao'),
    tipoNegocio: coluna('tipo_negocio'),
    numeroProposta: coluna('numero_proposta'),
    propostaCia: coluna('proposta_cia'),
    celula: coluna('celula'),
    possuiSinistro: coluna('possui_sinistro'),
    situacaoCia: coluna('situacao_cia'),
    endosso: coluna('endosso'),
    canceladaEm: coluna('cancelada_em'),
    motivoCancelamento: coluna('motivo_cancelamento'),
    parcelaCancelada: coluna('parcela_cancelada'),
    qtdParcelas: coluna('qtd_parcelas'),
    corretora: coluna('corretora'),
    canalCodigo: coluna('canal_codigo'),
    canalNome: coluna('canal_nome'),
    seguradoraCodigo: coluna('seguradora_codigo'),
    produtoCodigo: coluna('produto_codigo'),
    email: coluna('email'),
    celular: coluna('celular'),
    nascimento: coluna('data_nascimento'),
    sexo: coluna('sexo'),
    logradouro: coluna('logradouro'),
    numeroEndereco: coluna('numero_endereco'),
    complemento: coluna('complemento'),
    bairro: coluna('bairro'),
    cidade: coluna('cidade'),
    uf: coluna('uf'),
    cep: coluna('cep'),
  };

  // Relatório de portal é de uma companhia só (no layout): aí a coluna não é obrigatória.
  const obrigatorias: string[] = ['documento', 'nome'];
  if (!layout.seguradora) obrigatorias.push('seguradora');

  const faltando = obrigatorias.filter((c) => col[c as keyof typeof col] < 0);
  if (faltando.length > 0) {
    throw new Error(
      `O arquivo não tem as colunas obrigatórias: ${faltando.join(', ')}. ` +
        `Cabeçalho lido: ${cabecalho.map(normalizarNomeColuna).filter(Boolean).join(', ')}`,
    );
  }

  const motivos: Record<string, number> = {};
  const recusar = (motivo: string): void => {
    motivos[motivo] = (motivos[motivo] ?? 0) + 1;
  };

  const porDocumento = new Map<string, LinhaCarteira>();

  // Chave seguradora|número|SEGURADO: número de apólice não identifica pessoa.
  const porApolice = new Map<string, LinhaCarteira>();

  const chaveDaApolice = (r: LinhaCarteira): string =>
    `${r.seguradora.toUpperCase()}|${r.apolice}|${r.documento}`;
  const amostraIlegivel: string[] = [];

  const correcoes = new Map<number, Correcao>(
    (opcoes.correcoes ?? []).map((c) => [c.linha, c]),
  );

  const pendencias: Pendencia[] = [];
  let pendenciasOcultas = 0;

  // Contrato sem número utilizável entra com identificador provisório: é carteira vigente.
  const guardarProvisoria = (r: LinhaCarteira): void => {
    const chave = chaveNaturalDoContrato(r);

    r.chaveNatural = chave;
    r.apolice = numeroProvisorio(chave, r.numeroProposta);
    r.provisoria = true;

    porApolice.set(chaveDaApolice(r), r);
  };

  const pendenciasPorTipo: Record<string, number> = {};

  // O corte por prioridade acontece no fim.
  const pendente = (
    linhaNum: number,
    tipo: Pendencia['tipo'],
    descricao: string,
    corrigivel: Pendencia['corrigivel'],
    dados: { nome?: string; documento?: string; apolice?: string; seguradora?: string; produtor?: string },
  ): void => {
    pendenciasPorTipo[tipo] = (pendenciasPorTipo[tipo] ?? 0) + 1;

    if (pendencias.length >= MAXIMO_COLETADO) {
      pendenciasOcultas += 1;
      return;
    }

    pendencias.push({
      linha: linhaNum,
      tipo,
      descricao,
      corrigivel,
      nome: dados.nome ?? '',
      documento: dados.documento ?? '',
      apolice: dados.apolice ?? '',
      seguradora: dados.seguradora ?? '',
      produtor: dados.produtor ?? '',
    });
  };

  let semNumero = 0;
  let ilegiveis = 0;
  let lidas = 0;

  for (let i = 1; i < grade.length; i += 1) {
    const linha = grade[i];
    if (!linha || linha.every((c) => !(c ?? '').trim())) continue;

    lidas += 1;

    const numeroNoArquivo = i + 1;
    const correcao = correcoes.get(numeroNoArquivo);

    if (correcao?.ignorar) {
      recusar('removida na conferência');
      continue;
    }

    const nome = texto(linha[col.nome]);
    const seguradoraBruta = texto(linha[col.seguradora], 60);
    const apoliceCrua = col.apolice >= 0 ? texto(linha[col.apolice], 40) : null;
    const apoliceBruta = apoliceCrua ? normalizarNumeroApolice(apoliceCrua) : null;
    const produtorDoArquivo = primeiroPreenchido(linha, colunasProdutor, 120);

    // O que a tela preencheu vence o que o arquivo trouxe.
    const documento = correcao?.documento
      ? normalizarDocumento(correcao.documento)
      : normalizarDocumento(linha[col.documento] ?? '');

    const produtor = correcao?.produtor?.trim() || produtorDoArquivo;

    const contexto = {
      nome: nome ?? '',
      documento: (linha[col.documento] ?? '').trim(),
      apolice: apoliceBruta ?? '',
      seguradora: seguradoraBruta ?? '',
      produtor: produtorDoArquivo ?? '',
    };

    if (!documento) {
      recusar('sem CPF/CNPJ');
      pendente(numeroNoArquivo, 'sem_documento',
        'A linha não traz CPF/CNPJ. Sem ele não há como saber de quem é o cadastro.',
        'documento', contexto);
      continue;
    }

    const valido =
      documento.length === 11
        ? cpfEhValido(documento)
        : documento.length === 14
          ? cnpjEhValido(documento)
          : false;

    if (!valido) {
      recusar('CPF/CNPJ inválido — não fecha o dígito verificador');
      pendente(numeroNoArquivo, 'documento_invalido',
        `"${contexto.documento}" não fecha o dígito verificador.`,
        'documento', contexto);
      continue;
    }

    if (!nome) {
      recusar('sem nome do cliente');
      continue;
    }

    // Linha de OUTRA corretora não entra (a Suhai repete cada cancelamento por corretor).
    if (doCodigo?.corretora && col.corretora >= 0) {
      const daLinha = texto(linha[col.corretora]);
      if (daLinha && semAcento(daLinha) !== semAcento(doCodigo.corretora)) {
        recusar(`de outra corretora (${daLinha})`);
        continue;
      }
    }

    const seguradora = seguradoraBruta ?? layout.seguradora ?? null;

    if (!seguradora) {
      recusar('sem seguradora');
      continue;
    }

    const registro: LinhaCarteira = {
      documento,
      nome,
      nomeSocial: col.nomeSocial >= 0 ? texto(linha[col.nomeSocial]) : null,
      seguradora,
      // Sem coluna de produto, o ramo faz as vezes dele (Suhai); senão some do prêmio por ramo.
      produto:
        col.produto >= 0
          ? texto(linha[col.produto], 120)
          : col.ramo >= 0
            ? texto(linha[col.ramo], 120)
            : null,
      ramo: col.ramo >= 0 ? texto(linha[col.ramo], 60) : null,
      produtor,
      estrutura: col.estrutura >= 0 ? texto(linha[col.estrutura], 120) : null,
      apolice: apoliceBruta,
      vigenciaInicio: col.vigenciaInicio >= 0 ? data(linha[col.vigenciaInicio]) : null,
      vigenciaFim: col.vigenciaFim >= 0 ? data(linha[col.vigenciaFim]) : null,
      emitidaEm: col.emissao >= 0 ? data(linha[col.emissao]) : null,
      premioTotal:
        col.premioTotal >= 0
          ? decimal(linha[col.premioTotal])
          : premioTotalSomado(
              decimal(linha[col.premioLiquido]),
              decimal(linha[col.premioAdicional]),
              decimal(linha[col.premioIof]),
            ),
      premioLiquido: col.premioLiquido >= 0 ? decimal(linha[col.premioLiquido]) : null,
      comissao: col.comissao >= 0 ? decimal(linha[col.comissao]) : null,
      percentualComissao:
        col.percentualComissao >= 0 ? decimal(linha[col.percentualComissao]) : null,
      tipoNegocio:
        col.tipoNegocio >= 0
          ? ((linha[col.tipoNegocio] ?? '').trim().toUpperCase() === 'N'
              ? 'novo'
              : (linha[col.tipoNegocio] ?? '').trim().toUpperCase() === 'R'
                ? 'renovacao'
                : null)
          : null,

      numeroProposta: col.numeroProposta >= 0 ? texto(linha[col.numeroProposta], 30) : null,
      propostaCia: col.propostaCia >= 0 ? texto(linha[col.propostaCia], 40) : null,
      celula: col.celula >= 0 ? texto(linha[col.celula], 40) : null,
      // Vazio fica null, não false: "não sabemos" ≠ "não teve sinistro".
      possuiSinistro:
        col.possuiSinistro >= 0
          ? ((linha[col.possuiSinistro] ?? '').trim().toUpperCase() === 'S'
              ? true
              : (linha[col.possuiSinistro] ?? '').trim().toUpperCase() === 'N'
                ? false
                : null)
          : null,
      // Data de cancelamento vale como situação mesmo sem coluna de status.
      situacaoCia:
        col.canceladaEm >= 0 && data(linha[col.canceladaEm])
          ? 'cancelada'
          : col.situacaoCia >= 0
            ? situacaoDaCompanhia(linha[col.situacaoCia])
            : null,
      canceladaEm: col.canceladaEm >= 0 ? data(linha[col.canceladaEm]) : null,
      motivoCancelamento:
        col.canceladaEm >= 0 && data(linha[col.canceladaEm])
          ? motivoDoCancelamento(
              // O da linha vence o fixo do layout (a Tokio manda um por apólice).
              texto(linha[col.motivoCancelamento], 80) ?? doCodigo?.motivoCancelamento ?? null,
              texto(linha[col.parcelaCancelada], 5),
              texto(linha[col.qtdParcelas], 5),
            )
          : // Cancelada sem data (Bradesco RE encerradas): só o motivo.
            col.situacaoCia >= 0 && situacaoDaCompanhia(linha[col.situacaoCia]) === 'cancelada'
            ? texto(linha[col.motivoCancelamento], 80)
            : null,
      // "0" da Porto = sem endosso.
      endosso:
        col.endosso >= 0
          ? ((t) => (t && t !== '0' ? t : null))(texto(linha[col.endosso], 20))
          : null,
      canalCodigo: col.canalCodigo >= 0 ? texto(linha[col.canalCodigo], 20) : null,
      canalNome: col.canalNome >= 0 ? texto(linha[col.canalNome], 80) : null,
      seguradoraCodigo: col.seguradoraCodigo >= 0 ? texto(linha[col.seguradoraCodigo], 20) : null,
      produtoCodigo: col.produtoCodigo >= 0 ? texto(linha[col.produtoCodigo], 20) : null,
      email: col.email >= 0 ? texto(linha[col.email], 120) : null,
      celular: col.celular >= 0 ? texto(linha[col.celular], 30) : null,
      nascimento: col.nascimento >= 0 ? data(linha[col.nascimento]) : null,
      sexo: col.sexo >= 0
        ? ((s) => (s === 'M' || s === 'F' ? s : null))((linha[col.sexo] ?? '').trim().toUpperCase().charAt(0))
        : null,
      // Só com logradouro ou CEP: cidade sozinha ocuparia a vaga do endereço de verdade.
      endereco:
        (col.logradouro >= 0 && texto(linha[col.logradouro])) || (col.cep >= 0 && texto(linha[col.cep]))
          ? {
              logradouro: col.logradouro >= 0 ? texto(linha[col.logradouro], 150) : null,
              numero: col.numeroEndereco >= 0 ? texto(linha[col.numeroEndereco], 10) : null,
              complemento: col.complemento >= 0 ? texto(linha[col.complemento], 60) : null,
              bairro: col.bairro >= 0 ? texto(linha[col.bairro], 60) : null,
              cidade: col.cidade >= 0 ? texto(linha[col.cidade], 80) : null,
              uf: col.uf >= 0 ? texto(linha[col.uf], 2) : null,
              cep: col.cep >= 0 ? (linha[col.cep] ?? '').replace(/\D/g, '').slice(0, 8) || null : null,
            }
          : null,
    };

    // Endosso descreve a alteração, não o contrato: prêmio, emissão e início nulos
    // para o COALESCE preservar o cabeçalho; fim e situação seguem.
    if (registro.endosso) {
      registro.premioTotal = null;
      registro.premioLiquido = null;
      registro.comissao = null;
      registro.percentualComissao = null;
      registro.emitidaEm = null;
      registro.vigenciaInicio = null;
    }

    // A última vence: o arquivo vem por data, e a mais recente traz o produtor atual.
    porDocumento.set(documento, registro);

    if (!registro.produtor) {
      pendente(numeroNoArquivo, 'sem_corretor',
        'Nenhuma coluna de campanha traz o corretor desta venda.',
        'produtor', { ...contexto, documento: formatarDocumento(documento) });
    }

    if (!registro.apolice) {
      semNumero += 1;
      pendente(numeroNoArquivo, 'sem_apolice',
        'A linha não traz número de apólice. O contrato entra com identificador provisório.',
        null, { ...contexto, documento: formatarDocumento(documento) });

      guardarProvisoria(registro);
      continue;
    }

    if (numeroIlegivel(registro.apolice)) {
      ilegiveis += 1;
      if (amostraIlegivel.length < 5 && !amostraIlegivel.includes(registro.apolice)) {
        amostraIlegivel.push(registro.apolice);
      }
      // Não corrigível: o caminho é reexportar sem o Excel, e a promoção troca o provisório.
      pendente(numeroNoArquivo, 'apolice_ilegivel',
        `"${registro.apolice}" é o que sobrou do número depois do Excel. O contrato entra; o número, não.`,
        null, { ...contexto, documento: formatarDocumento(documento) });

      guardarProvisoria(registro);
      continue;
    }

    // Emissão e endosso no mesmo arquivo: o endosso só acrescenta (chega com prêmio nulo).
    const anterior = porApolice.get(chaveDaApolice(registro));
    if (anterior && registro.endosso) {
      anterior.endosso = registro.endosso;
      anterior.vigenciaFim = registro.vigenciaFim ?? anterior.vigenciaFim;
      anterior.situacaoCia = registro.situacaoCia ?? anterior.situacaoCia;
      continue;
    }

    // Com número real também leva a chave natural, para promover uma provisória já gravada.
    registro.chaveNatural = chaveNaturalDoContrato(registro);
    porApolice.set(chaveDaApolice(registro), registro);
  }

  const recusadas = Object.values(motivos).reduce((a, b) => a + b, 0);

  pendencias.sort((a, b) => PRIORIDADE[a.tipo] - PRIORIDADE[b.tipo] || a.linha - b.linha);

  const totalPendencias = Object.values(pendenciasPorTipo).reduce((a, b) => a + b, 0);
  const listadas = pendencias.slice(0, MAXIMO_PENDENCIAS);
  pendenciasOcultas = totalPendencias - listadas.length;
  pendencias.length = 0;
  pendencias.push(...listadas);

  const mapeamento = mapa.colunas.map((m) => ({
    origem: m.origem,
    canonica: m.canonica,
    via: m.via,
  }));
  const colunasIgnoradas = mapa.colunas
    .filter((m) => m.origem && !m.canonica)
    .map((m) => m.origem);

  const documentos = [...porDocumento.keys()];
  const jaCadastrados = await clienteRepo.mapearIdsPorDocumento(documentos);

  // Só o que foi DIGITADO: a tela mostra de quem é o CPF, para pegar erro de digitação.
  const documentosJaCadastrados: ResultadoCarteira['documentosJaCadastrados'] = [];

  const digitados = (opcoes.correcoes ?? []).filter((c) => c.documento && !c.ignorar);

  if (digitados.length > 0) {
    const nomes = await clienteRepo.nomesPorDocumento(
      digitados.map((c) => normalizarDocumento(c.documento!)),
    );

    for (const c of digitados) {
      const d = normalizarDocumento(c.documento!);
      const dono = nomes.get(d);
      if (dono) {
        documentosJaCadastrados.push({
          linha: c.linha,
          documento: formatarDocumento(d),
          cliente: dono,
        });
      }
    }
  }

  const seguradorasDoArquivo = [
    ...new Set([...porDocumento.values(), ...porApolice.values()].map((r) => r.seguradora)),
  ];
  const seguradorasNovas = await naoCadastradas(seguradorasDoArquivo);

  const apolicesExistentes = await contarApolicesExistentes([...porApolice.keys()]);

  const base = {
    lote,
    arquivo: opcoes.arquivo,
    layout: opcoes.layout,
    simulacao: opcoes.simular,
    codificacao: opcoes.codificacao ?? 'utf-8',
    linhas: lidas,
    recusadas,
    motivosDeRecusa: motivos,
    mapeamento,
    colunasIgnoradas,
    amostraIlegivel,
    pendencias,
    pendenciasOcultas,
    pendenciasPorTipo,
    documentosJaCadastrados,
  };

  if (opcoes.simular) {
    return {
      ...base,
      clientes: {
        novos: documentos.length - jaCadastrados.size,
        existentes: jaCadastrados.size,
        gravados: 0,
        emails: 0,
        telefones: 0,
        ativados: 0,
        inativados: 0,
      },
      apolices: {
        novas: porApolice.size - apolicesExistentes,
        existentes: apolicesExistentes,
        gravadas: 0,
        semNumero,
        numeroIlegivel: ilegiveis,
        vinculadas: 0,
        provisorias: [...porApolice.values()].filter((r) => r.provisoria).length,
        promovidas: 0,
        renumeradas: 0,
        duplicatasRemovidas: 0,
      },
      seguradorasNovas,
    };
  }

  const conexao = await pool.getConnection();

  let clientesGravados = 0;
  let apolicesGravadas = 0;
  let emailsGravados = 0;
  let telefonesGravados = 0;
  let promovidas = 0;
  let renumeradas = 0;
  let duplicatasRemovidas = 0;

  try {
    await conexao.beginTransaction();

    const situacoes = await clienteRepo.listarSituacoes();
    const ativoId = situacoes.find((s) => s.chave === 'ativo')?.id ?? null;

    const produtores = new Map<string, number>();
    const estruturas = new Map<string, number>();
    const seguradoras = new Map<string, number>();
    const produtos = new Map<string, number>();
    const ramos = new Map<string, number>();
    const canais = new Map<string, number>();

    // As duas coleções: `porDocumento` só tem a última linha do cliente, e o
    // vendedor de uma apólice mais antiga ficaria de fora.
    for (const r of [...porDocumento.values(), ...porApolice.values()]) {
      if (r.produtor && !produtores.has(r.produtor)) {
        produtores.set(r.produtor, await clienteRepo.resolverDimensao('produtores', r.produtor, conexao));
      }
      if (r.estrutura && !estruturas.has(r.estrutura)) {
        estruturas.set(
          r.estrutura,
          await clienteRepo.resolverEstrutura(null, r.estrutura, conexao),
        );
      }
      if (r.ramo && !ramos.has(r.ramo)) {
        ramos.set(r.ramo, await clienteRepo.resolverDimensao('ramos', r.ramo, conexao));
      }
      if (r.canalNome && !canais.has(r.canalNome)) {
        canais.set(r.canalNome, await apoliceRepo.resolverCanal(r.canalNome, r.canalCodigo, conexao));
      }
    }

    const codigoDaSeguradora = new Map<string, string | null>();
    for (const r of [...porDocumento.values(), ...porApolice.values()]) {
      if (r.seguradoraCodigo && !codigoDaSeguradora.has(r.seguradora)) {
        codigoDaSeguradora.set(r.seguradora, r.seguradoraCodigo);
      }
    }

    for (const nome of seguradorasDoArquivo) {
      seguradoras.set(
        nome,
        await clienteRepo.resolverSeguradora(nome, codigoDaSeguradora.get(nome) ?? null, conexao),
      );
    }

    const clientes = [...porDocumento.values()].map((r) => ({
      origemSistema,
      origemArquivo: opcoes.arquivo,
      origemLote: lote,
      cpfCnpj: formatarDocumento(r.documento),
      cpfCnpjNumeros: r.documento,
      tipoPessoa: (r.documento.length === 14 ? 'J' : 'F') as 'F' | 'J',
      nome: r.nome,
      nomeSocial: r.nomeSocial,
      profissaoId: null,
      estadoCivilId: null,
      sexo: r.sexo,
      dataNascimento: r.nascimento,
      vip: false,
      autorizaContato: false,
      situacaoId: ativoId,
      situacaoEm: null,
      saidaEm: null,
      produtorId: r.produtor ? (produtores.get(r.produtor) ?? null) : null,
      estruturaVendaId: r.estrutura ? (estruturas.get(r.estrutura) ?? null) : null,
      origemClienteId: null,
      faixaRendaId: null,
      faturamentoAnual: null,
      clienteDesde: null,
      ultimaAlteracao: null,
    }));

    clientesGravados = await clienteRepo.inserirClientesPreservando(clientes, conexao);

    const idsPorDocumento = await clienteRepo.mapearIdsPorDocumento(documentos, conexao);

    // Contato mascarado é descartado: ocuparia a vaga única (cliente, tipo) do número real.
    const emails: clienteRepo.EmailImportado[] = [];
    const telefones: clienteRepo.TelefoneImportado[] = [];

    for (const r of porDocumento.values()) {
      const clienteId = idsPorDocumento.get(r.documento);
      if (!clienteId) continue;

      if (r.email && r.email.includes('@') && !mascarado(r.email, 'email')) {
        emails.push({
          clienteId,
          tipo: 'pessoal',
          endereco: r.email.slice(0, 120),
          principal: true,
        });
      }

      const digitos = (r.celular ?? '').replace(/\D/g, '');
      if (r.celular && !mascarado(r.celular, 'telefone') && digitos.length >= 10) {
        telefones.push({
          clienteId,
          tipo: 'celular',
          ddd: digitos.slice(0, 2),
          numero: digitos.slice(2),
          completo: digitos,
          principal: true,
        });
      }
    }

    for (let i = 0; i < emails.length; i += 500) {
      emailsGravados += await clienteRepo.inserirEmails(emails.slice(i, i + 500), conexao);
    }
    for (let i = 0; i < telefones.length; i += 500) {
      telefonesGravados += await clienteRepo.inserirTelefones(telefones.slice(i, i + 500), conexao);
    }

    // Endereço inteiro e só para quem não tem: misturar campos criaria um endereço que não existe.
    const enderecos: clienteRepo.EnderecoImportado[] = [];
    const cacheMunicipio = new Map<string, number>();
    for (const r of porDocumento.values()) {
      const clienteId = idsPorDocumento.get(r.documento);
      if (!clienteId || !r.endereco) continue;

      const e = r.endereco;
      let municipioId: number | null = null;
      if (e.cidade && /\p{L}/u.test(e.cidade) && e.uf) {
        const chave = `${e.uf}|${e.cidade}`.toUpperCase();
        municipioId =
          cacheMunicipio.get(chave) ?? (await clienteRepo.resolverMunicipio(e.cidade, e.uf, conexao));
        cacheMunicipio.set(chave, municipioId);
      }

      enderecos.push({
        clienteId,
        tipo: 'principal',
        logradouro: e.logradouro,
        numero: e.numero,
        complemento: e.complemento,
        bairro: e.bairro,
        municipioId,
        cep: e.cep,
      });
    }
    for (let i = 0; i < enderecos.length; i += 500) {
      await clienteRepo.inserirEnderecosSeAusente(enderecos.slice(i, i + 500), conexao);
    }

    const apolices: apoliceRepo.ApoliceImportada[] = [];

    for (const r of porApolice.values()) {
      const seguradoraId = seguradoras.get(r.seguradora);
      if (!seguradoraId || !r.apolice) continue;

      const chaveProduto = `${seguradoraId}|${r.produto ?? ''}`;
      if (r.produto && !produtos.has(chaveProduto)) {
        produtos.set(
          chaveProduto,
          await apoliceRepo.resolverProduto(
            r.produto,
            seguradoraId,
            r.ramo ? (ramos.get(r.ramo) ?? null) : null,
            r.produtoCodigo,
            conexao,
          ),
        );
      }

      const clienteId = idsPorDocumento.get(r.documento) ?? null;

      apolices.push({
        seguradoraId,
        numero: r.apolice,
        numeroProvisorio: r.provisoria === true,
        chaveNatural: r.chaveNatural ?? null,
        produtoId: r.produto ? (produtos.get(chaveProduto) ?? null) : null,
        clienteId,
        // Quem VENDEU esta apólice (o do cliente é o da carteira).
        produtorId: r.produtor ? (produtores.get(r.produtor) ?? null) : null,
        nomeSegurado: r.nome,
        documentoSegurado: r.documento,
        vinculoOrigem: clienteId ? 'documento' : null,
        emitidaEm: r.emitidaEm,
        vigenciaInicio: r.vigenciaInicio,
        vigenciaFim: r.vigenciaFim,
        premioTotal: r.premioTotal,
        premioLiquido: r.premioLiquido,
        comissao: r.comissao,
        percentualComissao: r.percentualComissao,
        tipoNegocio: r.tipoNegocio,
        numeroProposta: r.numeroProposta,
        propostaCia: r.propostaCia,
        celula: r.celula,
        possuiSinistro: r.possuiSinistro,
        situacaoCia: r.situacaoCia,
        endosso: r.endosso,
        canceladaEm: r.canceladaEm,
        motivoCancelamento: r.motivoCancelamento,
        canalId: r.canalNome ? (canais.get(r.canalNome) ?? null) : null,
        origemSistema,
        origemArquivo: opcoes.arquivo,
        origemLote: lote,
      });
    }

    // Promoção antes do insert: provisória que agora chega com número real é a
    // MESMA apólice (pela chave natural), senão o insert criaria uma segunda.
    const comNumeroReal = apolices.filter((a) => !a.numeroProvisorio && a.chaveNatural);

    promovidas = await apoliceRepo.promoverProvisorias(
      comNumeroReal.map((a) => ({
        seguradoraId: a.seguradoraId,
        chaveNatural: a.chaveNatural!,
        numero: a.numero,
      })),
      conexao,
    );

    // Renumeração antes do insert: `PROV-<hash>` já gravada vira `PROP-<proposta>`.
    renumeradas = await apoliceRepo.renumerarProvisoriasPelaProposta(
      apolices
        .filter((a) => a.numeroProvisorio && a.chaveNatural && a.numero.startsWith('PROP-'))
        .map((a) => ({
          seguradoraId: a.seguradoraId,
          chaveNatural: a.chaveNatural!,
          numero: a.numero,
        })),
      conexao,
    );

    // Em blocos: milhares de tuplas num INSERT só estoura o `max_allowed_packet`.
    for (let i = 0; i < apolices.length; i += 500) {
      apolicesGravadas += await apoliceRepo.inserirApolices(apolices.slice(i, i + 500), conexao);
    }

    // Provisória gêmea de uma apólice real que já existia: a promoção não pôde renomear.
    duplicatasRemovidas = await apoliceRepo.limparProvisoriasDuplicadas(conexao);

    const vinculos = [...porDocumento.values()]
      .map((r) => {
        const clienteId = idsPorDocumento.get(r.documento);
        const seguradoraId = seguradoras.get(r.seguradora);
        if (!clienteId || !seguradoraId) return null;

        return {
          clienteId,
          seguradoraId,
          ramoId: r.ramo ? (ramos.get(r.ramo) ?? null) : null,
          modalidadeId: null,
        };
      })
      .filter((v): v is NonNullable<typeof v> => v !== null);

    for (let i = 0; i < vinculos.length; i += 500) {
      await clienteRepo.inserirVinculosSeguradora(vinculos.slice(i, i + 500), conexao);
    }

    await conexao.commit();
  } catch (erro) {
    await conexao.rollback();
    throw erro;
  } finally {
    conexao.release();
  }

  // Apólices antigas sem dono que o arquivo novo pode ter resolvido.
  const vinculadas = await apoliceRepo.vincularPorDocumento();

  // Fora da transação e DEPOIS do vínculo: a situação depende das apólices já
  // ligadas, e a matriz recém-criada também precisa ganhar situação.
  await clienteRepo.organizarMatrizes();
  const situacoes = await clienteRepo.recalcularSituacoes();

  return {
    ...base,
    clientes: {
      novos: documentos.length - jaCadastrados.size,
      existentes: jaCadastrados.size,
      gravados: clientesGravados,
      emails: emailsGravados,
      telefones: telefonesGravados,
      ativados: situacoes.ativos,
      inativados: situacoes.inativos,
    },
    apolices: {
      novas: porApolice.size - apolicesExistentes,
      existentes: apolicesExistentes,
      gravadas: apolicesGravadas,
      semNumero,
      numeroIlegivel: ilegiveis,
      vinculadas: vinculadas.novos + vinculadas.corrigidos,
      provisorias: [...porApolice.values()].filter((r) => r.provisoria).length,
      promovidas,
      renumeradas,
      duplicatasRemovidas,
    },
    seguradorasNovas,
  };
}

/** Nomes ainda não cadastrados; em caixa alta, como a collation do banco compara. */
async function naoCadastradas(nomes: string[]): Promise<string[]> {
  if (nomes.length === 0) return [];

  const existentes = new Set((await seguradoraRepo.nomesCadastrados(nomes)).map((n) => n.toUpperCase()));
  return nomes.filter((n) => !existentes.has(n.toUpperCase()));
}

/** Quantas chaves `SEGURADORA|numero|documento` (a única do banco) já existem. */
async function contarApolicesExistentes(chaves: string[]): Promise<number> {
  if (chaves.length === 0) return 0;

  const numeros = [...new Set(chaves.map((c) => c.split('|')[1] ?? ''))].filter(Boolean);
  const existentes = new Set(await apoliceRepo.chavesExistentes(numeros));
  return chaves.filter((c) => existentes.has(c)).length;
}
