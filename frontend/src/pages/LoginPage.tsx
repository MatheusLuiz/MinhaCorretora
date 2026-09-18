import { useEffect, useState, type FormEvent } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';

import { useAuth } from '@/hooks/useAuth';
import { ApiError } from '@/lib/api';

interface EstadoNavegacao {
  de?: string;
}

export function LoginPage(): React.JSX.Element {
  const { usuario, carregando, entrar } = useAuth();
  const navegar = useNavigate();
  const local = useLocation();

  const [email, setEmail] = useState('');
  const [senha, setSenha] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  const destino = (local.state as EstadoNavegacao | null)?.de ?? '/';

  useEffect(() => {
    document.title = 'Entrar — MinhaCorretora';
  }, []);

  if (!carregando && usuario) {
    return <Navigate to={destino} replace />;
  }

  async function aoEnviar(evento: FormEvent<HTMLFormElement>): Promise<void> {
    evento.preventDefault();
    setErro(null);
    setEnviando(true);

    try {
      await entrar(email, senha);
      navegar(destino, { replace: true });
    } catch (falha) {
      // Mensagem igual para e-mail inexistente e senha errada: refinar desfaria a proteção contra enumeração.
      setErro(
        falha instanceof ApiError
          ? falha.message
          : 'Não foi possível entrar. Verifique sua conexão.',
      );
      setSenha('');
    } finally {
      setEnviando(false);
    }
  }

  return (
    <main className="login">
      <div className="login__cartao">
        <header className="login__cabecalho">
          {/* O logo É o título aqui, então carrega o <h1> junto pelo alt. */}
          <h1 className="login__marca">
            <img
              src="/logo.svg"
              alt={import.meta.env.VITE_APP_NAME ?? 'MinhaCorretora'}
              width={240}
              height={68}
            />
          </h1>
        </header>

        <form onSubmit={(e) => void aoEnviar(e)} noValidate>
          <div className="campo">
            <label htmlFor="email">E-mail</label>
            <input
              id="email"
              name="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="username"
              autoFocus
              required
              disabled={enviando}
              maxLength={254}
            />
          </div>

          <div className="campo">
            <label htmlFor="senha">Senha</label>
            <input
              id="senha"
              name="senha"
              type="password"
              value={senha}
              onChange={(e) => setSenha(e.target.value)}
              autoComplete="current-password"
              required
              disabled={enviando}
              maxLength={128}
            />
          </div>

          {erro && (
            // aria-live anuncia o erro sem o foco voltar para o campo.
            <p className="alerta alerta--erro" role="alert" aria-live="assertive">
              {erro}
            </p>
          )}

          <button type="submit" className="botao botao--principal" disabled={enviando}>
            {enviando ? 'Entrando…' : 'Entrar'}
          </button>
        </form>

        <footer className="login__rodape">
          <p>
            <Link to="/esqueci-senha">Esqueceu a senha?</Link>
          </p>
        </footer>
      </div>
    </main>
  );
}
