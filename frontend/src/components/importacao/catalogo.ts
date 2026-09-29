import { type LayoutArquivo } from '@/lib/financeiro';
import { type ModeloImportacao } from '@/lib/importacaoClientes';

/**
 * Catálogo de tudo que a tela sabe importar. A família decide o endpoint e se
 * a gravação apaga (`destrutivo`: clientes ESPELHA a planilha; o resto acrescenta).
 */

/** `carteira` cria cliente e apólice na mesma passada. */
export type Familia = 'apolices' | 'financeiro' | 'clientes' | 'carteira';

/** Valor de seguradora para planilhas que a própria corretora monta. */
export const PROPRIA = '__propria__';

/** Valor de seguradora para arquivar sob um nome que ainda não tem layout. */
export const OUTRA = '__outra__';

export interface Opcao {
  /** Único na lista inteira: a mesma chave pode existir em duas famílias. */
  id: string;
  /** Chave que o endpoint espera. */
  chave: string;
  familia: Familia;
  nome: string;
  descricao: string;
  observacoes: string[];
  /** `null` = planilha montada aqui dentro, sem companhia de origem. */
  seguradora: string | null;
  /** Colunas do modelo baixável. Só as planilhas próprias têm. */
  colunas: string[] | null;
  /** A gravação apaga o que a planilha não traz. */
  destrutivo: boolean;
  /** Extensões aceitas pelo endpoint desta família. */
  aceita: string;
  /** Só relatórios financeiros: parcelas pedem a marcação de inadimplência. */
  entidade?: 'parcelas' | 'comissoes' | 'sinistros' | 'renovacoes' | 'encerradas';
  /** Aceita vários arquivos de uma vez (PDF do Bradesco: um por apólice). */
  multiplos?: boolean;
}

export function montarCatalogo(
  layouts: {
    apolices: LayoutArquivo[];
    financeiro: LayoutArquivo[];
    carteira?: LayoutArquivo[];
  },
  modelos: ModeloImportacao[],
): Opcao[] {
  const deSeguradora = (l: LayoutArquivo, familia: Familia): Opcao => ({
    id: `${familia}:${l.chave}`,
    chave: l.chave,
    familia,
    nome: l.nome,
    descricao: l.descricao,
    observacoes: l.observacoes,
    seguradora: l.seguradora,
    colunas: null,
    destrutivo: false,
    aceita: l.aceita ?? '.xlsx,.csv',
    entidade: l.entidade,
  });

  return [
    ...(layouts.carteira ?? []).map((l) => ({
      ...deSeguradora(l, 'carteira' as const),
      // Arquivo de várias companhias: só .csv — pedir .xlsx levaria a abrir no
      // Excel, que destrói o número da apólice.
      aceita: l.aceita ?? (l.sistema === false ? '.xlsx,.xls,.csv' : '.csv,text/csv'),
      multiplos: /pdf/i.test(l.aceita ?? ''),
    })),
    ...layouts.apolices.map((l) => deSeguradora(l, 'apolices')),
    ...layouts.financeiro.map((l) => deSeguradora(l, 'financeiro')),
    ...modelos.map((m) => ({
      id: `clientes:${m.chave}`,
      chave: m.chave,
      familia: 'clientes' as const,
      nome: m.nome,
      descricao:
        m.aliases > 0
          ? `${m.descricao} · traduz ${m.aliases} coluna(s) da companhia`
          : m.descricao,
      observacoes: m.observacoes,
      seguradora: m.seguradora,
      colunas: m.colunas,
      destrutivo: true,
      aceita: '.csv,text/csv',
    })),
  ];
}

export interface GrupoSeguradora {
  valor: string;
  rotulo: string;
  /** `sistema` = origem que não é seguradora (várias companhias num arquivo). */
  grupo: 'sistema' | 'companhia' | 'especial';
}

/**
 * Primeiro select: SÓ as seguradoras cadastradas e ativas que têm layout.
 * Sem cadastro carregado a lista fica vazia — nunca cai nos layouts.
 */
export function agruparPorSeguradora(
  catalogo: Opcao[],
  ativas?: string[],
): GrupoSeguradora[] {
  const daOrigem = [...new Set(catalogo.map((o) => o.seguradora).filter((s): s is string => !!s))];

  const normalizar = (v: string): string => v.trim().toUpperCase();

  // Companhia sem layout deixaria o segundo select vazio e travaria o campo de arquivo.
  const temOpcao = new Set(daOrigem.map(normalizar));

  return (ativas ?? [])
    .filter((s) => temOpcao.has(normalizar(s)))
    .slice()
    .sort((a, b) => a.localeCompare(b, 'pt-BR'))
    .map((s) => ({ valor: s, rotulo: s, grupo: 'companhia' as const }));
}

/**
 * O que dá para importar da companhia escolhida. "Outra" devolve os layouts de
 * seguradora (arquivo de formato conhecido, arquivado sob outro nome).
 */
export function opcoesDaSeguradora(catalogo: Opcao[], seguradora: string): Opcao[] {
  if (seguradora === PROPRIA) return catalogo.filter((o) => o.seguradora === null);
  if (seguradora === OUTRA) return catalogo.filter((o) => o.seguradora !== null);

  return catalogo.filter((o) => o.seguradora === seguradora);
}

/** Prévia do nome da pasta, igual ao que o servidor monta. */
export function pasta(nome: string): string {
  const limpo = nome
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);

  return limpo || 'sem-seguradora';
}

export function hoje(): string {
  return new Date().toISOString().slice(0, 10);
}
