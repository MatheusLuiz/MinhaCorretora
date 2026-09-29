import { useState } from 'react';

import { TileKpi } from '@/components/graficos';
import { Paginacao, usePaginacao } from '@/components/Paginacao';
import { formatarData, formatarNumero } from '@/lib/formato';
import type { EncerradaDaSeguradora } from '@/lib/paineis';

export type Desfecho = EncerradaDaSeguradora['desfecho'];

/** Apólices que a seguradora encerrou; renovada = apólice nova do mesmo veículo (placa). */
export function EncerradasDaSeguradora({
  lista,
  abrirCliente,
  desfechoInicial = '',
}: {
  lista: EncerradaDaSeguradora[];
  abrirCliente: (uuid: string) => void;
  desfechoInicial?: '' | Desfecho;
}): React.JSX.Element {
  const [desfecho, setDesfecho] = useState<'' | Desfecho>(desfechoInicial);
  const ROTULO = {
    sem_renovacao: 'sem renovação na base',
    antes_do_prazo: 'encerrada antes do prazo',
    renovada: 'renovada',
  } as const;
  const CLASSE = {
    sem_renovacao: 'etiqueta--critico',
    antes_do_prazo: 'etiqueta--atencao',
    renovada: 'etiqueta--ok',
  } as const;
  // As sem renovação primeiro: são as que alguém precisa procurar.
  const ORDEM = { sem_renovacao: 0, antes_do_prazo: 1, renovada: 2 } as const;
  const ordenada = [...lista].sort(
    (a, b) => ORDEM[a.desfecho] - ORDEM[b.desfecho] || b.vigenciaFim.localeCompare(a.vigenciaFim),
  );
  const conta = (x: keyof typeof ROTULO): number => lista.filter((e) => e.desfecho === x).length;
  const doDesfecho = ordenada.filter((e) => !desfecho || e.desfecho === desfecho);
  const paginacao = usePaginacao(doDesfecho, [desfecho]);
  const alternar = (x: Desfecho): void => setDesfecho((atual) => (atual === x ? '' : x));

  return (
    <>
      <div className="tiles">
        <TileKpi
          rotulo="Renovadas"
          valor={formatarNumero(conta('renovada'))}
          descricao="apólice nova do mesmo veículo na base"
          ativo={desfecho === 'renovada'}
          aoClicar={() => alternar('renovada')}
        />
        <TileKpi
          rotulo="Antes do prazo"
          valor={formatarNumero(conta('antes_do_prazo'))}
          descricao="vigência menor que um ano: cancelamento ou endosso"
          menorEhMelhor
          ativo={desfecho === 'antes_do_prazo'}
          aoClicar={() => alternar('antes_do_prazo')}
        />
        <TileKpi
          rotulo="Sem renovação na base"
          valor={formatarNumero(conta('sem_renovacao'))}
          descricao="prazo cheio, nenhuma apólice nova encontrada"
          menorEhMelhor
          ativo={desfecho === 'sem_renovacao'}
          aoClicar={() => alternar('sem_renovacao')}
        />
      </div>

      <p className="texto-discreto">
        <strong>Sem renovação na base não quer dizer perdida:</strong> a apólice nova pode só não ter sido
        importada ainda. A renovação é reconhecida pela placa: uma apólice nova do mesmo veículo, começando
        até 30 dias antes ou depois do fim da antiga.
      </p>

      <div className="tabela-rolante">
        <table className="tabela tabela--densa">
          <thead>
            <tr>
              <th scope="col">Encerrou em</th>
              <th scope="col">Segurado</th>
              <th scope="col">Apólice</th>
              <th scope="col">Placa</th>
              <th scope="col">Desfecho</th>
            </tr>
          </thead>
          <tbody>
            {paginacao.visiveis.map((e) => (
              <tr
                key={`${e.seguradora}-${e.numeroApolice}-${e.vigenciaFim}`}
                className={e.clienteId ? 'tabela__linha--clicavel' : undefined}
                onClick={e.clienteId ? () => abrirCliente(e.clienteId!) : undefined}
                tabIndex={e.clienteId ? 0 : undefined}
                onKeyDown={
                  e.clienteId
                    ? (ev) => {
                        if (ev.key === 'Enter' || ev.key === ' ') {
                          ev.preventDefault();
                          abrirCliente(e.clienteId!);
                        }
                      }
                    : undefined
                }
              >
                <td>
                  {formatarData(e.vigenciaFim)}
                  {e.vigenciaInicio && (
                    <>
                      <br />
                      <small className="texto-discreto">desde {formatarData(e.vigenciaInicio)}</small>
                    </>
                  )}
                </td>
                <td>
                  {e.nomeSegurado}
                  <br />
                  <small className="texto-discreto">
                    {e.clienteId ? (e.produtor ?? 'sem corretor') : 'sem cliente na base'} · {e.seguradora}
                  </small>
                </td>
                <td className="tabela__mono">
                  {e.numeroApolice}
                  {e.teveEndosso && <small className="texto-discreto"> · com endosso</small>}
                </td>
                <td className="tabela__mono">
                  {e.placa ?? <span className="texto-discreto">sem placa</span>}
                </td>
                <td>
                  <span className={`etiqueta ${CLASSE[e.desfecho]}`}>{ROTULO[e.desfecho]}</span>
                  {e.renovadaPor && (
                    <>
                      <br />
                      <small className="texto-discreto">
                        nova: {e.renovadaPor.numero} ({e.renovadaPor.seguradora}
                        {e.renovadaPor.vigenciaInicio &&
                          `, desde ${formatarData(e.renovadaPor.vigenciaInicio)}`}
                        )
                      </small>
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Paginacao p={paginacao} />
    </>
  );
}
