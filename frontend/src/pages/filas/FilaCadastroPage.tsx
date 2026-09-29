import '@/styles/carteira.css';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';

import { TileKpi } from '@/components/graficos';
import { CabecalhoPainel } from '@/components/Painel';
import { Paginacao, usePaginacao } from '@/components/Paginacao';
import { VoltarPara } from '@/components/VoltarPara';
import { useCliente } from '@/hooks/useCliente';
import { ApiError } from '@/lib/api';
import {
  ehPendencia,
  filaCadastroApi,
  PENDENCIAS,
  type ClienteDaFila,
  type Pendencia,
  type ResumoCarteira,
  type SituacaoCliente,
} from '@/lib/filaCadastro';
import { formatarData, formatarNumero } from '@/lib/formato';

/** Fila de cadastro. O total da fila filtrada é o número da barra do dashboard (mesma consulta-base). */

const SITUACOES: { chave: SituacaoCliente; rotulo: string }[] = [
  { chave: 'ativo', rotulo: 'Ativo' },
  { chave: 'inadimplente', rotulo: 'Inadimplente' },
  { chave: 'inativo', rotulo: 'Inativo' },
  { chave: 'prospecto', rotulo: 'Prospecto' },
];
const ehSituacao = (x: string | null): x is SituacaoCliente => SITUACOES.some((s) => s.chave === x);

/** Inativo e inadimplente já têm coluna; "sem nenhum contato" substitui as duas que resume. */
function etiquetasDaLinha(p: Pendencia[]): (typeof PENDENCIAS)[number][] {
  const semContato = p.includes('sem_contato');
  return PENDENCIAS.filter(
    (x) =>
      p.includes(x.chave) &&
      x.chave !== 'inativo' &&
      x.chave !== 'inadimplente' &&
      !(semContato && (x.chave === 'sem_telefone' || x.chave === 'sem_email')),
  );
}

function classeDaSituacao(s: SituacaoCliente | null): string {
  if (s === 'ativo') return 'etiqueta etiqueta--ok';
  if (s) return `etiqueta situacao--${s}`;
  return 'etiqueta etiqueta--tranquilo';
}

