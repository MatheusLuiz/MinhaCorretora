import * as apoliceRepo from '../../repositories/apolice.repository.js';

/**
 * Apólice sem CPF entra com `cliente_id` nulo e o nome do segurado (cliente sem CPF não existe).
 * Quando o CPF chega, `adotarSemDocumento` a adota. Mesmo lote da carga, para desfazer junto.
 */

export interface ApoliceSemCliente {
  numero: string;
  nomeSegurado: string;
  produto: string | null;
  /** Datas em DD/MM/AAAA ou ISO. */
  emitidaEm?: string | null;
  vigenciaInicio?: string | null;
  vigenciaFim?: string | null;
  situacaoCia?: 'ativa' | 'cancelada' | 'nao_vigente' | null;
  canceladaEm?: string | null;
  motivoCancelamento?: string | null;
}

const iso = (v: string | null | undefined): string | null => {
  const t = (v ?? '').trim();
  const br = /^(\d{2})\/(\d{2})\/(\d{4})/.exec(t);
  if (br) return `${br[3]}-${br[2]}-${br[1]}`;
  const i = /^(\d{4})-(\d{2})-(\d{2})/.exec(t);
  return i ? `${i[1]}-${i[2]}-${i[3]}` : null;
};

/** "ATIVO", "CANCELADO", "NÃO VIGENTE" (consulta da Porto) → situação da companhia. */
export function situacaoDoTexto(texto: string | undefined): 'ativa' | 'cancelada' | 'nao_vigente' | null {
  const t = (texto ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().trim();
  if (/^ATIV/.test(t)) return 'ativa';
  if (/^CANCEL/.test(t)) return 'cancelada';
  if (/^NAO VIGENTE/.test(t)) return 'nao_vigente';
  return null;
}

export async function gravarApolicesSemCliente(
  seguradoraId: number,
  linhas: ApoliceSemCliente[],
  origem: { lote: string; arquivo: string },
): Promise<number> {
  if (linhas.length === 0) return 0;
  const produtos = new Map<string, number>();
  for (const p of new Set(linhas.map((l) => l.produto).filter((p): p is string => Boolean(p)))) {
    produtos.set(p, await apoliceRepo.resolverProduto(p, seguradoraId, null, null));
  }
  return apoliceRepo.inserirApolices(
    linhas.map((l) => ({
      seguradoraId,
      numero: l.numero,
      produtoId: l.produto ? (produtos.get(l.produto) ?? null) : null,
      clienteId: null,
      nomeSegurado: l.nomeSegurado,
      documentoSegurado: null,
      vinculoOrigem: null,
      emitidaEm: iso(l.emitidaEm),
      vigenciaInicio: iso(l.vigenciaInicio),
      vigenciaFim: iso(l.vigenciaFim),
      premioTotal: null,
      premioLiquido: null,
      comissao: null,
      percentualComissao: null,
      situacaoCia: l.situacaoCia ?? (iso(l.canceladaEm) ? 'cancelada' : null),
      canceladaEm: iso(l.canceladaEm),
      motivoCancelamento: l.motivoCancelamento ?? null,
      origemSistema: 'seguradora',
      origemArquivo: origem.arquivo,
      origemLote: origem.lote,
    })),
  );
}
