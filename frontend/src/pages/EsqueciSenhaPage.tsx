import { useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';

import { api, ApiError } from '@/lib/api';

interface RespostaEsqueciSenha {
  mensagem: string;
}

/** Pedido de redefinição. Mesma resposta para e-mail cadastrado ou não: senão vira verificador de contas. */
export function EsqueciSenhaPage(): React.JSX.Element {
  const [email, setEmail] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [enviado, setEnviado] = useState(false);

  useEffect(() => {
    document.title = 'Esqueci minha senha — MinhaCorretora';
  }, []);

  async function aoEnviar(evento: FormEvent<HTMLFormElement>): Promise<void> {
    evento.preventDefault();
    setErro(null);
    setEnviando(true);

    try {
      await api.post<RespostaEsqueciSenha>(
        '/auth/senha/esqueci',
        { email },
        // Rota pública: uma 401 aqui não deve tentar renovar sessão.
        { semAutenticacao: true },
      );
      setEnviado(true);
    } catch (falha) {
      // Só o 429 se mostra como tal; qualquer outra falha vira a mensagem genérica.
      setErro(
        falha instanceof ApiError
          ? falha.message
          : 'Não foi possível enviar o pedido. Verifique sua conexão.',
      );
      setEnviando(false);
    }
  }

  if (enviado) {
    return (
      <main className="login">
        <div className="login__cartao">
          <header className="login__cabecalho">
            <h1>Verifique seu e-mail</h1>
            <p>
              Se <strong>{email}</strong> estiver cadastrado, você receberá em
              instantes um link para criar uma senha nova.
            </p>
          </header>

          <p className="texto-discreto">
            O link vale por pouco tempo e só pode ser usado uma vez. Não
            encontrou a mensagem? Confira a caixa de spam antes de pedir de novo
            — pedir outro link invalida o anterior.
          </p>

          <footer className="login__rodape">
            <p>
              <Link to="/login">Voltar para o login</Link>
            </p>
          </footer>
        </div>
      </main>
    );
  }

  return (
    <main className="login">
      <div className="login__cartao">
        <header className="login__cabecalho">
          <h1>Esqueci minha senha</h1>
          <p>
            Informe o e-mail cadastrado. Enviaremos um link para você criar uma
            senha nova.
          </p>
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

          {erro && (
            <p className="alerta alerta--erro" role="alert" aria-live="assertive">
              {erro}
            </p>
          )}

          <button type="submit" className="botao botao--principal" disabled={enviando}>
            {enviando ? 'Enviando…' : 'Enviar link de redefinição'}
          </button>
        </form>

        <footer className="login__rodape">
          <p>
            <Link to="/login">Voltar para o login</Link>
          </p>
        </footer>
      </div>
    </main>
  );
}
