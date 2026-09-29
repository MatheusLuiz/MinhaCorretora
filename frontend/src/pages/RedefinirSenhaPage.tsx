import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';

import { api, ApiError } from '@/lib/api';

interface TokenValidado {
  nome: string;
  emailMascarado: string;
}

type Estado =
  | { fase: 'verificando' }
  | { fase: 'invalido'; mensagem: string }
  | { fase: 'formulario'; conta: TokenValidado }
  | { fase: 'concluido' };

/**
 * Senha nova pelo link do e-mail. O token é validado ao abrir (o link é de uso único)
 * e sai da URL logo depois de lido: não vai ao histórico nem ao `Referer`.
 */
export function RedefinirSenhaPage(): React.JSX.Element {
  const [parametros, setParametros] = useSearchParams();

  const tokenRef = useRef<string>(parametros.get('token') ?? '');

  const [estado, setEstado] = useState<Estado>({ fase: 'verificando' });
  const [novaSenha, setNovaSenha] = useState('');
  const [confirmacao, setConfirmacao] = useState('');
  const [erros, setErros] = useState<string[]>([]);
  const [enviando, setEnviando] = useState(false);

  useEffect(() => {
    document.title = 'Criar senha nova — MinhaCorretora';
  }, []);

  useEffect(() => {
    const token = tokenRef.current;

    if (!token) {
      setEstado({
        fase: 'invalido',
        mensagem: 'Link incompleto. Abra o endereço exatamente como ele chegou no e-mail.',
      });
      return;
    }

    // `replace: true`: o "voltar" não traz de volta o endereço com o token.
    setParametros({}, { replace: true });

    let cancelado = false;

    void (async () => {
      try {
        const conta = await api.post<TokenValidado>(
          '/auth/senha/validar-token',
          { token },
          { semAutenticacao: true },
        );
        if (!cancelado) setEstado({ fase: 'formulario', conta });
      } catch (falha) {
        if (cancelado) return;
        setEstado({
          fase: 'invalido',
          mensagem:
            falha instanceof ApiError
              ? falha.message
              : 'Não foi possível verificar o link. Verifique sua conexão.',
        });
      }
    })();

    return () => {
      cancelado = true;
    };
    // Deps vazias de propósito: `setParametros` muda a cada navegação e rodaria o
    // efeito de novo, com a URL já vazia.
  }, []);

  async function aoEnviar(evento: FormEvent<HTMLFormElement>): Promise<void> {
    evento.preventDefault();
    setErros([]);

    if (novaSenha !== confirmacao) {
      setErros(['A confirmação não confere com a nova senha.']);
      return;
    }

    setEnviando(true);

    try {
      await api.post(
        '/auth/senha/redefinir',
        {
          token: tokenRef.current,
          novaSenha,
          confirmacaoNovaSenha: confirmacao,
        },
        { semAutenticacao: true },
      );

      setEstado({ fase: 'concluido' });
      tokenRef.current = '';
    } catch (falha) {
      if (falha instanceof ApiError) {
        if (falha.codigo === 'TOKEN_REDEFINICAO_INVALIDO') {
          setEstado({ fase: 'invalido', mensagem: falha.message });
          return;
        }

        const detalhes = falha.mensagensDeValidacao;
        setErros(detalhes.length > 0 ? detalhes : [falha.message]);
      } else {
        setErros(['Não foi possível redefinir a senha. Verifique sua conexão.']);
      }
      setEnviando(false);
    }
  }

  if (estado.fase === 'verificando') {
    return (
      <main className="login">
        <div className="login__cartao">
          <p className="texto-discreto">Verificando o link…</p>
        </div>
      </main>
    );
  }

  if (estado.fase === 'invalido') {
    return (
      <main className="login">
        <div className="login__cartao">
          <header className="login__cabecalho">
            <h1>Link inválido</h1>
            <p>{estado.mensagem}</p>
          </header>

          <p className="texto-discreto">
            Links de redefinição valem por poucos minutos e servem uma vez só.
            Pedir um novo leva menos de um minuto.
          </p>

          <Link className="botao botao--principal" to="/esqueci-senha" role="button">
            Pedir um link novo
          </Link>

          <footer className="login__rodape">
            <p>
              <Link to="/login">Voltar para o login</Link>
            </p>
          </footer>
        </div>
      </main>
    );
  }

  if (estado.fase === 'concluido') {
    return (
      <main className="login">
        <div className="login__cartao">
          <header className="login__cabecalho">
            <h1>Senha redefinida</h1>
            <p>
              Sua senha foi alterada e todas as sessões anteriores foram
              encerradas. Entre com a nova senha.
            </p>
          </header>

          <Link className="botao botao--principal" to="/login" role="button">
            Ir para o login
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="login">
      <div className="login__cartao login__cartao--largo">
        <header className="login__cabecalho">
          <h1>Criar senha nova</h1>
          <p>
            Olá, {estado.conta.nome.split(' ')[0]}. Você está redefinindo a senha
            da conta <strong>{estado.conta.emailMascarado}</strong>.
          </p>
        </header>

        <form onSubmit={(e) => void aoEnviar(e)} noValidate>
          <div className="campo">
            <label htmlFor="nova">Nova senha</label>
            <input
              id="nova"
              type="password"
              value={novaSenha}
              onChange={(e) => setNovaSenha(e.target.value)}
              autoComplete="new-password"
              required
              autoFocus
              disabled={enviando}
              maxLength={128}
            />
            <ul className="regras-senha">
              <li className={novaSenha.length >= 12 ? 'regras-senha--ok' : undefined}>
                Ao menos 12 caracteres
              </li>
              <li
                className={
                  /[a-zA-Z]/.test(novaSenha) && /[0-9]/.test(novaSenha)
                    ? 'regras-senha--ok'
                    : undefined
                }
              >
                Letras e números
              </li>
              <li>Sem seu nome, seu e-mail ou sequências comuns</li>
            </ul>
          </div>

          <div className="campo">
            <label htmlFor="confirma">Confirme a nova senha</label>
            <input
              id="confirma"
              type="password"
              value={confirmacao}
              onChange={(e) => setConfirmacao(e.target.value)}
              autoComplete="new-password"
              required
              disabled={enviando}
              maxLength={128}
            />
          </div>

          {erros.length > 0 && (
            <div className="alerta alerta--erro" role="alert" aria-live="assertive">
              {erros.map((mensagem) => (
                <p key={mensagem}>{mensagem}</p>
              ))}
            </div>
          )}

          <button type="submit" className="botao botao--principal" disabled={enviando}>
            {enviando ? 'Salvando…' : 'Salvar nova senha'}
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
