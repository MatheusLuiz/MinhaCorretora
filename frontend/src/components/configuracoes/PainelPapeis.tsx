import { useEffect, useState } from 'react';

import { Modal } from '@/components/Modal';
import { ApiError } from '@/lib/api';
import {
  PERMISSOES_DE_ALCANCE,
  ROTULO_PERMISSAO,
  usuariosApi,
  type Papel,
  type PapelDetalhado,
} from '@/lib/usuarios';

/** Sem acento e sem caixa, para as buscas. */
const comparavel = (s: string): string =>
  s
    .normalize('NFD')
    .replace(/[\u{300}-\u{36f}]/gu, '')
    .toLowerCase();

/** O que cada cargo pode fazer: lista de papéis; cada um abre suas permissões num modal. */
export function PainelPapeis(): React.JSX.Element {
  const [papeis, setPapeis] = useState<Papel[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [busca, setBusca] = useState('');
  const [aberto, setAberto] = useState<Papel | null>(null);
  const [criando, setCriando] = useState(false);

  const atualizarNaLista = (p: PapelDetalhado): void =>
    setPapeis((lista) => {
      const resumo: Papel = {
        chave: p.chave,
        nome: p.nome,
        descricao: p.descricao,
        totalPermissoes: p.permissoes.filter((x) => x.concedida).length,
        ativo: p.ativo,
        usuariosAtivos: p.usuariosAtivos,
      };
      return lista.some((x) => x.chave === p.chave)
        ? lista.map((x) => (x.chave === p.chave ? resumo : x))
        : [...lista, resumo];
    });

  useEffect(() => {
    let cancelado = false;

    void usuariosApi
      .papeis()
      .then(({ papeis: lista }) => {
        if (!cancelado) setPapeis(lista);
      })
      .catch((falha: unknown) => {
        if (!cancelado) {
          setErro(falha instanceof ApiError ? falha.message : 'Não foi possível carregar os papéis.');
        }
      })
      .finally(() => {
        if (!cancelado) setCarregando(false);
      });

    return () => {
      cancelado = true;
    };
  }, []);

  if (carregando) return <p className="texto-discreto">Carregando papéis…</p>;

  const termo = comparavel(busca.trim());
  const filtrados = termo
    ? papeis.filter((p) => comparavel(`${p.nome} ${p.descricao ?? ''}`).includes(termo))
    : papeis;

  return (
    <div className="papeis">
      <div className="tipos-seguro__barra">
        <input
          type="search"
          className="papeis__busca"
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          placeholder="Pesquisar papel…"
          aria-label="Pesquisar papel"
        />
        <button type="button" className="botao botao--principal botao--compacto" onClick={() => setCriando(true)}>
          Novo papel
        </button>
      </div>

      {erro && (
        <p className="alerta alerta--erro" role="alert">
          {erro}
        </p>
      )}

      {filtrados.length === 0 ? (
        <p className="texto-discreto">Nenhum papel com “{busca.trim()}”.</p>
      ) : (
        <ul className="papeis__lista">
          {filtrados.map((p) => (
            <li key={p.chave}>
              <button
                type="button"
                className={`papeis__item${p.ativo === false ? ' papeis__item--inativo' : ''}`}
                onClick={() => setAberto(p)}
                title={p.descricao ?? undefined}
              >
                <strong className="papeis__item-nome">{p.nome}</strong>
                <span className="papeis__item-total">
                  {p.ativo === false ? 'inativo' : `${p.totalPermissoes} ›`}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {aberto && (
        <PermissoesDoPapel
          papelResumo={aberto}
          aoFechar={() => setAberto(null)}
          aoSalvar={atualizarNaLista}
          aoExcluir={(chave) => {
            setPapeis((lista) => lista.filter((p) => p.chave !== chave));
            setAberto(null);
          }}
        />
      )}

      {criando && (
        <NovoPapel
          papeis={papeis}
          aoFechar={() => setCriando(false)}
          aoCriar={(novo) => {
            atualizarNaLista(novo);
            setCriando(false);
            setAberto({ chave: novo.chave, nome: novo.nome, descricao: novo.descricao, totalPermissoes: 0 });
          }}
        />
      )}
    </div>
  );
}

/** As permissões de um papel, num modal sobre Configurações. */
function PermissoesDoPapel({
  papelResumo,
  aoFechar,
  aoSalvar,
  aoExcluir,
}: {
  papelResumo: Papel;
  aoFechar: () => void;
  aoSalvar: (papel: PapelDetalhado) => void;
  aoExcluir: (chave: string) => void;
}): React.JSX.Element {
  const [papel, setPapel] = useState<PapelDetalhado | null>(null);
  const [selecionadas, setSelecionadas] = useState<Set<string>>(new Set());
  const [busca, setBusca] = useState('');
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [salvo, setSalvo] = useState(false);
  const [editandoDados, setEditandoDados] = useState(false);
  const [dados, setDados] = useState({ nome: papelResumo.nome, descricao: papelResumo.descricao ?? '' });

  useEffect(() => {
    let cancelado = false;

    void usuariosApi
      .detalharPapel(papelResumo.chave)
      .then(({ papel: p }) => {
        if (cancelado) return;
        setPapel(p);
        setDados({ nome: p.nome, descricao: p.descricao ?? '' });
        setSelecionadas(new Set(p.permissoes.filter((x) => x.concedida).map((x) => x.chave)));
      })
      .catch((falha: unknown) => {
        if (!cancelado) {
          setErro(falha instanceof ApiError ? falha.message : 'Não foi possível carregar o papel.');
        }
      });

    return () => {
      cancelado = true;
    };
  }, [papelResumo.chave]);

  const original = new Set(papel?.permissoes.filter((p) => p.concedida).map((p) => p.chave) ?? []);
  const mudou =
    selecionadas.size !== original.size || [...selecionadas].some((c) => !original.has(c));

  function alternar(chave: string): void {
    setSelecionadas((atual) => {
      const nova = new Set(atual);
      if (nova.has(chave)) nova.delete(chave);
      else nova.add(chave);
      return nova;
    });
    setSalvo(false);
  }

  async function salvar(): Promise<void> {
    if (!papel) return;

    setSalvando(true);
    setErro(null);

    try {
      const { papel: atualizado } = await usuariosApi.definirPermissoesDoPapel(papel.chave, [
        ...selecionadas,
      ]);
      const concedidas = atualizado.permissoes.filter((p) => p.concedida);
      setPapel(atualizado);
      setSelecionadas(new Set(concedidas.map((p) => p.chave)));
      setSalvo(true);
      aoSalvar(atualizado);
    } catch (falha: unknown) {
      setErro(falha instanceof ApiError ? falha.message : 'Não foi possível salvar.');
    } finally {
      setSalvando(false);
    }
  }

  async function salvarDados(evento: React.FormEvent): Promise<void> {
    evento.preventDefault();
    if (!papel) return;
    setSalvando(true);
    setErro(null);
    try {
      const { papel: atualizado } = await usuariosApi.editarPapel(papel.chave, {
        nome: dados.nome,
        descricao: dados.descricao,
      });
      setPapel(atualizado);
      setEditandoDados(false);
      aoSalvar(atualizado);
    } catch (falha: unknown) {
      setErro(falha instanceof ApiError ? falha.message : 'Não foi possível salvar o nome.');
    } finally {
      setSalvando(false);
    }
  }

  async function excluir(): Promise<void> {
    if (!papel) return;
    if (!window.confirm(`Excluir o papel "${papel.nome}"? Não dá para desfazer.`)) return;
    setSalvando(true);
    setErro(null);
    try {
      await usuariosApi.excluirPapel(papel.chave);
      aoExcluir(papel.chave);
    } catch (falha: unknown) {
      setErro(falha instanceof ApiError ? falha.message : 'Não foi possível excluir o papel.');
      setSalvando(false);
    }
  }

  async function alternarSituacao(): Promise<void> {
    if (!papel) return;
    setSalvando(true);
    setErro(null);
    try {
      const { papel: atualizado } = await usuariosApi.definirSituacaoPapel(papel.chave, !papel.ativo);
      setPapel(atualizado);
      aoSalvar(atualizado);
    } catch (falha: unknown) {
      setErro(falha instanceof ApiError ? falha.message : 'Não foi possível mudar a situação do papel.');
    } finally {
      setSalvando(false);
    }
  }

  // Um clique fora do modal jogaria fora a marcação sem aviso.
  function fechar(): void {
    if (mudou && !window.confirm('Há permissões alteradas e não salvas. Fechar e descartar?')) return;
    aoFechar();
  }

  const termo = comparavel(busca.trim());
  const visiveis = (papel?.permissoes ?? []).filter(
    (p) => !termo || comparavel(`${ROTULO_PERMISSAO[p.chave] ?? ''} ${p.chave} ${p.descricao ?? ''}`).includes(termo),
  );

  return (
    <Modal
      aberto
      aoFechar={fechar}
      titulo={`Permissões — ${papel?.nome ?? papelResumo.nome}`}
      descricao={(papel ? papel.descricao : papelResumo.descricao) ?? undefined}
    >
      <div className="modal__conteudo papeis__detalhe">
        {!papel && !erro && <p className="texto-discreto">Carregando permissões…</p>}

        {papel && editandoDados && (
          <form className="formulario" onSubmit={(e) => void salvarDados(e)}>
            <div className="formulario__linha">
              <label className="campo-form">
                <span>Nome</span>
                <input
                  type="text"
                  value={dados.nome}
                  onChange={(e) => setDados({ ...dados, nome: e.target.value })}
                  maxLength={100}
                  required
                  autoFocus
                />
              </label>
              <label className="campo-form campo-form--largo">
                <span>
                  Descrição <em>opcional</em>
                </span>
                <input
                  type="text"
                  value={dados.descricao}
                  onChange={(e) => setDados({ ...dados, descricao: e.target.value })}
                  maxLength={255}
                />
              </label>
            </div>
            <div className="formulario__acoes">
              <button
                type="button"
                className="botao botao--discreto botao--compacto"
                onClick={() => {
                  setDados({ nome: papel.nome, descricao: papel.descricao ?? '' });
                  setEditandoDados(false);
                }}
                disabled={salvando}
              >
                Cancelar
              </button>
              <button
                type="submit"
                className="botao botao--principal botao--compacto"
                disabled={salvando || dados.nome.trim().length < 2}
              >
                Salvar nome
              </button>
            </div>
          </form>
        )}

        {papel && !editandoDados && (
          <header className="papeis__cabecalho">
            <input
              type="search"
              className="papeis__busca"
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder="Pesquisar permissão…"
              aria-label="Pesquisar permissão"
              autoFocus
            />
            <span className={papel.usuariosAtivos > 0 ? 'papeis__alcance' : 'texto-discreto'}>
              {papel.usuariosAtivos === 0
                ? 'ninguém usa este cargo hoje'
                : papel.usuariosAtivos === 1
                  ? 'afeta 1 pessoa ativa'
                  : `afeta ${papel.usuariosAtivos} pessoas ativas`}
            </span>
            <button
              type="button"
              className="botao botao--discreto botao--compacto"
              onClick={() => setEditandoDados(true)}
              title="Mudar o nome e a descrição do papel"
            >
              Editar nome
            </button>
          </header>
        )}

        {erro && (
          <p className="alerta alerta--erro" role="alert">
            {erro}
          </p>
        )}
        {salvo && !mudou && (
          <p className="alerta alerta--sucesso" role="status">
            Permissões salvas. Quem tem este cargo passa a valer a regra nova no próximo acesso.
          </p>
        )}

        {papel && visiveis.length === 0 && (
          <p className="texto-discreto">Nenhuma permissão com “{busca.trim()}”.</p>
        )}

        {papel && visiveis.length > 0 && (
          <ul className="papeis__permissoes">
            {visiveis.map((p) => (
              <li key={p.chave}>
                <label
                  className="papeis__permissao"
                  title={`${p.chave}${p.descricao ? ` · ${p.descricao}` : ''}`}
                >
                  <input
                    type="checkbox"
                    checked={selecionadas.has(p.chave)}
                    onChange={() => alternar(p.chave)}
                  />
                  <span>
                    <strong>{ROTULO_PERMISSAO[p.chave] ?? p.chave}</strong>
                    {PERMISSOES_DE_ALCANCE.has(p.chave) && (
                      <span className="papeis__selo" title="Amplia o alcance: passa a ver além da própria carteira">
                        amplia
                      </span>
                    )}
                  </span>
                </label>
              </li>
            ))}
          </ul>
        )}

        {papel && (
          <footer className="papeis__acoes">
            <div className="papeis__acoes-grupo">
              {papel.chave !== 'admin' && papel.ativo !== undefined && (
                <button
                  type="button"
                  className="botao botao--discreto botao--compacto"
                  onClick={() => void alternarSituacao()}
                  disabled={salvando}
                  title={
                    papel.ativo
                      ? papel.usuariosAtivos > 0
                        ? 'Troque o papel das pessoas ativas antes de inativar'
                        : 'Sai da escolha ao criar ou editar usuário'
                      : 'Volta a aparecer na escolha de papel'
                  }
                >
                  {papel.ativo ? 'Inativar papel' : 'Reativar papel'}
                </button>
              )}
              {papel.chave !== 'admin' && papel.ativo !== undefined && (
                <button
                  type="button"
                  className="botao botao--perigo botao--compacto"
                  onClick={() => void excluir()}
                  disabled={salvando}
                  title="Só é possível excluir papel sem nenhum usuário, ativo ou inativo"
                >
                  Excluir
                </button>
              )}
            </div>
            <div className="papeis__acoes-grupo">
              <span className="texto-discreto">
                {selecionadas.size} de {papel.permissoes.length} marcadas
              </span>
              {mudou && (
                <button
                  type="button"
                  className="botao botao--discreto botao--compacto"
                  onClick={() => setSelecionadas(new Set(original))}
                  disabled={salvando}
                >
                  Descartar
                </button>
              )}
              <button
                type="button"
                className="botao botao--principal botao--compacto"
                onClick={() => void salvar()}
                disabled={!mudou || salvando}
              >
                {salvando ? 'Salvando…' : 'Salvar permissões'}
              </button>
            </div>
          </footer>
        )}
      </div>
    </Modal>
  );
}

/** Cadastro de papel: vazio ou copiando as permissões (e a visão geral) de outro. */
function NovoPapel({
  papeis,
  aoFechar,
  aoCriar,
}: {
  papeis: Papel[];
  aoFechar: () => void;
  aoCriar: (papel: PapelDetalhado) => void;
}): React.JSX.Element {
  const [nome, setNome] = useState('');
  const [descricao, setDescricao] = useState('');
  const [copiarDe, setCopiarDe] = useState('');
  const [salvando, setSalvando] = useState(false);
  const [erros, setErros] = useState<string[]>([]);

  async function enviar(evento: React.FormEvent): Promise<void> {
    evento.preventDefault();
    setSalvando(true);
    setErros([]);
    try {
      const { papel } = await usuariosApi.criarPapel({
        nome,
        descricao,
        ...(copiarDe ? { copiarDe } : {}),
      });
      aoCriar(papel);
    } catch (falha) {
      const api = falha instanceof ApiError ? falha : null;
      setErros(
        api?.mensagensDeValidacao.length
          ? api.mensagensDeValidacao
          : [api?.message ?? 'Não foi possível criar o papel.'],
      );
    } finally {
      setSalvando(false);
    }
  }

  return (
    <Modal aberto aoFechar={aoFechar} titulo="Novo papel">
      <form className="modal__conteudo formulario" onSubmit={(e) => void enviar(e)}>
        {erros.length > 0 && (
          <div className="alerta alerta--erro" role="alert">
            {erros.map((e) => (
              <p key={e}>{e}</p>
            ))}
          </div>
        )}

        <label className="campo-form">
          <span>Nome</span>
          <input
            type="text"
            value={nome}
            onChange={(e) => setNome(e.target.value)}
            maxLength={100}
            required
            autoFocus
            placeholder="Ex.: Cotação"
          />
        </label>

        <label className="campo-form campo-form--largo">
          <span>
            Descrição <em>opcional</em>
          </span>
          <input type="text" value={descricao} onChange={(e) => setDescricao(e.target.value)} maxLength={255} />
        </label>

        <label className="campo-form">
          <span>Começar com as permissões de</span>
          <select value={copiarDe} onChange={(e) => setCopiarDe(e.target.value)}>
            <option value="">Nenhuma (papel vazio)</option>
            {papeis.map((p) => (
              <option key={p.chave} value={p.chave}>
                {p.nome} — {p.totalPermissoes} permissões
              </option>
            ))}
          </select>
        </label>

        <div className="formulario__acoes">
          <button type="button" className="botao botao--discreto botao--compacto" onClick={aoFechar} disabled={salvando}>
            Cancelar
          </button>
          <button
            type="submit"
            className="botao botao--principal botao--compacto"
            disabled={salvando || nome.trim().length < 2}
          >
            {salvando ? 'Criando…' : 'Criar papel'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
