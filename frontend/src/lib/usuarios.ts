import { api } from '@/lib/api';

/** Cliente da API de usuários. Sem campo de senha na criação: o servidor gera a temporária. */

export interface UsuarioDetalhado {
  id: string;
  nome: string;
  sobrenome: string | null;
  nomeCompleto: string;
  dataNascimento: string | null;
  email: string;
  papel: string;
  papelNome: string;
  permissoes: string[];
  ativo: boolean;
  precisaTrocarSenha: boolean;
  bloqueado: boolean;
  bloqueadoAte: string | null;
  tentativasFalhas: number;
  ultimoLoginEm: string | null;
  senhaAlteradaEm: string;
  criadoEm: string;
}

export interface Papel {
  chave: string;
  nome: string;
  descricao: string | null;
  totalPermissoes: number;
  /** Opcionais: backend anterior à 058 não manda. */
  ativo?: boolean;
  usuariosAtivos?: number;
}

export interface PermissaoDaFicha {
  chave: string;
  descricao: string | null;
  /** Vem do papel? */
  doPapel: boolean;
  /** Está valendo agora, depois de aplicar as exceções? */
  efetiva: boolean;
  /** 'concedida' = somada ao papel; 'revogada' = tirada dele; null = segue o papel. */
  excecao: 'concedida' | 'revogada' | null;
  motivo: string | null;
}

export interface EntradaNovoUsuario {
  nome: string;
  sobrenome?: string;
  dataNascimento?: string;
  email: string;
  papel: string;
}

export interface RespostaCriacao {
  usuario: UsuarioDetalhado;
  senhaTemporaria: string;
  aviso: string;
}

export interface ProdutorCarteira {
  id: number;
  nome: string;
  /** Quantos cadastros estão hoje nesta carteira. */
  clientes: number;
}

export const usuariosApi = {
  listar: () =>
    api.get<{ total: number; usuarios: UsuarioDetalhado[] }>('/usuarios'),

  papeis: () =>
    api.get<{ papeis: Papel[]; politicaSenha: { minimo: number; regras: string[] } }>(
      '/usuarios/papeis',
    ),

  detalhar: (id: string) => api.get<{ usuario: UsuarioDetalhado }>(`/usuarios/${id}`),

  detalharPapel: (chave: string) =>
    api.get<{ papel: PapelDetalhado }>(`/usuarios/papeis/${chave}`),

  definirPermissoesDoPapel: (chave: string, permissoes: string[]) =>
    api.put<{ papel: PapelDetalhado }>(`/usuarios/papeis/${chave}/permissoes`, { permissoes }),

  /** `copiarDe`: chave do papel cujas permissões e visão geral o novo herda. */
  criarPapel: (dados: { nome: string; descricao?: string; copiarDe?: string }) =>
    api.post<{ papel: PapelDetalhado }>('/usuarios/papeis', dados),

  /** Nome e descrição; a chave não muda. */
  editarPapel: (chave: string, dados: { nome: string; descricao: string }) =>
    api.patch<{ papel: PapelDetalhado }>(`/usuarios/papeis/${chave}`, dados),

  /** Só sem nenhum usuário (ativo ou inativo) e nunca o Administrador. */
  excluirPapel: (chave: string) => api.delete<void>(`/usuarios/papeis/${chave}`),

  definirSituacaoPapel: (chave: string, ativo: boolean) =>
    api.patch<{ papel: PapelDetalhado }>(`/usuarios/papeis/${chave}/situacao`, { ativo }),

  criar: (dados: EntradaNovoUsuario) => api.post<RespostaCriacao>('/usuarios', dados),

  editar: (id: string, dados: Partial<EntradaNovoUsuario>) =>
    api.patch<{ usuario: UsuarioDetalhado }>(`/usuarios/${id}`, dados),

  alterarSituacao: (id: string, ativo: boolean) =>
    api.patch<{ usuario: UsuarioDetalhado }>(`/usuarios/${id}/situacao`, { ativo }),

  redefinirSenha: (id: string) =>
    api.post<{ senhaTemporaria: string; aviso: string }>(`/usuarios/${id}/redefinir-senha`),

  /** Catálogo dos produtores, com a contagem que distingue os homônimos. */
  produtores: () => api.get<{ produtores: ProdutorCarteira[] }>('/usuarios/produtores'),

  carteira: (id: string) =>
    api.get<{ produtores: ProdutorCarteira[] }>(`/usuarios/${id}/carteira`),

  /** Envia a lista FINAL de produtores; o servidor troca o conjunto numa transação. */
  definirCarteira: (id: string, produtores: number[]) =>
    api.put<{ produtores: ProdutorCarteira[]; aviso: string }>(
      `/usuarios/${id}/carteira`,
      { produtores },
    ),

  permissoes: (id: string) =>
    api.get<{ permissoes: PermissaoDaFicha[] }>(`/usuarios/${id}/permissoes`),

  /** Envia o conjunto FINAL; o servidor grava só o que destoa do papel (preserva o vínculo com ele). */
  definirPermissoes: (id: string, permissoes: string[], motivo?: string) =>
    api.put<{ permissoes: PermissaoDaFicha[]; aviso: string }>(`/usuarios/${id}/permissoes`, {
      permissoes,
      ...(motivo ? { motivo } : {}),
    }),
};

