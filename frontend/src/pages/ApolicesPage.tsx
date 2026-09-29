import { useCallback, useEffect, useRef, useState } from 'react';

import { TileKpi } from '@/components/graficos';
import { CabecalhoPainel } from '@/components/Painel';
import { useCliente } from '@/hooks/useCliente';
import { ApiError } from '@/lib/api';
import {
  apolicesApi,
  ROTULO_SITUACAO,
  type Apolice,
  type ResultadoApolices,
  type ResumoApolices,
} from '@/lib/apolices';
import { formatarData, formatarNumero, formatarReais } from '@/lib/formato';

const POR_PAGINA = 50;

/** Consulta de apólices. Sem cliente vinculado é o estado real do dado (relatório sem CPF), não falha. */
export function ApolicesPage(): React.JSX.Element {
  const { abrir } = useCliente();

  const [busca, setBusca] = useState('');
  const [seguradora, setSeguradora] = useState('');
  const [semCliente, setSemCliente] = useState<'' | 'sim' | 'nao'>('');
  const [pagina, setPagina] = useState(1);

  const [resultado, setResultado] = useState<ResultadoApolices | null>(null);
  const [resumo, setResumo] = useState<ResumoApolices | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);

  // Debounce: sem ele, a resposta de "Sil" pode chegar depois da de "Silva" e sobrescrever a tela.
  const [buscaAplicada, setBuscaAplicada] = useState('');
  const temporizador = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    document.title = 'Apólices — MinhaCorretora';
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
    void apolicesApi
      .resumo()
      .then(setResumo)
      .catch(() => {
      });
  }, []);

  const carregar = useCallback(async (): Promise<void> => {
    setCarregando(true);
    setErro(null);

    try {
      setResultado(
        await apolicesApi.listar({
          busca: buscaAplicada,
          seguradora,
          semCliente: semCliente || undefined,
          pagina,
          limite: POR_PAGINA,
        }),
      );
    } catch (falha) {
      setErro(
        falha instanceof ApiError
          ? falha.message
          : 'Não foi possível carregar as apólices. Verifique sua conexão.',
      );
      setResultado(null);
    } finally {
      setCarregando(false);
    }
  }, [buscaAplicada, seguradora, semCliente, pagina]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  const total = resultado?.total ?? 0;
  const paginas = resultado?.paginas ?? 1;
  const apolices = resultado?.apolices ?? [];
  const temFiltro = Boolean(buscaAplicada || seguradora || semCliente);

  function limpar(): void {
    setBusca('');
    setSeguradora('');
    setSemCliente('');
    setPagina(1);
  }

  return (
    <div className="painel">
      <CabecalhoPainel
        titulo="Apólices"
        descricao="Importadas dos relatórios das seguradoras."
      />

      {resumo && (
        <div className="tiles">
          <TileKpi rotulo="Apólices" valor={formatarNumero(resumo.apolices)} />
          <TileKpi
            rotulo="Movimentos"
            valor={formatarNumero(resumo.movimentos)}
            descricao={Object.entries(resumo.porTipo)
              .map(([t, n]) => `${n} ${t}`)
              .join(' · ')}
          />
          <TileKpi
            rotulo="Com cliente"
            valor={formatarNumero(resumo.apolices - resumo.semCliente)}
            descricao={
              resumo.comVinculoPorNome > 0
                ? `${resumo.comVinculoPorNome} por nome, a conferir`
                : undefined
            }
          />
          <TileKpi
            rotulo="Sem cliente"
            valor={formatarNumero(resumo.semCliente)}
            descricao="segurado ainda não cadastrado"
            menorEhMelhor
          />
        </div>
      )}

      {resumo && resumo.semCliente > 0 && (
        <p className="alerta alerta--aviso" role="note">
          <strong>
            {resumo.semCliente} apólice(s) sem cliente vinculado.
          </strong>{' '}
          Os relatórios das seguradoras não trazem CPF/CNPJ, então o vínculo só
          sai quando o nome do segurado casa com exatamente um cliente da base.
          {resumo.conciliacao.semCandidato > 0 && (
            <>
              {' '}
              Destas, <strong>{resumo.conciliacao.semCandidato}</strong> têm
              segurado que não existe no cadastro — são clientes novos.
            </>
          )}
          {resumo.conciliacao.variosCandidatos > 0 && (
            <>
              {' '}
              Outras <strong>{resumo.conciliacao.variosCandidatos}</strong> têm
              homônimos na base: só o CPF resolve.
            </>
          )}
        </p>
      )}

      <section className="cartao cartao--largo">
        <div className="cartao__corpo">
          <div className="barra-filtros">
            <div className="campo-busca">
              <label className="sr-apenas" htmlFor="busca-apolice">
                Buscar por número ou nome do segurado
              </label>
              <input
                id="busca-apolice"
                type="search"
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
                placeholder="Número da apólice ou nome do segurado…"
                autoComplete="off"
              />
            </div>

            <label className="sr-apenas" htmlFor="filtro-seguradora-ap">
              Filtrar por seguradora
            </label>
            <select
              id="filtro-seguradora-ap"
              className="selecao-compacta"
              value={seguradora}
              onChange={(e) => {
                setSeguradora(e.target.value);
                setPagina(1);
              }}
            >
              <option value="">Todas as seguradoras</option>
              {resumo?.seguradoras.map((nome) => (
                <option key={nome} value={nome}>
                  {nome}
                </option>
              ))}
            </select>

            <label className="sr-apenas" htmlFor="filtro-vinculo">
              Filtrar por vínculo com cliente
            </label>
            <select
              id="filtro-vinculo"
              className="selecao-compacta"
              value={semCliente}
              onChange={(e) => {
                setSemCliente(e.target.value as '' | 'sim' | 'nao');
                setPagina(1);
              }}
            >
              <option value="">Com e sem cliente</option>
              <option value="nao">Só as vinculadas</option>
              <option value="sim">Só as sem cliente</option>
            </select>

            {temFiltro && (
              <button
                type="button"
                className="botao botao--discreto botao--compacto"
                onClick={limpar}
              >
                Limpar
              </button>
            )}
          </div>

          <p className="usuarios__resumo texto-discreto" aria-live="polite">
            {carregando
              ? 'Carregando…'
              : `${total.toLocaleString('pt-BR')} apólice${total === 1 ? '' : 's'}${
                  temFiltro ? (total === 1 ? ' encontrada' : ' encontradas') : ''
                }`}
          </p>

          {erro && (
            <p className="alerta alerta--erro" role="alert">
              {erro}
            </p>
          )}

          <div className="tabela-rolante">
            <table className="tabela tabela--densa">
              <thead>
                <tr>
                  <th scope="col">Apólice</th>
                  <th scope="col">Segurado</th>
                  <th scope="col">Cliente</th>
                  <th scope="col">Produto</th>
                  <th scope="col">Vigência</th>
                  <th scope="col">Situação</th>
                  <th scope="col" className="tabela__num">Prêmio</th>
                </tr>
              </thead>
              <tbody>
                {apolices.length === 0 && !carregando && (
                  <tr>
                    <td className="tabela__vazio" colSpan={7}>
                      {temFiltro
                        ? 'Nenhuma apólice com esses filtros.'
                        : 'Nenhuma apólice importada ainda.'}
                    </td>
                  </tr>
                )}

                {apolices.map((a) => (
                  <Linha key={a.id} apolice={a} aoAbrirCliente={abrir} />
                ))}
              </tbody>
            </table>
          </div>

          {paginas > 1 && (
            <nav className="paginacao" aria-label="Paginação das apólices">
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

const CLASSE_SITUACAO: Record<Apolice['situacao'], string> = {
  vigente: 'etiqueta--ok',
  a_vencer: 'etiqueta--tranquilo',
  vencida: 'etiqueta--critico',
  indefinida: 'etiqueta--atencao',
};

function Linha({
  apolice,
  aoAbrirCliente,
}: {
  apolice: Apolice;
  aoAbrirCliente: (id: string) => void;
}): React.JSX.Element {
  return (
    <tr>
      <td className="tabela__mono">
        {apolice.numero}
        {apolice.movimentos > 1 && (
          <span className="texto-discreto"> · {apolice.movimentos} mov.</span>
        )}
      </td>
      <td>{apolice.nomeSegurado}</td>
      <td>
        {apolice.clienteId ? (
          <button
            type="button"
            className="botao-cliente botao-cliente--inline"
            onClick={() => aoAbrirCliente(apolice.clienteId!)}
            title={`Abrir ficha de ${apolice.clienteNome ?? ''}`}
          >
            {apolice.clienteNome}
          </button>
        ) : (
          <span className="texto-discreto">não cadastrado</span>
        )}
        {/* Vínculo por nome não é prova: marcado para revisão. */}
        {apolice.vinculoOrigem === 'nome' && (
          <span className="etiqueta etiqueta--atencao" title="Vínculo feito por semelhança de nome">
            por nome
          </span>
        )}
      </td>
      <td>{apolice.produto ?? '—'}</td>
      <td>
        {apolice.vigenciaInicio
          ? `${formatarData(apolice.vigenciaInicio)} a ${
              apolice.vigenciaFim ? formatarData(apolice.vigenciaFim) : '—'
            }`
          : '—'}
      </td>
      <td>
        <span className={`etiqueta ${CLASSE_SITUACAO[apolice.situacao]}`}>
          {ROTULO_SITUACAO[apolice.situacao]}
        </span>
      </td>
      <td className="tabela__num">
        {apolice.premioTotal === null ? (
          <span className="texto-discreto" title="A emissão original não veio no arquivo importado">
            —
          </span>
        ) : (
          formatarReais(apolice.premioTotal)
        )}
      </td>
    </tr>
  );
}
