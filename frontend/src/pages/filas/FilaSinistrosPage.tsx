import '@/styles/ramos.css';

import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';

import { CabecalhoPainel } from '@/components/Painel';
import { Paginacao, usePaginacao } from '@/components/Paginacao';
import { VoltarPara } from '@/components/VoltarPara';
import { useCliente } from '@/hooks/useCliente';
import { ApiError } from '@/lib/api';
import {
  filaSinistrosApi,
  ROTULO_SITUACAO,
  ROTULO_TIPO,
  type Acionamento,
  type ListaSinistros,
  type SituacaoAcionamento,
  type TipoAcionamento,
} from '@/lib/filaSinistros';
import { formatarCompetencia, formatarData, formatarNumero, formatarReais } from '@/lib/formato';

/**
 * Fila de sinistros. A URL é a fonte dos filtros e o servidor filtra com o mesmo critério
 * do resumo, para o total bater com o número clicado. Linha sem cliente só aparece para
 * quem vê a base inteira (sem dono, não há carteira que autorize).
 */

const TIPOS: TipoAcionamento[] = ['sinistro', 'assistencia'];
const SITUACOES: SituacaoAcionamento[] = ['em_analise', 'recusado', 'encerrado'];

const CLASSE_SITUACAO: Record<SituacaoAcionamento, string> = {
  em_analise: 'etiqueta etiqueta--atencao',
  recusado: 'etiqueta etiqueta--critico',
  encerrado: 'etiqueta etiqueta--ok',
};