/** Rótulos das permissões. A chave é o identificador técnico do banco. */
export const ROTULO_PERMISSAO: Record<string, string> = {
  'dashboard.ver': 'Visualizar os painéis',
  'relatorios.ler': 'Consultar relatórios detalhados',
  'relatorios.exportar': 'Exportar relatórios',
  'clientes.ler': 'Consultar clientes',
  'clientes.gerenciar': 'Importar e exportar a base de clientes',
  'clientes.todos': 'Ver a base inteira, e não só a própria carteira',
  'apolices.ler': 'Consultar apólices e documentos',
  'sinistros.ler': 'Consultar sinistros',
  'comissoes.ler': 'Consultar prêmios e comissões',
  'comissoes.todas': 'Ver a comissão da corretora inteira',
  'inadimplencia.completa': 'Ver todas as parcelas em atraso',
  'importacao.gerenciar': 'Importar planilhas e desfazer cargas',
  'importacao.parcelas': 'Importar parcelas pendentes das seguradoras',
  'clientes.consultar': 'Consultar qualquer cliente (busca e ficha), sem editar',
  'usuarios.gerenciar': 'Gerenciar usuários e papéis',
  'auditoria.ler': 'Consultar a trilha de auditoria',
  'integracao.gerenciar': 'Configurar a integração de dados',
};

/** Permissões que ampliam o ALCANCE (ex.: `clientes.todos`), separadas para não serem marcadas sem querer. */
export const PERMISSOES_DE_ALCANCE = new Set([
  'clientes.todos',
  'clientes.consultar',
  'comissoes.todas',
  'inadimplencia.completa',
]);

export interface PermissaoDoPapel {
  chave: string;
  descricao: string | null;
  concedida: boolean;
}

export interface PapelDetalhado {
  chave: string;
  nome: string;
  descricao: string | null;
  usuariosAtivos: number;
  /** Opcional: backend anterior à 058 não manda. */
  ativo?: boolean;
  permissoes: PermissaoDoPapel[];
}

export function formatarDataHora(iso: string | null): string {
  if (!iso) return 'Nunca acessou';

  return new Date(iso).toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** Formata 'YYYY-MM-DD' sem `Date`: `new Date('1991-04-17')` é UTC e no Brasil vira o dia anterior. */
export function formatarDataSimples(iso: string | null): string {
  if (!iso) return '—';

  const [ano, mes, dia] = iso.split('-');
  return `${dia}/${mes}/${ano}`;
}

/** Idade em anos completos, para acompanhar a data de nascimento. */
export function calcularIdade(iso: string | null): number | null {
  if (!iso) return null;

  const [ano, mes, dia] = iso.split('-').map(Number);
  if (!ano || !mes || !dia) return null;

  const hoje = new Date();
  let idade = hoje.getFullYear() - ano;

  const jaFezAniversario =
    hoje.getMonth() + 1 > mes || (hoje.getMonth() + 1 === mes && hoje.getDate() >= dia);

  if (!jaFezAniversario) idade -= 1;

  return idade >= 0 && idade < 130 ? idade : null;
}
