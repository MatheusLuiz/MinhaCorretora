import { useCallback, useEffect, useMemo, useState } from 'react';

import { DetalheUsuario } from '@/components/configuracoes/DetalheUsuario';
import { NovoUsuario } from '@/components/configuracoes/NovoUsuario';
import { Paginacao, usePaginacao } from '@/components/Paginacao';
import { useAuth } from '@/hooks/useAuth';
import { ApiError } from '@/lib/api';
import {
  formatarDataHora,
  usuariosApi,
  type Papel,
  type UsuarioDetalhado,
} from '@/lib/usuarios';

type Filtro = 'todos' | 'ativos' | 'inativos';
type Modo = { tela: 'lista' } | { tela: 'detalhe'; id: string } | { tela: 'novo' };

/** Gestão de usuários: lista, ficha e cadastro no mesmo espaço (o modal é estreito para mestre-detalhe). */
export function PainelUsuarios(): React.JSX.Element {
  const { usuario: usuarioAtual } = useAuth();

  const [usuarios, setUsuarios] = useState<UsuarioDetalhado[]>([]);
  const [papeis, setPapeis] = useState<Papel[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);

  const [busca, setBusca] = useState('');
  const [filtro, setFiltro] = useState<Filtro>('todos');
  const [modo, setModo] = useState<Modo>({ tela: 'lista' });

  const carregar = useCallback(async () => {
    setErro(null);
    try {
      const [lista, cargos] = await Promise.all([usuariosApi.listar(), usuariosApi.papeis()]);
      setUsuarios(lista.usuarios);
      setPapeis(cargos.papeis);
    } catch (falha) {
      setErro(
        falha instanceof ApiError ? falha.message : 'Não foi possível carregar os usuários.',
      );
    } finally {
      setCarregando(false);
    }
  }, []);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  const substituir = useCallback((atualizado: UsuarioDetalhado) => {
    setUsuarios((lista) => {
      const existe = lista.some((u) => u.id === atualizado.id);
      return existe
        ? lista.map((u) => (u.id === atualizado.id ? atualizado : u))
        : [...lista, atualizado];
    });
  }, []);

  const visiveis = useMemo(() => {
    const termo = busca.trim().toLowerCase();

    return usuarios.filter((u) => {
      if (filtro === 'ativos' && !u.ativo) return false;
      if (filtro === 'inativos' && u.ativo) return false;
      if (!termo) return true;
      return (
        u.nomeCompleto.toLowerCase().includes(termo) || u.email.toLowerCase().includes(termo)
      );
    });
  }, [usuarios, busca, filtro]);
  // 6 cabe na janela sem rolar numa tela de notebook.
  const pagina = usePaginacao(visiveis, [busca, filtro], 6);

  if (carregando) {
    return <p className="texto-discreto">Carregando usuários…</p>;
  }

  if (erro && usuarios.length === 0) {
    return (
      <div className="alerta alerta--erro" role="alert">
        <p>{erro}</p>
        <button type="button" className="botao botao--discreto botao--compacto" onClick={() => void carregar()}>
          Tentar de novo
        </button>
      </div>
    );
  }

  if (modo.tela === 'novo') {
    return (
      <NovoUsuario
        papeis={papeis}
        aoVoltar={() => setModo({ tela: 'lista' })}
        aoCriar={substituir}
      />
    );
  }

  if (modo.tela === 'detalhe') {
    const alvo = usuarios.find((u) => u.id === modo.id);

    if (!alvo) {
      setModo({ tela: 'lista' });
      return <p className="texto-discreto">Usuário não encontrado.</p>;
    }

    return (
      <DetalheUsuario
        usuario={alvo}
        papeis={papeis}
        aoVoltar={() => setModo({ tela: 'lista' })}
        aoAtualizar={substituir}
      />
    );
  }

  const ativos = usuarios.filter((u) => u.ativo).length;
  const admins = usuarios.filter((u) => u.ativo && u.papel === 'admin').length;

  return (
    <div className="usuarios">
      <div className="usuarios__barra">
        <label className="campo-busca">
          <span className="visualmente-oculto">Buscar usuário</span>
          <input
            type="search"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar por nome ou e-mail"
          />
        </label>

        <div className="segmentado" role="group" aria-label="Filtrar por situação">
          {(['todos', 'ativos', 'inativos'] as const).map((opcao) => (
            <button
              key={opcao}
              type="button"
              className={
                filtro === opcao ? 'segmentado__opcao segmentado__opcao--ativa' : 'segmentado__opcao'
              }
              onClick={() => setFiltro(opcao)}
              aria-pressed={filtro === opcao}
            >
              {opcao === 'todos' ? 'Todos' : opcao === 'ativos' ? 'Ativos' : 'Inativos'}
            </button>
          ))}
        </div>

        <button
          type="button"
          className="botao botao--principal botao--compacto"
          onClick={() => setModo({ tela: 'novo' })}
        >
          Novo usuário
        </button>
      </div>

      <p className="usuarios__resumo texto-discreto">
        {ativos} ativo(s) de {usuarios.length} · {admins} administrador(es)
      </p>

      {erro && (
        <p className="alerta alerta--erro" role="alert">
          {erro}
        </p>
      )}

      {/* Poucas colunas: mais que isso cria rolagem horizontal no modal. */}
      <table className="tabela tabela--densa tabela--clicavel">
        <thead>
          <tr>
            <th scope="col">Usuário</th>
            <th scope="col">Papel</th>
            <th scope="col">Situação</th>
          </tr>
        </thead>
        <tbody>
          {pagina.visiveis.map((u) => (
            <tr
              key={u.id}
              className={u.ativo ? undefined : 'tabela__linha--inativa'}
              onClick={() => setModo({ tela: 'detalhe', id: u.id })}
              // Alcançável por teclado: tabIndex + Enter/Espaço fazem o papel de botão.
              tabIndex={0}
              role="button"
              aria-label={`Ver ficha de ${u.nomeCompleto}`}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  setModo({ tela: 'detalhe', id: u.id });
                }
              }}
            >
              <td>
                <div className="usuarios__identidade">
                  <span className="usuarios__avatar" aria-hidden="true">
                    {iniciais(u.nomeCompleto)}
                  </span>
                  <div>
                    <strong>
                      {u.nomeCompleto}
                      {u.email === usuarioAtual?.email && (
                        <span className="usuarios__voce">você</span>
                      )}
                    </strong>
                    <small>{u.email}</small>
                  </div>
                </div>
              </td>

              <td>{u.papelNome}</td>

              <td className="usuarios__situacao">
                <span className={`etiqueta ${u.ativo ? 'etiqueta--ok' : 'etiqueta--tranquilo'}`}>
                  {u.ativo ? 'Ativo' : 'Inativo'}
                </span>
                {u.precisaTrocarSenha && (
                  <span className="etiqueta etiqueta--atencao">Senha provisória</span>
                )}
                {u.bloqueado && <span className="etiqueta etiqueta--critico">Bloqueado</span>}
                <small className="texto-discreto">{formatarDataHora(u.ultimoLoginEm)}</small>
              </td>
            </tr>
          ))}

          {visiveis.length === 0 && (
            <tr>
              <td colSpan={3} className="tabela__vazio">
                Nenhum usuário corresponde ao filtro.
              </td>
            </tr>
          )}
        </tbody>
      </table>

      <Paginacao p={pagina} />
    </div>
  );
}

function iniciais(nome: string): string {
  const partes = nome.trim().split(/\s+/);
  const primeira = partes[0]?.[0] ?? '';
  const ultima = partes.length > 1 ? (partes[partes.length - 1]?.[0] ?? '') : '';
  return (primeira + ultima).toUpperCase();
}
