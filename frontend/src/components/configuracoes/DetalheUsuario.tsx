import { useState } from 'react';

import { PainelCarteira } from '@/components/configuracoes/PainelCarteira';
import { PainelPermissoes } from '@/components/configuracoes/PainelPermissoes';
import { SenhaGerada } from '@/components/configuracoes/SenhaGerada';
import { useAuth } from '@/hooks/useAuth';
import { ApiError } from '@/lib/api';
import {
  calcularIdade,
  formatarDataHora,
  formatarDataSimples,
  usuariosApi,
  type Papel,
  type UsuarioDetalhado,
} from '@/lib/usuarios';

interface Props {
  usuario: UsuarioDetalhado;
  papeis: Papel[];
  aoVoltar: () => void;
  aoAtualizar: (usuario: UsuarioDetalhado) => void;
}

type Aba = 'cadastro' | 'acesso';

/** Ficha do usuário: cadastro e acesso. Ações de acesso ficam isoladas no rodapé da aba "Acesso". */
export function DetalheUsuario({
  usuario,
  papeis,
  aoVoltar,
  aoAtualizar,
}: Props): React.JSX.Element {
  const { usuario: usuarioAtual } = useAuth();
  const [aba, setAba] = useState<Aba>('cadastro');
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [senhaNova, setSenhaNova] = useState<{ senha: string; aviso: string } | null>(null);
  const [editando, setEditando] = useState(false);

  const [form, setForm] = useState({
    nome: usuario.nome,
    sobrenome: usuario.sobrenome ?? '',
    dataNascimento: usuario.dataNascimento ?? '',
    papel: usuario.papel,
  });

  const souEu = usuario.email === usuarioAtual?.email;
  const idade = calcularIdade(usuario.dataNascimento);

  async function executar(acao: () => Promise<void>): Promise<void> {
    setErro(null);
    setOcupado(true);
    try {
      await acao();
    } catch (falha) {
      // As travas (último admin, própria conta) estão no servidor; a mensagem dele é a precisa.
      setErro(falha instanceof ApiError ? falha.message : 'Não foi possível concluir a ação.');
    } finally {
      setOcupado(false);
    }
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

        <span className="ficha__avatar" aria-hidden="true">
          {iniciais(usuario.nomeCompleto)}
        </span>

        <div className="ficha__identidade">
          <h3>
            {usuario.nomeCompleto}
            {souEu && <span className="usuarios__voce">você</span>}
          </h3>
          <p>{usuario.email}</p>
        </div>

        <div className="ficha__selos">
          <span className={`etiqueta ${usuario.ativo ? 'etiqueta--ok' : 'etiqueta--tranquilo'}`}>
            {usuario.ativo ? 'Ativo' : 'Inativo'}
          </span>
          {usuario.precisaTrocarSenha && (
            <span className="etiqueta etiqueta--atencao">Senha provisória</span>
          )}
          {usuario.bloqueado && <span className="etiqueta etiqueta--critico">Bloqueado</span>}
        </div>
      </header>

      <nav className="abas" aria-label="Seções da ficha">
        <button
          type="button"
          className={aba === 'cadastro' ? 'abas__item abas__item--ativa' : 'abas__item'}
          onClick={() => setAba('cadastro')}
          aria-current={aba === 'cadastro' ? 'true' : undefined}
        >
          Cadastro
        </button>
        <button
          type="button"
          className={aba === 'acesso' ? 'abas__item abas__item--ativa' : 'abas__item'}
          onClick={() => setAba('acesso')}
          aria-current={aba === 'acesso' ? 'true' : undefined}
        >
          Acesso e permissões
        </button>
      </nav>

      {erro && (
        <p className="alerta alerta--erro" role="alert">
          {erro}
        </p>
      )}

      {senhaNova && (
        <SenhaGerada
          titulo="Nova senha provisória"
          senha={senhaNova.senha}
          aviso={senhaNova.aviso}
        />
      )}

      {aba === 'cadastro' &&
        (editando ? (
          <form
            className="formulario"
            onSubmit={(e) => {
              e.preventDefault();
              void executar(async () => {
                const { usuario: atualizado } = await usuariosApi.editar(usuario.id, {
                  nome: form.nome,
                  // "" gravaria vazio: o backend distingue ausente (não mexer) de null (limpar).
                  sobrenome: form.sobrenome.trim() || undefined,
                  dataNascimento: form.dataNascimento || undefined,
                  papel: form.papel,
                });
                aoAtualizar(atualizado);
                setEditando(false);
              });
            }}
          >
            <div className="formulario__linha">
              <label className="campo-form">
                <span>Nome</span>
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
                <span>Papel</span>
                <select
                  value={form.papel}
                  onChange={(e) => setForm({ ...form, papel: e.target.value })}
                >
                  {papeis.filter((p) => p.ativo !== false || p.chave === usuario.papel).map((p) => (
                    <option key={p.chave} value={p.chave}>
                      {p.nome} — {p.totalPermissoes} permissões
                    </option>
                  ))}
                </select>
                <small>
                  Trocar o papel redefine as permissões e encerra as sessões da pessoa.
                </small>
              </label>
            </div>

            <p className="texto-discreto formulario__nota">
              O e-mail não é editável: ele é o identificador de login, e trocá-lo sem
              verificação permitiria redirecionar a conta de alguém para outra caixa.
            </p>

            <div className="formulario__acoes">
              <button
                type="button"
                className="botao botao--discreto botao--compacto"
                onClick={() => setEditando(false)}
              >
                Cancelar
              </button>
              <button
                type="submit"
                className="botao botao--principal botao--compacto"
                disabled={ocupado}
              >
                {ocupado ? 'Salvando…' : 'Salvar'}
              </button>
            </div>
          </form>
        ) : (
          <section className="bloco">
            <header className="bloco__cabecalho">
              <h4>Dados pessoais</h4>
              <button
                type="button"
                className="botao botao--discreto botao--compacto"
                onClick={() => setEditando(true)}
              >
                Editar
              </button>
            </header>

            <div className="cartoes-dado">
              <Dado rotulo="Nome" valor={usuario.nome} />
              <Dado rotulo="Sobrenome" valor={usuario.sobrenome} />
              <Dado rotulo="E-mail" valor={usuario.email} largo />
              <Dado
                rotulo="Data de nascimento"
                valor={
                  usuario.dataNascimento
                    ? `${formatarDataSimples(usuario.dataNascimento)}${idade !== null ? ` · ${idade} anos` : ''}`
                    : null
                }
              />
              <Dado rotulo="Papel" valor={usuario.papelNome} />
              <Dado rotulo="Cadastrado em" valor={formatarDataHora(usuario.criadoEm)} />
              <Dado rotulo="Senha alterada em" valor={formatarDataHora(usuario.senhaAlteradaEm)} />
            </div>
          </section>
        ))}

      {aba === 'acesso' && (
        <>
          <section className="bloco">
            <header className="bloco__cabecalho">
              <h4>Situação do acesso</h4>
            </header>

            <div className="cartoes-dado">
              <Dado rotulo="Situação" valor={usuario.ativo ? 'Ativo' : 'Inativo'} />
              <Dado rotulo="Último acesso" valor={formatarDataHora(usuario.ultimoLoginEm)} />
              <Dado
                rotulo="Tentativas falhas"
                valor={usuario.tentativasFalhas > 0 ? String(usuario.tentativasFalhas) : 'Nenhuma'}
              />
              <Dado
                rotulo="Bloqueio"
                valor={
                  usuario.bloqueado ? `Até ${formatarDataHora(usuario.bloqueadoAte)}` : 'Sem bloqueio'
                }
              />
            </div>
          </section>

          <PainelPermissoes
            usuarioId={usuario.id}
            papelNome={usuario.papelNome}
            ehVoceMesmo={souEu}
          />

          <PainelCarteira
            usuarioId={usuario.id}
            papelNome={usuario.papelNome}
            veTudo={usuario.permissoes.includes('clientes.todos')}
          />

          <section className="bloco bloco--sensivel">
            <header className="bloco__cabecalho">
              <div>
                <h4>Ações de acesso</h4>
                <p className="texto-discreto">
                  As duas encerram todas as sessões da pessoa imediatamente.
                </p>
              </div>
            </header>

            <div className="bloco__botoes">
              <button
                type="button"
                className="botao botao--discreto botao--compacto"
                disabled={ocupado}
                onClick={() =>
                  void executar(async () => {
                    const r = await usuariosApi.redefinirSenha(usuario.id);
                    setSenhaNova({ senha: r.senhaTemporaria, aviso: r.aviso });
                    const { usuario: atualizado } = await usuariosApi.detalhar(usuario.id);
                    aoAtualizar(atualizado);
                  })
                }
              >
                Redefinir senha
              </button>

              <button
                type="button"
                className={`botao botao--compacto ${usuario.ativo ? 'botao--perigo' : 'botao--discreto'}`}
                disabled={ocupado || (souEu && usuario.ativo)}
                title={
                  souEu && usuario.ativo ? 'Você não pode desativar a própria conta' : undefined
                }
                onClick={() =>
                  void executar(async () => {
                    const { usuario: atualizado } = await usuariosApi.alterarSituacao(
                      usuario.id,
                      !usuario.ativo,
                    );
                    aoAtualizar(atualizado);
                  })
                }
              >
                {usuario.ativo ? 'Desativar acesso' : 'Reativar acesso'}
              </button>
            </div>
          </section>
        </>
      )}
    </div>
  );
}

function Dado({
  rotulo,
  valor,
  largo,
}: {
  rotulo: string;
  valor: string | null;
  largo?: boolean;
}): React.JSX.Element {
  return (
    <div className={`cartao-dado${largo ? ' cartao-dado--largo' : ''}`}>
      <span className="cartao-dado__rotulo">{rotulo}</span>
      <span className="cartao-dado__valor">
        {valor ?? <span className="texto-discreto">não informado</span>}
      </span>
    </div>
  );
}

function iniciais(nome: string): string {
  const partes = nome.trim().split(/\s+/);
  const primeira = partes[0]?.[0] ?? '';
  const ultima = partes.length > 1 ? (partes[partes.length - 1]?.[0] ?? '') : '';
  return (primeira + ultima).toUpperCase();
}