export function FilaSinistrosPage(): React.JSX.Element {
  const { abrir: abrirCliente } = useCliente();
  const [parametros, setParametros] = useSearchParams();

  const tipoDaUrl = parametros.get('tipo');
  const statusDaUrl = parametros.get('status');
  const tipo = TIPOS.find((t) => t === tipoDaUrl) ?? '';
  const status = SITUACOES.find((s) => s === statusDaUrl) ?? '';
  const seguradora = parametros.get('seguradora') ?? '';
  const mes = parametros.get('mes') ?? '';
  const causa = parametros.get('causa') ?? '';

  const [dados, setDados] = useState<ListaSinistros | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(true);

  useEffect(() => {
    document.title = 'Fila de sinistros — MinhaCorretora';
  }, []);

  useEffect(() => {
    let cancelado = false;
    setCarregando(true);
    setErro(null);
    filaSinistrosApi
      .listar({ tipo, status, seguradora, mes, causa })
      .then((r) => !cancelado && setDados(r))
      .catch((falha: unknown) => {
        if (cancelado) return;
        setErro(
          falha instanceof ApiError && falha.status === 404
            ? 'A fila de sinistros precisa do servidor atualizado: reinicie o backend.'
            : falha instanceof ApiError
              ? falha.message
              : 'Não foi possível carregar a fila.',
        );
      })
      .finally(() => !cancelado && setCarregando(false));
    return () => {
      cancelado = true;
    };
  }, [tipo, status, seguradora, mes, causa]);

  /** Troca um filtro na URL; vazio sai da URL em vez de virar `?tipo=`. */
  const mudar = (chave: string, valor: string): void => {
    const novo = new URLSearchParams(parametros);
    if (valor) novo.set(chave, valor);
    else novo.delete(chave);
    setParametros(novo);
  };

  const acionamentos = Array.isArray(dados?.acionamentos) ? dados.acionamentos : [];
  const seguradoras = dados?.opcoes?.seguradoras ?? [];
  // O mês da URL entra na lista mesmo sem acionamento: o select não mostra "Todos" com filtro ativo.
  const meses = [...new Set([...(dados?.opcoes?.meses ?? []), ...(mes ? [mes] : [])])].sort((a, b) =>
    b.localeCompare(a),
  );

  const pag = usePaginacao(acionamentos, [tipo, status, seguradora, mes, causa]);
  const nSinistros = acionamentos.filter((a) => a.tipo === 'sinistro').length;
  const nAssistencias = acionamentos.length - nSinistros;

  return (
    <div className="painel">
      <CabecalhoPainel
        titulo="Fila de sinistros"
        descricao="Cada acionamento: sinistros primeiro, e o que está em análise no topo."
      />

      <div className="fila__topo">
        <VoltarPara para="/dashboards/sinistros" rotulo="Voltar ao dashboard de Sinistros" />
        <div className="filtros-compactos">
          <label>
            <span>Tipo</span>
            <select value={tipo} onChange={(e) => mudar('tipo', e.target.value)}>
              <option value="">Todos</option>
              {TIPOS.map((t) => (
                <option key={t} value={t}>
                  {ROTULO_TIPO[t]}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Situação</span>
            <select value={status} onChange={(e) => mudar('status', e.target.value)}>
              <option value="">Todas</option>
              {SITUACOES.map((s) => (
                <option key={s} value={s}>
                  {ROTULO_SITUACAO[s]}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Seguradora</span>
            <select value={seguradora} onChange={(e) => mudar('seguradora', e.target.value)}>
              <option value="">Todas</option>
              {[...new Set([...seguradoras, ...(seguradora ? [seguradora] : [])])].map((nome) => (
                <option key={nome} value={nome}>
                  {nome}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Mês da ocorrência</span>
            <select value={mes} onChange={(e) => mudar('mes', e.target.value)}>
              <option value="">Todos</option>
              {meses.map((m) => (
                <option key={m} value={m}>
                  {formatarCompetencia(m)}
                </option>
              ))}
            </select>
          </label>
          {causa && (
            <button
              type="button"
              className="botao botao--discreto botao--compacto"
              title="Tirar o filtro de causa"
              onClick={() => mudar('causa', '')}
            >
              Causa: {causa} ✕
            </button>
          )}
        </div>
      </div>

      {erro && (
        <p className="alerta alerta--erro" role="alert">
          {erro}
        </p>
      )}

      {!dados && carregando ? (
        <p className="texto-discreto">Carregando…</p>
      ) : (
        <section className="cartao cartao--largo ramos__fila" aria-busy={carregando}>
          <p className="texto-discreto">
            {formatarNumero(acionamentos.length)} acionamento(s): {formatarNumero(nSinistros)} sinistro(s) e{' '}
            {formatarNumero(nAssistencias)} assistência(s). Reserva é o que a seguradora separou para o
            sinistro, não o valor pago.
          </p>
          <div className="tabela-rolante">
            <table className="tabela tabela--densa">
              <thead>
                <tr>
                  <th scope="col">Ocorrido</th>
                  <th scope="col">Tipo</th>
                  <th scope="col">Situação</th>
                  <th scope="col">Cliente / sinistrado</th>
                  <th scope="col">Veículo</th>
                  <th scope="col">Cobertura / causa</th>
                  <th scope="col">Apólice</th>
                  <th scope="col" className="tabela__num">
                    Reserva
                  </th>
                </tr>
              </thead>
              <tbody>
                {acionamentos.length === 0 && (
                  <tr>
                    <td className="tabela__vazio" colSpan={8}>
                      Nenhum acionamento com estes filtros.
                    </td>
                  </tr>
                )}
                {pag.visiveis.map((a) => (
                  <LinhaAcionamento key={a.id} a={a} abrirCliente={abrirCliente} />
                ))}
              </tbody>
            </table>
          </div>
          <Paginacao p={pag} />
        </section>
      )}
    </div>
  );
}

function LinhaAcionamento({
  a,
  abrirCliente,
}: {
  a: Acionamento;
  abrirCliente: (uuid: string) => void;
}): React.JSX.Element {
  const uuid = a.clienteUuid;
  const abrir = uuid ? (): void => abrirCliente(uuid) : undefined;

  return (
    <tr
      className={abrir ? 'tabela__linha--clicavel' : undefined}
      onClick={abrir}
      tabIndex={abrir ? 0 : undefined}
      onKeyDown={
        abrir
          ? (e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                abrir();
              }
            }
          : undefined
      }
    >
      <td>
        {a.ocorridoEm ? formatarData(a.ocorridoEm) : '—'}
        {a.comunicadoEm && a.comunicadoEm !== a.ocorridoEm && (
          <small className="texto-discreto">comunicado {formatarData(a.comunicadoEm)}</small>
        )}
      </td>
      <td>
        <span
          className={`ramos__tipo-etiqueta ${a.tipo === 'sinistro' ? 'etiqueta etiqueta--critico' : 'etiqueta'}`}
        >
          {ROTULO_TIPO[a.tipo]}
        </span>
      </td>
      <td>
        <span className={CLASSE_SITUACAO[a.situacao]} title={statusDaCompanhia(a)}>
          {ROTULO_SITUACAO[a.situacao]}
        </span>
      </td>
      <td>
        {a.clienteNome ?? a.nomeSinistrado ?? <span className="texto-discreto">—</span>}
        {!a.clienteUuid && <small className="texto-discreto">sem cliente na base</small>}
        {a.vinculoOrigem === 'nome' && (
          <small className="texto-discreto" title="A apólice não está na base; o cliente foi ligado pelo nome">
            ligado pelo nome
          </small>
        )}
      </td>
      <td>
        {a.placa ?? <span className="texto-discreto">sem placa</span>}
        {a.veiculo && <small className="texto-discreto">{a.veiculo}</small>}
      </td>
      <td>
        {a.cobertura ?? '—'}
        {a.causa && <small className="texto-discreto">{a.causa}</small>}
      </td>
      <td className="tabela__mono">
        {a.numeroApolice}
        <small className="texto-discreto">
          {a.seguradora}
          {!a.apoliceNaBase && ' · fora da base'}
        </small>
      </td>
      <td className="tabela__num">{a.reserva === null ? '—' : formatarReais(a.reserva)}</td>
    </tr>
  );
}

/** Os dois status como a companhia escreveu: a situação da tela é derivada deles. */
function statusDaCompanhia(a: Acionamento): string {
  const partes = [
    a.statusProcesso && `Processo: ${a.statusProcesso}`,
    a.statusMovimento && `Movimento: ${a.statusMovimento}`,
  ].filter(Boolean);
  return partes.length > 0 ? partes.join(' · ') : 'Status não informado';
}
