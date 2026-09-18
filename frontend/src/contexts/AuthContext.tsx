import {
  createContext,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

import {
  cabecalhosDeCookie,
  api,
  definirAccessToken,
  definirHandlerSessaoPerdida,
  renovarToken,
} from '@/lib/api';
import type { RespostaPerfil, RespostaSessao, Usuario } from '@/types/auth';

export interface AuthContextValor {
  usuario: Usuario | null;
  carregando: boolean;
  entrar: (email: string, senha: string) => Promise<void>;
  sair: () => Promise<void>;
  temPermissao: (...permissoes: string[]) => boolean;
  atualizarPerfil: () => Promise<void>;
}

export const AuthContext = createContext<AuthContextValor | null>(null);

/** Renova um minuto antes do vencimento: cobre relógio dessincronizado e latência. */
const MARGEM_RENOVACAO_MS = 60_000;

export function AuthProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const [usuario, setUsuario] = useState<Usuario | null>(null);
  const [carregando, setCarregando] = useState(true);
  const timerRenovacao = useRef<ReturnType<typeof setTimeout> | null>(null);

  const limparTimer = useCallback(() => {
    if (timerRenovacao.current !== null) {
      clearTimeout(timerRenovacao.current);
      timerRenovacao.current = null;
    }
  }, []);

  const encerrarLocalmente = useCallback(() => {
    limparTimer();
    definirAccessToken(null);
    setUsuario(null);
  }, [limparTimer]);

  const agendarRenovacao = useCallback(
    (expiraEmSegundos: number) => {
      limparTimer();

      const emMs = Math.max(expiraEmSegundos * 1000 - MARGEM_RENOVACAO_MS, 10_000);

      timerRenovacao.current = setTimeout(() => {
        void (async () => {
          const token = await renovarToken();

          if (token) {
            agendarRenovacao(expiraEmSegundos);
          } else {
            encerrarLocalmente();
          }
        })();
      }, emMs);
    },
    [encerrarLocalmente, limparTimer],
  );

  const entrar = useCallback(
    async (email: string, senha: string) => {
      const resposta = await api.post<RespostaSessao>(
        '/auth/login',
        { email, senha },
        { semAutenticacao: true },
      );

      definirAccessToken(resposta.accessToken);
      setUsuario(resposta.usuario);
      agendarRenovacao(resposta.expiraEmSegundos);
    },
    [agendarRenovacao],
  );

  const sair = useCallback(async () => {
    try {
      // O logout autentica pelo cookie, não pelo Bearer: leva o cabeçalho de CSRF.
      await api.post('/auth/logout', undefined, {
        semAutenticacao: true,
        headers: cabecalhosDeCookie(),
      });
    } catch {
      // O servidor pode estar fora; a sessão local termina de qualquer forma.
    } finally {
      encerrarLocalmente();
    }
  }, [encerrarLocalmente]);

  const atualizarPerfil = useCallback(async () => {
    const { usuario: perfil } = await api.get<RespostaPerfil>('/auth/me');
    setUsuario(perfil);
  }, []);

  const temPermissao = useCallback(
    (...permissoes: string[]) =>
      permissoes.some((permissao) => usuario?.permissoes.includes(permissao) ?? false),
    [usuario],
  );

  // Restaura a sessão no F5: o token em memória some, o cookie de refresh sobrevive.
  useEffect(() => {
    let cancelado = false;

    void (async () => {
      const token = await renovarToken();

      if (cancelado) return;

      if (!token) {
        setCarregando(false);
        return;
      }

      try {
        const { usuario: perfil } = await api.get<RespostaPerfil>('/auth/me');
        if (cancelado) return;

        setUsuario(perfil);
        agendarRenovacao(15 * 60);
      } catch {
        if (!cancelado) definirAccessToken(null);
      } finally {
        if (!cancelado) setCarregando(false);
      }
    })();

    return () => {
      cancelado = true;
    };
  }, [agendarRenovacao]);

  // O cliente HTTP avisa quando o refresh falhou em alguma requisição qualquer.
  useEffect(() => {
    definirHandlerSessaoPerdida(encerrarLocalmente);
    return () => definirHandlerSessaoPerdida(null);
  }, [encerrarLocalmente]);

  useEffect(() => limparTimer, [limparTimer]);

  const valor = useMemo<AuthContextValor>(
    () => ({ usuario, carregando, entrar, sair, temPermissao, atualizarPerfil }),
    [usuario, carregando, entrar, sair, temPermissao, atualizarPerfil],
  );

  return <AuthContext.Provider value={valor}>{children}</AuthContext.Provider>;
}
