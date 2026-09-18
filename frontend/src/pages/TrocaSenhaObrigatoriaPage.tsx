import { useEffect, useState, type FormEvent } from 'react';

import { useAuth } from '@/hooks/useAuth';
import { api, ApiError } from '@/lib/api';

/** Troca obrigatória da senha provisória. Barreira de interface; a que vale é `exigirTrocaDeSenha` no servidor. */
export function TrocaSenhaObrigatoriaPage(): React.JSX.Element {
  const { usuario, sair, atualizarPerfil } = useAuth();

  const [senhaAtual, setSenhaAtual] = useState('');
  const [novaSenha, setNovaSenha] = useState('');
  const [confirmacao, setConfirmacao] = useState('');
  const [erros, setErros] = useState<string[]>([]);
  const [enviando, setEnviando] = useState(false);
  const [concluido, setConcluido] = useState(false);

  useEffect(() => {
    document.title = 'Defina sua senha — MinhaCorretora';
  }, []);

  async function enviar(evento: FormEvent): Promise<void> {
    evento.preventDefault();
    setErros([]);

    if (novaSenha !== confirmacao) {
      setErros(['A confirmação não confere com a nova senha.']);
      return;
    }

    setEnviando(true);

    try {
      await api.post('/auth/senha', {
        senhaAtual,
        novaSenha,
        confirmacaoNovaSenha: confirmacao,
      });

      // A troca revoga TODAS as sessões, inclusive esta: o caminho é sair e entrar de novo.
      setConcluido(true);
      setTimeout(() => void sair(), 2500);
    } catch (falha) {
      if (falha instanceof ApiError) {
        const detalhes = falha.mensagensDeValidacao;
        setErros(detalhes.length > 0 ? detalhes : [falha.message]);
      } else {
        setErros(['Não foi possível alterar a senha. Verifique sua conexão.']);
      }
      setEnviando(false);
    }
  }

  // Se o perfil for atualizado por fora e a troca já tiver ocorrido, sai daqui.
  useEffect(() => {
    if (usuario && !usuario.precisaTrocarSenha) {
      void atualizarPerfil();
    }
  }, [usuario, atualizarPerfil]);

  if (concluido) {
    return (
      <main className="login">
        <div className="login__cartao">
          <h1>Senha definida</h1>
          <p className="texto-discreto">
            Sua senha foi alterada e todas as sessões anteriores foram encerradas.
            Entre novamente com a nova senha.
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="login">
      <div className="login__cartao login__cartao--largo">
        <header className="login__cabecalho">
          <h1>Defina sua senha</h1>
          <p>
            Olá, {usuario?.nome.split(' ')[0]}. Sua senha atual é provisória e precisa
            ser trocada antes do primeiro uso.
          </p>
        </header>

        <p className="aviso-ficticio" role="note">
          A senha provisória foi criada por outra pessoa e pode ter circulado por
          mensagem. Só depois desta troca a conta passa a ser exclusivamente sua.
        </p>

        <form onSubmit={(e) => void enviar(e)} noValidate>
          <div className="campo">
            <label htmlFor="atual">Senha provisória</label>
            <input
              id="atual"
              type="password"
              value={senhaAtual}
              onChange={(e) => setSenhaAtual(e.target.value)}
              autoComplete="current-password"
              required
              autoFocus
              maxLength={128}
            />
          </div>

          <div className="campo">
            <label htmlFor="nova">Nova senha</label>
            <input
              id="nova"
              type="password"
              value={novaSenha}
              onChange={(e) => setNovaSenha(e.target.value)}
              autoComplete="new-password"
              required
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
            {enviando ? 'Salvando…' : 'Definir senha e continuar'}
          </button>
        </form>

        <footer className="login__rodape">
          <button type="button" className="botao botao--discreto botao--compacto" onClick={() => void sair()}>
            Sair sem trocar
          </button>
        </footer>
      </div>
    </main>
  );
}
