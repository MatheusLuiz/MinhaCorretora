import { api } from '@/lib/api';

/** Cliente da API de Configurações › E-mail de disparo: caixas e layouts. */

export type Seguranca = 'starttls' | 'tls';

export interface Caixa {
  id: string;
  nome: string;
  ativo: boolean;
  padrao: boolean;
  host: string;
  porta: number;
  seguranca: Seguranca;
  usuario: string | null;
  /** A senha nunca desce: só se existe e os últimos caracteres. */
  temSenha: boolean;
  senhaDica: string | null;
  remetenteNome: string | null;
  remetenteEmail: string;
  responderPara: string | null;
  ultimoTeste: { em: string; ok: boolean; erro: string | null } | null;
  atualizadoEm: string | null;
  atualizadoPor: string | null;
  /** Quantos layouts saem por esta caixa. */
  modelos: number;
}

export interface DadosCaixa {
  nome: string;
  host: string;
  porta: number;
  seguranca: Seguranca;
  usuario: string;
  /** Vazio = manter a gravada. */
  senha: string;
  remetenteNome: string;
  remetenteEmail: string;
  responderPara: string;
  ativo: boolean;
  padrao: boolean;
}

export interface Variavel {
  nome: string;
  descricao: string;
  exemplo: string;
}

export interface Finalidade {
  chave: string;
  rotulo: string;
  descricao: string;
  variaveis: Variavel[];
  obrigatorias: string[];
}

export interface Modelo {
  id: string;
  nome: string;
  finalidade: string;
  /** uuid da caixa; null = a padrão. */
  caixa: string | null;
  caixaNome: string | null;
  assunto: string;
  corpoHtml: string;
  corpoTexto: string | null;
  usarMoldura: boolean;
  ativo: boolean;
  atualizadoEm: string | null;
  atualizadoPor: string | null;
}

export interface DadosModelo {
  nome: string;
  finalidade: string;
  caixa: string;
  assunto: string;
  corpoHtml: string;
  corpoTexto: string;
  usarMoldura: boolean;
  ativo: boolean;
}

type ResultadoTeste = { ok: true; para: string } | { ok: false; erro: string; para: string };

const BASE = '/configuracoes/email';

export const emailDisparoApi = {
  caixas: () => api.get<{ caixas: Caixa[]; envAlternativo: { host: string } | null }>(`${BASE}/caixas`),
  criarCaixa: (d: DadosCaixa) => api.post<{ caixa: Caixa }>(`${BASE}/caixas`, d),
  atualizarCaixa: (id: string, d: DadosCaixa & { removerSenha?: boolean }) =>
    api.put<{ caixa: Caixa }>(`${BASE}/caixas/${id}`, d),
  excluirCaixa: (id: string) => api.delete<void>(`${BASE}/caixas/${id}`),
  testarCaixa: (d: Omit<DadosCaixa, 'nome' | 'ativo' | 'padrao'> & { id?: string; para: string }) =>
    api.post<ResultadoTeste>(`${BASE}/caixas/teste`, d),

  modelos: () => api.get<{ modelos: Modelo[]; finalidades: Finalidade[] }>(`${BASE}/modelos`),
  criarModelo: (d: DadosModelo) => api.post<{ modelo: Modelo }>(`${BASE}/modelos`, d),
  atualizarModelo: (id: string, d: DadosModelo) => api.put<{ modelo: Modelo }>(`${BASE}/modelos/${id}`, d),
  excluirModelo: (id: string) => api.delete<void>(`${BASE}/modelos/${id}`),
  previa: (d: Omit<DadosModelo, 'nome' | 'ativo'> & { para?: string }) =>
    api.post<{ assunto: string; html: string; texto: string }>(`${BASE}/modelos/previa`, d),
  testarModelo: (d: Omit<DadosModelo, 'nome' | 'ativo'> & { para: string }) =>
    api.post<ResultadoTeste>(`${BASE}/modelos/teste`, d),
};

/** A mensagem de erro que a tela mostra — com o "reinicie o backend" do 404. */
export function mensagemDeErro(falha: unknown, padrao: string): string {
  const e = falha as { status?: number; message?: string; mensagensDeValidacao?: string[] };
  if (e?.status === 404) return 'Esta tela precisa do servidor atualizado: reinicie o backend.';
  if (e?.mensagensDeValidacao && e.mensagensDeValidacao.length > 0) return e.mensagensDeValidacao.join(' ');
  return e?.message ?? padrao;
}

/** Data do servidor (hora local, sem fuso) → "29/09/26 14:30". */
export function quando(iso: string): string {
  return new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
}
