import { useCallback, useEffect, useState } from 'react';

import { ApiError } from '@/lib/api';
import { formatarNumero } from '@/lib/formato';
import { gruposClienteApi, type GrupoCliente } from '@/lib/gruposCliente';

/** Grupos de cliente; grupo criado aqui se atribui na ficha do cliente ("Corrigir cadastro"). */
export function PainelGruposCliente(): React.JSX.Element {
  const [grupos, setGrupos] = useState<GrupoCliente[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [editando, setEditando] = useState<GrupoCliente | 'novo' | null>(null);
  const [ocupado, setOcupado] = useState<number | null>(null);

  const carregar = useCallback(async (): Promise<void> => {
    setCarregando(true);
    setErro(null);
    try {
      setGrupos((await gruposClienteApi.listar()).grupos);
    } catch (falha) {
      setErro(falha instanceof ApiError ? falha.message : 'Não foi possível carregar os grupos de cliente.');
    } finally {
      setCarregando(false);
    }
  }, []);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  const trocarGrupo = (salvo: GrupoCliente): void =>
    setGrupos((antes) =>
      (antes.some((g) => g.id === salvo.id)
        ? antes.map((g) => (g.id === salvo.id ? salvo : g))
        : [...antes, salvo]
      ).sort((a, b) => a.ordem - b.ordem || a.nome.localeCompare(b.nome, 'pt-BR')),
    );

  async function alternarAtivo(grupo: GrupoCliente): Promise<void> {
    setOcupado(grupo.id);
    setAviso(null);
    try {
      trocarGrupo((await gruposClienteApi.definirSituacao(grupo.id, !grupo.ativo)).grupo);
    } catch (falha) {
      setAviso(falha instanceof ApiError ? falha.message : 'Não foi possível salvar a mudança.');
    } finally {
      setOcupado(null);
    }
  }

  if (editando !== null) {
    return (
      <FormularioGrupo
        grupo={editando === 'novo' ? null : editando}
        aoVoltar={() => setEditando(null)}
        aoSalvar={(salvo) => {
          trocarGrupo(salvo);
          setEditando(null);
        }}
      />
    );
  }

  if (carregando) return <p className="texto-discreto">Carregando grupos de cliente…</p>;

  if (erro) {
    return (
      <div className="alerta alerta--erro" role="alert">
        <p>{erro}</p>
        <button type="button" className="botao botao--discreto botao--compacto" onClick={() => void carregar()}>
          Tentar de novo
        </button>
      </div>
    );
  }

  return (
    <div className="usuarios tipos-seguro">
      <div className="usuarios__barra">
        <button
          type="button"
          className="botao botao--principal botao--compacto"
          onClick={() => setEditando('novo')}
        >
          Novo grupo
        </button>
      </div>

      {aviso && (
        <div className="alerta alerta--erro" role="alert">
          <p>{aviso}</p>
        </div>
      )}

      <div className="tabela-rolante">
        <table className="tabela tabela--densa">
          <thead>
            <tr>
              <th scope="col">Grupo</th>
              <th scope="col" className="tabela__num">Clientes</th>
              <th scope="col">Situação</th>
            </tr>
          </thead>
          <tbody>
            {grupos.map((g) => (
              <tr key={g.id} className={g.ativo ? undefined : 'tabela__linha--inativa'}>
                <td>
                  <button
                    type="button"
                    className="tipos-seguro__nome"
                    onClick={() => setEditando(g)}
                    title="Editar o grupo"
                  >
                    {g.nome}
                  </button>
                  {g.descricao && (
                    <>
                      <br />
                      <small className="texto-discreto">{g.descricao}</small>
                    </>
                  )}
                </td>
                <td className="tabela__num">{formatarNumero(g.clientes)}</td>
                <td>
                  <button
                    type="button"
                    className="botao botao--discreto botao--compacto"
                    disabled={ocupado === g.id}
                    onClick={() => void alternarAtivo(g)}
                    title={g.ativo ? 'Parar de oferecer na ficha do cliente' : 'Voltar a oferecer'}
                  >
                    {g.ativo ? 'Ativo' : 'Inativo'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function FormularioGrupo({
  grupo,
  aoVoltar,
  aoSalvar,
}: {
  grupo: GrupoCliente | null;
  aoVoltar: () => void;
  aoSalvar: (salvo: GrupoCliente) => void;
}): React.JSX.Element {
  const [nome, setNome] = useState(grupo?.nome ?? '');
  const [descricao, setDescricao] = useState(grupo?.descricao ?? '');
  const [salvando, setSalvando] = useState(false);
  const [erros, setErros] = useState<string[]>([]);

  async function enviar(evento: React.FormEvent): Promise<void> {
    evento.preventDefault();
    setSalvando(true);
    setErros([]);
    try {
      const dados = { nome, descricao };
      const { grupo: salvo } = grupo
        ? await gruposClienteApi.atualizar(grupo.id, { ...dados, ordem: grupo.ordem })
        : await gruposClienteApi.criar(dados);
      aoSalvar(salvo);
    } catch (falha) {
      const api = falha instanceof ApiError ? falha : null;
      setErros(
        api?.mensagensDeValidacao.length
          ? api.mensagensDeValidacao
          : [api?.message ?? 'Não foi possível salvar. Tente de novo.'],
      );
    } finally {
      setSalvando(false);
    }
  }

  return (
    <form className="formulario" onSubmit={(e) => void enviar(e)}>
      <button type="button" className="botao botao--discreto botao--compacto tipos-seguro__voltar" onClick={aoVoltar}>
        ← Grupos de cliente
      </button>

      <h3 className="formulario__titulo">{grupo ? `Editar ${grupo.nome}` : 'Novo grupo de cliente'}</h3>

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
          maxLength={60}
          required
          autoFocus
          placeholder="Ex.: Seguradora"
        />
      </label>

      <label className="campo-form campo-form--largo">
        <span>Descrição <em>opcional</em></span>
        <input
          type="text"
          value={descricao}
          onChange={(e) => setDescricao(e.target.value)}
          maxLength={200}
          placeholder="De onde vêm os clientes deste grupo"
        />
      </label>

      <div className="formulario__acoes">
        <button type="button" className="botao botao--discreto botao--compacto" onClick={aoVoltar} disabled={salvando}>
          Cancelar
        </button>
        <button type="submit" className="botao botao--principal botao--compacto" disabled={salvando}>
          {salvando ? 'Salvando…' : 'Salvar'}
        </button>
      </div>
    </form>
  );
}
