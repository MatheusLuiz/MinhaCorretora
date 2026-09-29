import { useState } from 'react';

import { Paginacao, usePaginacao } from '@/components/Paginacao';
import { formatarData, formatarNumero, formatarReais } from '@/lib/formato';
import type { DadosPaineis } from '@/lib/paineis';

type ItemDaFila = DadosPaineis['renovacoes']['proximas'][number];

/** A contagem de cada prazo é da fila carregada (as 200 mais urgentes), não da carteira. */
export function FilaDeRenovacao({
  proximas,
  total,
  mostrarPremio,
  abrirCliente,
  inicial = {},
}: {
  proximas: ItemDaFila[];
  total: number;
  mostrarPremio: boolean;
  abrirCliente: (uuid: string) => void;
  /** Filtros de partida — vêm da URL quando se chega pelo "Abrir na fila" da gaveta. */
  inicial?: { prazo?: string; seguradora?: string; contato?: '' | 'com' | 'sem' };
}): React.JSX.Element {
  const [prazo, setPrazo] = useState(inicial.prazo ?? '');
  const [seguradora, setSeguradora] = useState(inicial.seguradora ?? '');
  const [contato, setContato] = useState<'' | 'com' | 'sem'>(inicial.contato ?? '');

  const temContato = (a: ItemDaFila): boolean => Boolean(a.telefone || a.email);
  const noPrazo = (a: ItemDaFila, dias: string): boolean => !dias || a.diasParaVencer <= Number(dias);
  const seguradoras = [...new Set(proximas.map((a) => a.seguradora))].sort((a, b) =>
    a.localeCompare(b, 'pt-BR'),
  );
  const filtradas = proximas.filter(
    (a) =>
      noPrazo(a, prazo) &&
      (!seguradora || a.seguradora === seguradora) &&
      (!contato || (contato === 'com') === temContato(a)),
  );
  const paginacao = usePaginacao(filtradas, [prazo, seguradora, contato]);
  const algumCorretor = proximas.some((a) => a.corretor);
  const semContato = filtradas.filter((a) => !temContato(a)).length;
  const colunas = 6 + (algumCorretor ? 1 : 0) + (mostrarPremio ? 1 : 0);

  return (
    <div className="fila-renovacao">
      <div className="fila-renovacao__barra">
        <p className="texto-discreto">
          <strong>{formatarNumero(filtradas.length)}</strong> de {formatarNumero(proximas.length)} na fila
          {semContato > 0 && (
            <>
              {' · '}
              <span className="situacao--inadimplente">
                {formatarNumero(semContato)} sem telefone nem e-mail
              </span>
            </>
          )}
          {!algumCorretor && ' · nenhuma com corretor atribuído'}
        </p>
        <div className="filtros-compactos">
          <label>
            <span>Prazo</span>
            <select value={prazo} onChange={(e) => setPrazo(e.target.value)}>
              <option value="">Todos</option>
              {['30', '60', '90'].map((dias) => (
                <option key={dias} value={dias}>
                  Até {dias} dias ({formatarNumero(proximas.filter((a) => noPrazo(a, dias)).length)})
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Seguradora</span>
            <select value={seguradora} onChange={(e) => setSeguradora(e.target.value)}>
              <option value="">Todas</option>
              {seguradoras.map((nome) => (
                <option key={nome} value={nome}>
                  {nome}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Contato</span>
            <select value={contato} onChange={(e) => setContato(e.target.value as typeof contato)}>
              <option value="">Todos</option>
              <option value="com">Com telefone ou e-mail</option>
              <option value="sem">Sem contato</option>
            </select>
          </label>
        </div>
      </div>

      <div className="tabela-rolante">
        <table className="tabela tabela--densa">
          <thead>
            <tr>
              <th scope="col">Vence em</th>
              <th scope="col" className="tabela__num">
                Dias
              </th>
              <th scope="col">Segurado</th>
              <th scope="col">Contato</th>
              {algumCorretor && <th scope="col">Corretor</th>}
              <th scope="col">Seguradora</th>
              <th scope="col">Apólice</th>
              {mostrarPremio && (
                <th scope="col" className="tabela__num">
                  Prêmio
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {filtradas.length === 0 && (
              <tr>
                <td className="tabela__vazio" colSpan={colunas}>
                  Nenhuma apólice da fila com estes filtros.
                </td>
              </tr>
            )}
            {paginacao.visiveis.map((a) => (
              <tr
                key={`${a.numero}-${a.clienteUuid ?? a.segurado}`}
                className={a.clienteUuid ? 'tabela__linha--clicavel' : undefined}
                onClick={a.clienteUuid ? () => abrirCliente(a.clienteUuid!) : undefined}
                tabIndex={a.clienteUuid ? 0 : undefined}
                onKeyDown={
                  a.clienteUuid
                    ? (e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          abrirCliente(a.clienteUuid!);
                        }
                      }
                    : undefined
                }
              >
                <td>{a.vigenciaFim ? formatarData(a.vigenciaFim) : '—'}</td>
                <td className="tabela__num">
                  <span className={a.diasParaVencer <= 30 ? 'situacao--inadimplente' : undefined}>
                    {a.diasParaVencer}
                  </span>
                </td>
                <td>
                  {a.segurado || <span className="texto-discreto">—</span>}
                  {a.produto && (
                    <>
                      <br />
                      <small className="texto-discreto">{a.produto}</small>
                    </>
                  )}
                </td>
                <td>
                  {a.telefone ?? a.email ?? <span className="situacao--inadimplente">sem contato</span>}
                </td>
                {algumCorretor && (
                  <td>{a.corretor ?? <span className="texto-discreto">sem corretor</span>}</td>
                )}
                <td>{a.seguradora}</td>
                <td className="tabela__mono">{a.numero}</td>
                {mostrarPremio && (
                  <td className="tabela__num">
                    {a.premio === null ? <span className="texto-discreto">—</span> : formatarReais(a.premio)}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Paginacao p={paginacao} />

      {/* Quem vê 200 linhas não deve concluir que a fila acabou. */}
      {proximas.length >= 200 && (
        <p className="texto-discreto">
          A fila traz as {formatarNumero(proximas.length)} mais urgentes, de {formatarNumero(total)} em vigor.
        </p>
      )}
    </div>
  );
}
