import '@/styles/cancelamentos-painel.css';

import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';

import { FiltroConsultor } from '@/components/FiltroConsultor';
import { AreaDoGrafico } from '@/components/graficos/AreaDoGrafico';
import { GraficoColunas, TileKpi } from '@/components/graficos';
import { LimiteDeErro } from '@/components/LimiteDeErro';
import { CabecalhoPainel } from '@/components/Painel';
import { useDetalhe } from '@/hooks/useDetalhe';
import { ApiError } from '@/lib/api';
import { formatarCompetencia, formatarNumero, formatarPercentual } from '@/lib/formato';
import { paineisApi, type Cancelamentos } from '@/lib/paineis';

const NOTA =
  'Clientes com ao menos uma apólice cancelada no período, pelo mês do cancelamento. Na Porto, sem a data, ' +
  'vale o mês do arquivo de "Apólices Canceladas" do portal em que a apólice veio.';

/** "set/26" ou "jun/26 a set/26". */
const periodo = (de: string, ate: string): string =>
  de === ate ? formatarCompetencia(de) : `${formatarCompetencia(de)} a ${formatarCompetencia(ate)}`;

/** Dashboard de Cancelamentos. Cada janela é contada no servidor: a de 4 meses não é a soma das outras. */
export function PainelCancelamentos(): React.JSX.Element {
  const [parametros, setParametros] = useSearchParams();
  const produtor = parametros.get('produtor') ?? '';
  const [dados, setDados] = useState<Cancelamentos | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const { abrir } = useDetalhe();

  useEffect(() => {
    document.title = 'Cancelamentos — MinhaCorretora';
  }, []);

  useEffect(() => {
    document.body.classList.add('tela-ajustada');
    return () => document.body.classList.remove('tela-ajustada');
  }, []);

  useEffect(() => {
    let cancelado = false;
    setErro(null);
    paineisApi
      .cancelamentos(produtor || undefined)
      .then((d) => !cancelado && setDados(d))
      .catch((falha: unknown) => {
        if (cancelado) return;
        setErro(
          falha instanceof ApiError && falha.status === 404
            ? 'O painel de cancelamentos precisa do servidor atualizado: reinicie o backend.'
            : falha instanceof ApiError
              ? falha.message
              : 'Não foi possível carregar os cancelamentos.',
        );
      });
    return () => {
      cancelado = true;
    };
  }, [produtor]);

  const mudarConsultor = (p: string): void => {
    const novo = new URLSearchParams(parametros);
    if (p) novo.set('produtor', p);
    else novo.delete('produtor');
    setParametros(novo, { replace: true });
  };

  const abrirCancelados = (de: string, ate: string, soPerdidos = false): void =>
    abrir({
      dimensao: soPerdidos ? 'canceladosPerdidos' : 'cancelados',
      valor: `${de}:${ate}`,
      titulo: soPerdidos
        ? `Cancelaram e estão sem apólice em vigor · ${periodo(de, ate)}`
        : `Clientes com cancelamento · ${periodo(de, ate)}`,
      nota: NOTA,
    });

  const cabecalho = (
    <CabecalhoPainel
      titulo="Cancelamentos"
      descricao="Clientes com apólice cancelada nos últimos meses. Clique num número para ver os clientes."
      acoes={
        <div className="filtros-compactos">
          <FiltroConsultor valor={produtor} aoMudar={mudarConsultor} />
        </div>
      }
    />
  );

  if (!dados) {
    return (
      <div className="painel">
        {cabecalho}
        {erro ? (
          <p className="alerta alerta--erro" role="alert">
            {erro}
          </p>
        ) : (
          <p className="texto-discreto">Carregando…</p>
        )}
      </div>
    );
  }

  const janelas = Array.isArray(dados.janelas) ? dados.janelas : [];
  const porMes = Array.isArray(dados.porMes) ? dados.porMes : [];
  const porSeguradora = Array.isArray(dados.porSeguradora) ? dados.porSeguradora : [];

  const meses = Array.from({ length: 12 }, (_, i) => {
    const [a, m] = dados.mesCorrente.split('-').map(Number) as [number, number];
    const d = new Date(Date.UTC(a, m - 12 + i, 1));
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
  });
  const doMes = new Map(porMes.map((p) => [p.mes, p]));
  const pelaEtiqueta = new Map(meses.map((m) => [formatarCompetencia(m), m]));

  return (
    <div className="painel painel--tela">
      {cabecalho}

      <div className="cancelamentos-painel__corpo">
        <LimiteDeErro nome="Janelas de cancelamento">
          <div className="cancelamentos-painel__numeros">
            {janelas.map((j) => (
              <TileKpi
                key={j.meses}
                rotulo={j.meses === 1 ? 'Último mês' : `Últimos ${j.meses} meses`}
                valor={formatarNumero(j.clientes)}
                descricao={`${periodo(j.de, j.ate)} · ${formatarNumero(j.perdidos)} sem apólice em vigor`}
                aoClicar={() => abrirCancelados(j.de, j.ate)}
              />
            ))}
            <TileKpi
              rotulo={`${formatarCompetencia(dados.mesAtual.mes)} até hoje`}
              valor={formatarNumero(dados.mesAtual.clientes)}
              descricao="mês em andamento — fora das janelas"
              aoClicar={() => abrirCancelados(dados.mesAtual.mes, dados.mesAtual.mes)}
            />
          </div>
        </LimiteDeErro>

        <p
          className="alerta alerta--aviso cancelamentos-painel__aviso"
          title={porSeguradora.map((s) => `${s.seguradora}: ${formatarNumero(s.clientes)} cliente(s)`).join('\n')}
        >
          Cancelamento só chega pelos relatórios de{' '}
          {porSeguradora.length > 0 ? porSeguradora.map((s) => s.seguradora).join(', ') : 'nenhuma seguradora'}
          {dados.semData.apolices > 0 && (
            <>
              {' '}· {formatarNumero(dados.semData.apolices)} apólice(s) cancelada(s) de{' '}
              {formatarNumero(dados.semData.clientes)} cliente(s) estão sem data (Porto, vindas na lista de
              vencidas) e ficam fora da conta
            </>
          )}
          .
        </p>

        <section className="cartao cancelamentos-painel__serie">
          <header className="cartao__cabecalho">
            <h2 title="Pelo mês do cancelamento. Clique numa coluna para ver os clientes do mês.">
              Clientes com cancelamento por mês
            </h2>
          </header>
          <LimiteDeErro nome="Cancelamentos por mês">
            {porMes.length === 0 ? (
              <p className="texto-discreto">Nenhum cancelamento com data nos últimos 12 meses.</p>
            ) : (
              <AreaDoGrafico>
                {(altura) => (
                  <GraficoColunas
                    series={[
                      {
                        nome: 'Sem apólice em vigor',
                        pontos: meses.map((m) => ({ periodo: formatarCompetencia(m), valor: doMes.get(m)?.perdidos ?? 0 })),
                      },
                      {
                        nome: 'Seguem com outra apólice',
                        pontos: meses.map((m) => ({
                          periodo: formatarCompetencia(m),
                          valor: (doMes.get(m)?.clientes ?? 0) - (doMes.get(m)?.perdidos ?? 0),
                        })),
                      },
                    ]}
                    formatar={formatarNumero}
                    empilhado
                    altura={altura}
                    aoClicar={(r) => {
                      const m = pelaEtiqueta.get(r);
                      if (m) abrirCancelados(m, m);
                    }}
                  />
                )}
              </AreaDoGrafico>
            )}
          </LimiteDeErro>
        </section>

        <section className="cartao cancelamentos-painel__bloco">
          <header className="cartao__cabecalho">
            <h2 title="Dos que cancelaram, os que hoje não têm nenhuma apólice em vigor, em nenhuma seguradora.">
              Perdidos de fato
            </h2>
          </header>
          <LimiteDeErro nome="Perdidos de fato">
            <table className="cancelamentos-painel__tabela">
              <thead>
                <tr>
                  <th scope="col">Período</th>
                  <th scope="col">Cancelaram</th>
                  <th scope="col">Sem apólice</th>
                  <th scope="col">%</th>
                </tr>
              </thead>
              <tbody>
                {janelas.map((j) => (
                  <tr key={j.meses}>
                    <th scope="row">
                      {j.meses === 1 ? '1 mês' : `${j.meses} meses`}
                      <span className="texto-discreto">{periodo(j.de, j.ate)}</span>
                    </th>
                    <td>
                      <button type="button" className="cancelamentos-painel__numero" onClick={() => abrirCancelados(j.de, j.ate)}>
                        {formatarNumero(j.clientes)}
                      </button>
                    </td>
                    <td>
                      <button
                        type="button"
                        className="cancelamentos-painel__numero"
                        onClick={() => abrirCancelados(j.de, j.ate, true)}
                      >
                        {formatarNumero(j.perdidos)}
                      </button>
                    </td>
                    <td>{j.clientes > 0 ? formatarPercentual((j.perdidos / j.clientes) * 100, 0) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </LimiteDeErro>
        </section>
      </div>
    </div>
  );
}
