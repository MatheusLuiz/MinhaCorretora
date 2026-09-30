import { api } from '@/lib/api';
import type { ContagemDaCarteira } from '@/lib/filaCadastro';

/** Grupos de cliente: a CHAVE é o que o cliente guarda; a tela mostra sempre o NOME. */

export interface GrupoCliente {
  id: number;
  chave: string;
  nome: string;
  descricao: string | null;
  ativo: boolean;
  ordem: number;
  clientes: number;
}

export interface DadosGrupoCliente {
  nome: string;
  descricao?: string | null;
  ordem?: number;
}

/** O que os painéis recebem junto das contagens. */
export interface GrupoDoPainel {
  chave: string;
  nome: string;
}

export const gruposClienteApi = {
  listar: () => api.get<{ grupos: GrupoCliente[] }>('/grupos-cliente'),

  criar: (dados: DadosGrupoCliente) => api.post<{ grupo: GrupoCliente }>('/grupos-cliente', dados),

  atualizar: (id: number, dados: DadosGrupoCliente) =>
    api.patch<{ grupo: GrupoCliente }>(`/grupos-cliente/${id}`, dados),

  definirSituacao: (id: number, ativo: boolean) =>
    api.patch<{ grupo: GrupoCliente }>(`/grupos-cliente/${id}/situacao`, { ativo }),
};

/** Backend anterior à 057 não manda `grupos`: valem os grupos de partida. */
const GRUPOS_ANTERIORES: GrupoDoPainel[] = [
  { chave: 'corretora', nome: 'Corretora' },
  { chave: 'seguradora', nome: 'Seguradora' },
];

export const gruposDoPayload = (grupos: unknown): GrupoDoPainel[] =>
  Array.isArray(grupos) ? (grupos as GrupoDoPainel[]) : GRUPOS_ANTERIORES;

/** Um grupo, com a contagem dele (zerada se o backend não mandou). */
export interface GrupoContado extends GrupoDoPainel {
  contagem: ContagemDaCarteira;
}

const ZERADA: ContagemDaCarteira = { ativo: 0, inadimplente: 0, inativo: 0, outros: 0, total: 0 };

/** Grupos com contagem; grupo sem cliente não aparece. */
export function gruposContados(
  grupos: GrupoDoPainel[],
  porCarteira: Record<string, ContagemDaCarteira>,
): GrupoContado[] {
  return grupos
    .map((g) => ({ ...g, contagem: porCarteira[g.chave] ?? ZERADA }))
    .filter((g) => g.contagem.total > 0);
}

/** Soma um campo da contagem nos grupos dados. */
export function somarGrupos(
  grupos: GrupoContado[],
  campo: (c: ContagemDaCarteira) => number | undefined,
): number {
  return grupos.reduce((soma, g) => soma + (campo(g.contagem) ?? 0), 0);
}

/** "Corretora 120 · Seguradora 30" — o detalhe discreto embaixo do total. */
export function detalheDosGrupos(
  grupos: GrupoContado[],
  campo: (c: ContagemDaCarteira) => number,
  formatar: (n: number) => string,
): string {
  return grupos.map((g) => `${g.nome} ${formatar(campo(g.contagem))}`).join(' · ');
}
