import { useState } from 'react';

import { SenhaGerada } from '@/components/configuracoes/SenhaGerada';
import { ApiError } from '@/lib/api';
import { usuariosApi, type Papel, type UsuarioDetalhado } from '@/lib/usuarios';

interface Props {
  papeis: Papel[];
  aoVoltar: () => void;
  aoCriar: (usuario: UsuarioDetalhado) => void;
}

/**
 * Cadastro de novo usuário. Sem campo de senha de propósito: o servidor gera uma
 * aleatória, trocada no primeiro acesso, para a conta ter dono único.
 */
export function NovoUsuario({ papeis, aoVoltar, aoCriar }: Props): React.JSX.Element {
  const [form, setForm] = useState({
    nome: '',
    sobrenome: '',
    dataNascimento: '',
    email: '',
    papel: papeis.find((p) => p.chave === 'corretor_corretora')?.chave ?? papeis[0]?.chave ?? '',
  });

  const [erros, setErros] = useState<string[]>([]);
  const [enviando, setEnviando] = useState(false);
  const [criado, setCriado] = useState<{
    usuario: UsuarioDetalhado;
    senha: string;
    aviso: string;
  } | null>(null);

  const papelEscolhido = papeis.find((p) => p.chave === form.papel);

  async function enviar(evento: React.FormEvent): Promise<void> {
    evento.preventDefault();
    setErros([]);
    setEnviando(true);

    try {
      const resposta = await usuariosApi.criar({
        nome: form.nome.trim(),
        sobrenome: form.sobrenome.trim() || undefined,
        dataNascimento: form.dataNascimento || undefined,
        email: form.email.trim(),
        papel: form.papel,
      });

      setCriado({
        usuario: resposta.usuario,
        senha: resposta.senhaTemporaria,
        aviso: resposta.aviso,
      });
      aoCriar(resposta.usuario);
    } catch (falha) {
      if (falha instanceof ApiError) {
        const detalhes = falha.mensagensDeValidacao;
        setErros(detalhes.length > 0 ? detalhes : [falha.message]);
      } else {
        setErros(['Não foi possível cadastrar. Verifique sua conexão.']);
      }
    } finally {
      setEnviando(false);
    }
  }

  // Só a senha na tela: é a única vez que aparece, e nada deve competir com ela.
  if (criado) {
    return (
      <div className="ficha">
        <header className="ficha__topo">
          <button
            type="button"
            className="ficha__voltar"
            onClick={aoVoltar}
            aria-label="Voltar à lista de usuários"
          >
            ←
          </button>
          <h3 className="ficha__identidade">Usuário cadastrado</h3>
        </header>

        <p className="alerta alerta--ok" role="status">
          <strong>{criado.usuario.nomeCompleto}</strong> foi cadastrado como{' '}
          {criado.usuario.papelNome}.
        </p>

        <SenhaGerada titulo="Senha de primeiro acesso" senha={criado.senha} aviso={criado.aviso} />
      </div>
    );
  }

  return (
    <div className="ficha">
      <header className="ficha__topo">
        <button
          type="button"
          className="ficha__voltar"
          onClick={aoVoltar}
          aria-label="Voltar à lista de usuários"
        >
          ←
        </button>
        <div className="ficha__identidade">
          <h3>Novo usuário</h3>
          <p>A senha é gerada pelo sistema e mostrada uma única vez ao concluir.</p>
        </div>
      </header>

      {erros.length > 0 && (
        <div className="alerta alerta--erro" role="alert">
          {erros.map((mensagem) => (
            <p key={mensagem}>{mensagem}</p>
          ))}
        </div>
      )}

      <form className="formulario" onSubmit={(e) => void enviar(e)} noValidate>
        <div className="formulario__linha">
          <label className="campo-form">
            <span>
              Nome <em>obrigatório</em>
            </span>
            <input
              value={form.nome}
              onChange={(e) => setForm({ ...form, nome: e.target.value })}
              required
              maxLength={150}
              autoFocus
            />
          </label>

          <label className="campo-form">
            <span>Sobrenome</span>
            <input
              value={form.sobrenome}
              onChange={(e) => setForm({ ...form, sobrenome: e.target.value })}
              maxLength={150}
            />
          </label>
        </div>

        <label className="campo-form">
          <span>
            E-mail <em>obrigatório</em>
          </span>
          <input
            type="email"
            value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
            required
            maxLength={254}
            autoComplete="off"
          />
          <small>É com este e-mail que a pessoa vai entrar. Não pode ser alterado depois.</small>
        </label>

        <div className="formulario__linha">
          <label className="campo-form">
            <span>Data de nascimento</span>
            <input
              type="date"
              value={form.dataNascimento}
              onChange={(e) => setForm({ ...form, dataNascimento: e.target.value })}
              max={new Date().toISOString().slice(0, 10)}
            />
          </label>

          <label className="campo-form">
            <span>
              Papel <em>obrigatório</em>
            </span>
            <select
              value={form.papel}
              onChange={(e) => setForm({ ...form, papel: e.target.value })}
              required
            >
              {papeis.filter((p) => p.ativo !== false).map((p) => (
                <option key={p.chave} value={p.chave}>
                  {p.nome}
                </option>
              ))}
            </select>
            {papelEscolhido && (
              <small>
                {papelEscolhido.descricao} · {papelEscolhido.totalPermissoes} permissões
              </small>
            )}
          </label>
        </div>

        <p className="nota-integracao">
          <strong>A senha é gerada pelo sistema.</strong> Você não define a senha de
          outra pessoa: o servidor cria uma aleatória, mostra uma única vez ao
          concluir, e ela é obrigada a trocá-la no primeiro acesso. Até lá, o
          acesso ao sistema fica bloqueado.
        </p>

        <div className="formulario__acoes">
          <button type="button" className="botao botao--discreto botao--compacto" onClick={aoVoltar}>
            Cancelar
          </button>
          <button
            type="submit"
            className="botao botao--principal botao--compacto"
            disabled={enviando || !form.nome.trim() || !form.email.trim()}
          >
            {enviando ? 'Cadastrando…' : 'Cadastrar usuário'}
          </button>
        </div>
      </form>
    </div>
  );
}