export function FilaCadastroPage(): React.JSX.Element {
  const { abrir: abrirCliente, aberto } = useCliente();
  const [parametros, setParametros] = useSearchParams();

  const pendenciaDaUrl = parametros.get('pendencia');
  const situacaoDaUrl = parametros.get('situacao');
  const pendencia: Pendencia | '' = ehPendencia(pendenciaDaUrl) ? pendenciaDaUrl : '';
  const situacao: SituacaoCliente | '' = ehSituacao(situacaoDaUrl) ? situacaoDaUrl : '';
  const busca = parametros.get('busca') ?? '';

  const [digitado, setDigitado] = useState(busca);
  const [resposta, setResposta] = useState<{ total: number; clientes: ClienteDaFila[] } | null>(null);
  const [resumo, setResumo] = useState<ResumoCarteira | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);

  const mudarFiltro = useCallback(
    (chave: 'pendencia' | 'situacao' | 'busca', valor: string): void => {
      setParametros(
        (atual) => {
          const novo = new URLSearchParams(atual);
          if (valor) novo.set(chave, valor);
          else novo.delete(chave);
          return novo;
        },
        { replace: true },
      );
    },
    [setParametros],
  );

  useEffect(() => {
    document.title = 'Fila de cadastro — MinhaCorretora';
  }, []);

  useEffect(() => {
    if (digitado.trim() === busca) return;
    const espera = setTimeout(() => mudarFiltro('busca', digitado.trim()), 350);
    return () => clearTimeout(espera);
  }, [digitado, busca, mudarFiltro]);

  const carregar = useCallback(() => {
    let cancelado = false;
    setCarregando(true);
    setErro(null);
    filaCadastroApi
      .listar({ pendencia, situacao, busca })
      .then((r) => {
        if (cancelado) return;
        setResposta({ total: r.total, clientes: Array.isArray(r.clientes) ? r.clientes : [] });
      })
      .catch((falha: unknown) => {
        if (cancelado) return;
        setErro(
          falha instanceof ApiError && falha.status === 404
            ? 'A fila de cadastro precisa do servidor atualizado: reinicie o backend.'
            : falha instanceof ApiError
              ? falha.message
              : 'Não foi possível carregar a fila de cadastro.',
        );
      })
      .finally(() => !cancelado && setCarregando(false));
    // Falhar no resumo não esconde a lista.
    filaCadastroApi
      .resumo()
      .then((r) => !cancelado && setResumo(r))
      .catch(() => undefined);
    return () => {
      cancelado = true;
    };
  }, [pendencia, situacao, busca]);

  useEffect(() => carregar(), [carregar]);

  const fichaAberta = useRef(aberto);
  useEffect(() => {
    if (fichaAberta.current && !aberto) carregar();
    fichaAberta.current = aberto;
  }, [aberto, carregar]);

  const clientes = resposta?.clientes ?? [];
  const pag = usePaginacao(clientes, [pendencia, situacao, busca]);

  const cartao = (
    chave: Pendencia | '',
    rotulo: string,
    descricao: string,
    critico = false,
  ): React.JSX.Element => (
    <TileKpi
      rotulo={rotulo}
      valor={resumo ? formatarNumero(chave ? resumo.pendencias[chave] : resumo.naFila) : '—'}
      descricao={descricao}
      menorEhMelhor={critico}
      ativo={pendencia === chave}
      aoClicar={() => mudarFiltro('pendencia', chave)}
    />
  );

  return (
    <div className="painel">
      <CabecalhoPainel
        titulo="Fila de cadastro"
        descricao="Clientes com cadastro incompleto, do que mais atrapalha ao que menos. Clique para abrir a ficha e corrigir."
      />

      <div className="fila__topo">
        <VoltarPara para="/dashboards/clientes" rotulo="Voltar ao dashboard de Clientes" />
        <div className="filtros-compactos">
          <label>
            <span>Pendência</span>
            <select value={pendencia} onChange={(e) => mudarFiltro('pendencia', e.target.value)}>
              <option value="">Todas</option>
              {PENDENCIAS.map((p) => (
                <option key={p.chave} value={p.chave}>
                  {p.rotulo}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Situação</span>
            <select value={situacao} onChange={(e) => mudarFiltro('situacao', e.target.value)}>
              <option value="">Todas</option>
              {SITUACOES.map((s) => (
                <option key={s.chave} value={s.chave}>
                  {s.rotulo}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Nome ou CPF/CNPJ</span>
            <input
              type="search"
              className="carteira__busca"
              value={digitado}
              onChange={(e) => setDigitado(e.target.value)}
              placeholder="Buscar…"
              maxLength={80}
            />
          </label>
        </div>
      </div>

      <div className="tiles">
        {cartao('', 'Na fila', 'clientes com alguma pendência')}
        {cartao('sem_contato', 'Sem nenhum contato', 'nem telefone, nem e-mail', true)}
        {cartao('sem_telefone', 'Sem telefone', 'a renovação não é trabalhável', true)}
        {cartao('inativo', 'Inativos', 'já foram clientes: a recuperar', true)}
      </div>

      {resumo?.recorte.semCarteira && (
        <p className="alerta" role="status">
          Nenhuma carteira ligada ao seu usuário ainda: a fila aparece quando um cliente for atribuído a você.
        </p>
      )}

      {erro && (
        <p className="alerta alerta--erro" role="alert">
          {erro}{' '}
          <button type="button" className="botao botao--discreto botao--compacto" onClick={carregar}>
            Tentar de novo
          </button>
        </p>
      )}

      <section className="cartao cartao--largo" aria-busy={carregando}>
        {resposta && resposta.total > clientes.length && (
          <p className="texto-discreto">
            Mostrando os {formatarNumero(clientes.length)} primeiros de {formatarNumero(resposta.total)} — use
            os filtros para chegar aos demais.
          </p>
        )}
        <div className="tabela-rolante">
          <table className="tabela tabela--densa">
            <thead>
              <tr>
                <th scope="col">Cliente</th>
                <th scope="col">Situação</th>
                <th scope="col">O que falta</th>
                <th scope="col" className="tabela__num">
                  Em vigor
                </th>
                <th scope="col">Próximo vencimento</th>
                <th scope="col">Seguradora</th>
              </tr>
            </thead>
            <tbody>
              {!resposta && carregando && (
                <tr>
                  <td className="tabela__vazio" colSpan={6}>
                    Carregando…
                  </td>
                </tr>
              )}
              {resposta && clientes.length === 0 && (
                <tr>
                  <td className="tabela__vazio" colSpan={6}>
                    {pendencia || situacao || busca
                      ? 'Nenhum cliente com estes filtros.'
                      : 'Nenhum cliente com pendência de cadastro.'}
                  </td>
                </tr>
              )}
              {pag.visiveis.map((c) => (
                <tr
                  key={c.uuid}
                  className="tabela__linha--clicavel"
                  tabIndex={0}
                  onClick={() => abrirCliente(c.uuid)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      abrirCliente(c.uuid);
                    }
                  }}
                >
                  <td>
                    {c.nome}
                    <br />
                    <small className="texto-discreto tabela__mono">{c.documento}</small>
                  </td>
                  <td>
                    <span className={classeDaSituacao(c.situacao)}>{c.situacaoNome ?? '—'}</span>
                  </td>
                  <td>
                    <span className="carteira__etiquetas">
                      {etiquetasDaLinha(c.pendencias).map((p) => (
                        <span key={p.chave} className={`etiqueta etiqueta--${p.tom}`}>
                          {p.rotulo}
                        </span>
                      ))}
                    </span>
                  </td>
                  <td className="tabela__num">{formatarNumero(c.apolicesEmVigor)}</td>
                  <td>
                    {c.proximoVencimento ? (
                      formatarData(c.proximoVencimento)
                    ) : (
                      <span className="texto-discreto">—</span>
                    )}
                  </td>
                  <td>{c.seguradoras ?? <span className="texto-discreto">—</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Paginacao p={pag} />
      </section>
    </div>
  );
}
