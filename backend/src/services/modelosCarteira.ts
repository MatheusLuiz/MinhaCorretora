import { LAYOUTS_POR_SEGURADORA } from '../seguradoras/index.js';
import { normalizarNomeColuna } from './colunasImportacao.js';

/** Layout de CARTEIRA: cliente e apólice na mesma linha. */
export interface LayoutCarteira {
  chave: string;
  nome: string;
  /** Sistema de origem, não companhia. Vira a pasta do arquivo arquivado. */
  origem: string;
  /** Companhia do relatório de UM portal; sem ela, a companhia vem de uma coluna. */
  seguradoraChave?: string;
  /** Só linhas desta corretora entram: o de cancelados da Suhai repete a apólice por corretor. */
  corretora?: string;
  /** Motivo gravado quando o arquivo é todo de um tipo de cancelamento. */
  motivoCancelamento?: string;
  /** Extensões que a tela aceita, quando não são as de planilha. */
  aceita?: string;
  descricao: string;
  observacoes: string[];
  /** Nome da coluna no arquivo → coluna canônica do sistema. */
  aliases: Record<string, string>;
  /** Número montado de várias colunas unidas por hífen (Porto: ramo-sucursal-apólice); sem parte, vale `senao`. */
  montarNumero?: { partes: string[]; senao?: string; coluna: string };
}

/** Todos os layouts de carteira, pasta por pasta (`seguradoras/<chave>/index.ts`). */
export const LAYOUTS_CARTEIRA: LayoutCarteira[] = LAYOUTS_POR_SEGURADORA.flatMap((s) => s.carteira ?? []);

export const LAYOUTS_CARTEIRA_POR_CHAVE = new Map(
  LAYOUTS_CARTEIRA.map((l) => [l.chave, l]),
);

/** Confere, na carga do módulo, que os aliases já estão normalizados. */
for (const layout of LAYOUTS_CARTEIRA) {
  for (const chave of Object.keys(layout.aliases)) {
    if (normalizarNomeColuna(chave) !== chave) {
      throw new Error(
        `Alias "${chave}" em ${layout.chave} não está normalizado — use "${normalizarNomeColuna(chave)}".`,
      );
    }
  }
}
