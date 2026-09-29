import { useCallback, useEffect, useMemo, useState } from 'react';

import { ApiError } from '@/lib/api';
import { usuariosApi, type ProdutorCarteira } from '@/lib/usuarios';

/**
 * Por quais produtores esta pessoa responde. Sem `clientes.todos`, carteira
 * vazia = nenhum cliente visível (acesso se concede, não se presume).
 */
export function PainelCarteira({
  usuarioId,
  papelNome,
  veTudo,
}: {
  usuarioId: string;
  papelNome: string;
  /** O papel já concede `clientes.todos`: o vínculo não muda o que ele vê. */
  veTudo: boolean;
}): React.JSX.Element {
  const [catalogo, setCatalogo] = useState<ProdutorCarteira[]>([]);
  const [marcados, setMarcados] = useState<Set<number>>(new Set());
  const [original, setOriginal] = useState<Set<number>>(new Set());
  const [busca, setBusca] = useState('');
  const [carregando, setCarregando] = useState(true);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  const carregar = useCallback(async (): Promise<void> => {
    setCarregando(true);
    setErro(null);

    try {
      const [todos, doUsuario] = await Promise.all([
        usuariosApi.produtores(),
        usuariosApi.carteira(usuarioId),
      ]);

      setCatalogo(todos.produtores);

      const ids = new Set(doUsuario.produtores.map((p) => p.id));
      setMarcados(ids);
      setOriginal(ids);
    } catch (falha) {
      setErro(falha instanceof ApiError ? falha.message : 'Não foi possível carregar a carteira.');
    } finally {
      setCarregando(false);
    }
  }, [usuarioId]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  const mudou = useMemo(
    () => marcados.size !== original.size || [...marcados].some((id) => !original.has(id)),
    [marcados, original],
  );

  // Sem o corte de 60: "marcar todos" age sobre a busca inteira, não só o que está na tela.
  const correspondentes = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    return termo ? catalogo.filter((p) => p.nome.toLowerCase().includes(termo)) : catalogo;
  }, [catalogo, busca]);

  const visiveis = useMemo(
    () =>
      // Marcados primeiro, senão somem no meio de centenas de linhas.
      [...correspondentes]
        .sort((a, b) => {
          const ma = marcados.has(a.id) ? 0 : 1;
          const mb = marcados.has(b.id) ? 0 : 1;
          return ma !== mb ? ma - mb : b.clientes - a.clientes;
        })
        .slice(0, 60),
    [correspondentes, marcados],
  );

  const porMarcar = correspondentes.filter((p) => !marcados.has(p.id)).length;
  const porDesmarcar = correspondentes.length - porMarcar;

  function alternar(id: number): void {
    setAviso(null);
    setMarcados((antes) => {
      const proximo = new Set(antes);
      if (proximo.has(id)) proximo.delete(id);
      else proximo.add(id);
      return proximo;
    });
  }

  function definirTodos(marcar: boolean): void {
    setAviso(null);
    setMarcados((antes) => {
      const proximo = new Set(antes);
      for (const p of correspondentes) {
        if (marcar) proximo.add(p.id);
        else proximo.delete(p.id);
      }
      return proximo;
    });
  }

  async function salvar(): Promise<void> {
    setSalvando(true);
    setErro(null);

    try {
      const r = await usuariosApi.definirCarteira(usuarioId, [...marcados]);
      setOriginal(new Set(r.produtores.map((p) => p.id)));
      setAviso(r.aviso);
    } catch (falha) {
      setErro(falha instanceof ApiError ? falha.message : 'Não foi possível salvar a carteira.');
    } finally {
      setSalvando(false);
    }
  }

  const cadastros = catalogo
    .filter((p) => marcados.has(p.id))
    .reduce((soma, p) => soma + p.clientes, 0);

  return (
    <section className="bloco">
      <header className="bloco__cabecalho">
        <div>
          <h4>Carteira</h4>
          <p className="texto-discreto">
            {veTudo ? (
              <>
                O papel <strong>{papelNome}</strong> já vê a base inteira, então o
                vínculo abaixo não restringe nada hoje. Ele fica guardado e passa
                a valer se a pessoa virar corretora.
              </>
            ) : (
              <>
                O papel <strong>{papelNome}</strong> só enxerga os clientes dos
                produtores marcados aqui — em clientes, apólices, painéis e
                inadimplência.
              </>
            )}
          </p>
        </div>
      </header>

      {erro && (
        <p className="alerta alerta--erro" role="alert">
          {erro}
        </p>
      )}

      {aviso && (
        <p className="alerta alerta--ok" role="status">
          {aviso}
        </p>
      )}

      {carregando ? (
        <p className="texto-discreto">Carregando produtores…</p>
      ) : (
        <>
          {!veTudo && marcados.size === 0 && (
            <p className="alerta alerta--aviso" role="note">
              <strong>Nenhum produtor vinculado.</strong> Com este papel, a pessoa
              abre o sistema e não vê cliente nenhum.
            </p>
          )}

          <p className="texto-discreto">
            {marcados.size} produtor(es) · {cadastros.toLocaleString('pt-BR')} cadastro(s)
            na carteira
          </p>

          <div className="barra-filtros">
            <label className="campo-busca">
              <span className="visualmente-oculto">Buscar produtor</span>
              <input
                type="search"
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
                placeholder={`Buscar entre os ${catalogo.length} produtores…`}
                autoComplete="off"
              />
            </label>

            <button
              type="button"
              className="botao botao--discreto botao--compacto"
              onClick={() => definirTodos(true)}
              disabled={porMarcar === 0}
            >
              Marcar {busca.trim() ? `os ${porMarcar} encontrados` : `todos (${porMarcar})`}
            </button>

            <button
              type="button"
              className="botao botao--discreto botao--compacto"
              onClick={() => definirTodos(false)}
              disabled={porDesmarcar === 0}
            >
              Desmarcar {busca.trim() ? `os ${porDesmarcar} encontrados` : `todos (${porDesmarcar})`}
            </button>
          </div>

          <div className="lista-carteira">
            {visiveis.map((p) => (
              <label key={p.id} className="campo-check">
                <input
                  type="checkbox"
                  checked={marcados.has(p.id)}
                  onChange={() => alternar(p.id)}
                />
                <span>
                  {p.nome}
                  <br />
                  <span className="texto-discreto">
                    {p.clientes.toLocaleString('pt-BR')} cadastro(s)
                  </span>
                </span>
              </label>
            ))}

            {visiveis.length === 0 && (
              <p className="texto-discreto">Nenhum produtor com esse nome.</p>
            )}
          </div>

          {/* Avisa o corte para ninguém concluir que o produtor não existe. */}
          {catalogo.length > visiveis.length && (
            <p className="texto-discreto">
              Mostrando {visiveis.length} de {catalogo.length}. Use a busca para
              achar os demais.
            </p>
          )}

          <div className="formulario__acoes">
            <button
              type="button"
              className="botao botao--discreto botao--compacto"
              onClick={() => setMarcados(new Set(original))}
              disabled={!mudou || salvando}
            >
              Desfazer
            </button>
            <button
              type="button"
              className="botao botao--principal botao--compacto"
              onClick={() => void salvar()}
              disabled={!mudou || salvando}
            >
              {salvando ? 'Salvando…' : 'Salvar carteira'}
            </button>
          </div>
        </>
      )}
    </section>
  );
}
