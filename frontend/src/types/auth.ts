export interface Usuario {
  id: string;
  nome: string;
  email: string;
  papel: string;
  permissoes: string[];
  precisaTrocarSenha: boolean;
}

export interface RespostaSessao {
  usuario: Usuario;
  accessToken: string;
  expiraEmSegundos: number;
}

export interface RespostaPerfil {
  usuario: Usuario;
}
