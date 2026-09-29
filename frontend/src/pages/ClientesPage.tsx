import { useCallback, useEffect, useRef, useState } from 'react';

import { CabecalhoPainel } from '@/components/Painel';
import { useCliente } from '@/hooks/useCliente';
import { ApiError } from '@/lib/api';
import {
  clientesApi,
  type ClienteResumo,
  type FiltrosDisponiveis,
  type ResultadoListagem,
} from '@/lib/clientes';

const POR_PAGINA = 50;

/** Consulta de clientes. A busca é no servidor: não manda a base inteira, com CPF e contato, ao navegador. */
export function ClientesPage(): React.JSX.Element {
  const { abrir } = useCliente();

  const [busca, setBusca] = useState('');
  const [situacao, setSituacao] = useState('');
  const [uf, setUf] = useState('');
  const [seguradora, setSeguradora] = useState('');
  const [pagina, setPagina] = useState(1);

  const [resultado, setResultado] = useState<ResultadoListagem | null>(null);
  const [filtros, setFiltros] = useState<FiltrosDisponiveis | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);

  // Debounce: sem ele, a resposta de "Sil" pode chegar depois da de "Silva" e sobrescrever a tela.
  const [buscaAplicada, setBuscaAplicada] = useState('');
  const temporizador = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    document.title = 'Clientes — MinhaCorretora';
  }, []);

  useEffect(() => {
    if (temporizador.current) clearTimeout(temporizador.current);

    temporizador.current = setTimeout(() => {
      setBuscaAplicada(busca);
      setPagina(1);
    }, 350);

    return () => {
      if (temporizador.current) clearTimeout(temporizador.current);
    };
  }, [busca]);

  useEffect(() => {
    void clientesApi
      .filtros()
      .then(setFiltros)
      .catch(() => {
      });
  }, []);

  const carregar = useCallback(async (): Promise<void> => {
    setCarregando(true);
    setErro(null);

    try {
      setResultado(
        await clientesApi.listar({
          busca: buscaAplicada,
          situacao,
          uf,
          seguradora,
          pagina,
          limite: POR_PAGINA,
        }),
      );
    } catch (falha) {
      setErro(
        falha instanceof ApiError
          ? falha.message
          : 'Não foi possível carregar os clientes. Verifique sua conexão.',
      );
      setResultado(null);
    } finally {
      setCarregando(false);
    }
  }, [buscaAplicada, situacao, uf, seguradora, pagina]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  const total = resultado?.total ?? 0;
  const paginas = resultado?.paginas ?? 1;
  const clientes = resultado?.clientes ?? [];
  const temFiltro = Boolean(buscaAplicada || situacao || uf || seguradora);

  function limpar(): void {
    setBusca('');
    setSituacao('');
    setUf('');
    setSeguradora('');
    setPagina(1);
  }

  return (
    <div className="painel">
      <CabecalhoPainel
        titulo="Clientes"
        descricao="Base importada. Clique em uma linha para abrir a ficha completa."
      />

      <section className="cartao cartao--largo">
        <div className="cartao__corpo">
          <div className="barra-filtros">
            <div className="campo-busca">
              <label className="sr-apenas" htmlFor="busca-cliente">
                Buscar por nome, CPF/CNPJ ou e-mail
              </label>
              <input
                id="busca-cliente"
                type="search"
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
                placeholder="Nome, CPF/CNPJ ou e-mail…"
                autoComplete="off"
              />
            </div>

            <label className="sr-apenas" htmlFor="filtro-situacao">
              Filtrar por situação
            </label>
            <select
              id="filtro-situacao"
              className="selecao-compacta"
              value={situacao}
              onChange={(e) => {
                setSituacao(e.target.value);
                setPagina(1);
              }}
            >
              <option value="">Todas as situações</option>
              {filtros?.situacoes.map((s) => (
                <option key={s.chave} value={s.chave}>
                  {s.nome}
                </option>
              ))}
            </select>

            <label className="sr-apenas" htmlFor="filtro-uf">
              Filtrar por UF
            </label>
            <select
              id="filtro-uf"
              className="selecao-compacta"
              value={uf}
              onChange={(e) => {
                setUf(e.target.value);
                setPagina(1);
              }}
            >
              <option value="">Todas as UFs</option>
              {filtros?.ufs.map((sigla) => (
                <option key={sigla} value={sigla}>
                  {sigla}
                </option>
              ))}
            </select>

            <label className="sr-apenas" htmlFor="filtro-seguradora">
              Filtrar por seguradora
            </label>
            <select
              id="filtro-seguradora"
              className="selecao-compacta"
              value={seguradora}
              onChange={(e) => {
                setSeguradora(e.target.value);
                setPagina(1);
              }}
            >
              <option value="">Todas as seguradoras</option>
              {filtros?.seguradoras.map((s) => (
                /* Inativa continua: a busca olha o passado. */
                <option key={s.nome} value={s.nome}>
                  {s.nome}
                  {s.ativa ? '' : ' (inativa)'}
                </option>
              ))}
            </select>

            {temFiltro && (
              <button type="button" className="botao botao--discreto botao--compacto" onClick={limpar}>
                Limpar
              </button>
            )}
          </div>

          {/* aria-live: o leitor de tela anuncia a contagem a cada busca. */}
          <p className="usuarios__resumo texto-discreto" aria-live="polite">
            {carregando
              ? 'Carregando…'
              : `${total.toLocaleString('pt-BR')} cliente${total === 1 ? '' : 's'}${
                  temFiltro ? ' encontrado' + (total === 1 ? '' : 's') : ' na base'
                }`}
          </p>

          {erro && (
            <p className="alerta alerta--erro" role="alert">
              {erro}
            </p>
          )}

          <div className="tabela-rolante">
            <table className="tabela tabela--densa tabela--clicavel">
              <thead>
                <tr>
                  <th scope="col">Nome</th>
                  <th scope="col">Situação</th>
                  <th scope="col">Tipo</th>
                  <th scope="col">CPF / CNPJ</th>
                  <th scope="col">Cidade</th>
                  <th scope="col">UF</th>
                  <th scope="col">Celular</th>
                  <th scope="col">Seguradora</th>
                </tr>
              </thead>
              <tbody>
                {clientes.length === 0 && !carregando && (
                  <tr>
                    <td className="tabela__vazio" colSpan={8}>
                      {temFiltro
                        ? 'Nenhum cliente encontrado com esses filtros.'
                        : 'A base de clientes está vazia. Rode a importação.'}
                    </td>
                  </tr>
                )}

                {clientes.map((cliente) => (
                  <LinhaCliente key={cliente.id} cliente={cliente} aoAbrir={abrir} />
                ))}
              </tbody>
            </table>
          </div>

          {paginas > 1 && (
            <nav className="paginacao" aria-label="Paginação dos clientes">
              <button
                type="button"
                className="botao botao--discreto botao--compacto"
                onClick={() => setPagina((p) => Math.max(p - 1, 1))}
                disabled={pagina <= 1 || carregando}
              >
                ← Anterior
              </button>

              <span className="texto-discreto">
                Página {pagina.toLocaleString('pt-BR')} de {paginas.toLocaleString('pt-BR')}
              </span>

              <button
                type="button"
                className="botao botao--discreto botao--compacto"
                onClick={() => setPagina((p) => Math.min(p + 1, paginas))}
                disabled={pagina >= paginas || carregando}
              >
                Próxima →
              </button>
            </nav>
          )}
        </div>
      </section>
    </div>
  );
}

interface PropsLinha {
  cliente: ClienteResumo;
  aoAbrir: (id: string) => void;
}

/** `onKeyDown` junto do `onClick`: `<tr>` só com `tabIndex` não é ativável por teclado. */
function LinhaCliente({ cliente, aoAbrir }: PropsLinha): React.JSX.Element {
  return (
    <tr
      tabIndex={0}
      role="button"
      aria-label={`Abrir ficha de ${cliente.nome}`}
      onClick={() => aoAbrir(cliente.id)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          aoAbrir(cliente.id);
        }
      }}
    >
      <td>
        {cliente.nome}
        {cliente.vip && (
          <span className="etiqueta etiqueta--vip" title="Cliente VIP">
            VIP
          </span>
        )}
      </td>
      <td>
        <span
          className={
            cliente.situacaoChave === 'ativo' || !cliente.situacaoChave
              ? 'tipo-pessoa'
              : `tipo-pessoa tipo-pessoa--juridica situacao--${cliente.situacaoChave}`
          }
        >
          {cliente.situacao ?? '—'}
        </span>
      </td>
      <td>
        {/* Rotulado nos DOIS casos: ausência de selo não distingue PF de selo faltando. */}
        <span
          className={
            cliente.tipoPessoa === 'Jurídica'
              ? 'tipo-pessoa tipo-pessoa--juridica'
              : 'tipo-pessoa'
          }
        >
          {cliente.tipoPessoa}
        </span>
      </td>
      <td className="tabela__mono">{cliente.cpfCnpj}</td>
      <td>{cliente.cidade ?? '—'}</td>
      <td>{cliente.uf ?? '—'}</td>
      <td className="tabela__mono">{cliente.celular ?? '—'}</td>
      <td>{cliente.seguradora ?? '—'}</td>
    </tr>
  );
}
