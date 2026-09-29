import '@/styles/ramos.css';

import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';

import { GraficoColunas, TileKpi } from '@/components/graficos';
import { AreaDoGrafico } from '@/components/graficos/AreaDoGrafico';
import { CabecalhoPainel } from '@/components/Painel';
import { ApiError } from '@/lib/api';
import { filaSinistrosApi, type ResumoSinistros } from '@/lib/filaSinistros';
import { formatarCompetencia, formatarNumero, formatarPercentual, formatarReais } from '@/lib/formato';

/**
 * Dashboard de Ramos, pelo TIPO de seguro (o ramo SUSEP falta em várias origens).
 * Assistência não é sinistro. A frequência NÃO é clicável: conta apólices, e a fila
 * conta acionamentos — o total da fila não bateria com o número.
 */

const FILA = '/filas/sinistros';

export function PainelRamos(): React.JSX.Element {
  const navigate = useNavigate();
  const [dados, setDados] = useState<ResumoSinistros | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [tentativa, setTentativa] = useState(0);

  useEffect(() => {
    document.title = 'Ramos — MinhaCorretora';
  }, []);

  useEffect(() => {
    document.body.classList.add('tela-ajustada');
    return () => document.body.classList.remove('tela-ajustada');
  }, []);

  useEffect(() => {
    let cancelado = false;
    setErro(null);
    filaSinistrosApi
      .resumo()
      .then((r) => !cancelado && setDados(r))
      .catch((falha: unknown) => {
        if (cancelado) return;
        setErro(
          falha instanceof ApiError && falha.status === 404
            ? 'Este painel precisa do servidor atualizado: reinicie o backend.'
            : falha instanceof ApiError
              ? falha.message
              : 'Não foi possível carregar o painel.',
        );
      });
    return () => {
      cancelado = true;
    };
  }, [tentativa]);

  if (!dados) {
    return (
      <div className="painel">
        <CabecalhoPainel titulo="Ramos" />
        {erro ? (
          <p className="alerta alerta--erro" role="alert">
            {erro}{' '}
            <button
              type="button"
              className="botao botao--discreto botao--compacto"
              onClick={() => setTentativa((t) => t + 1)}
            >
              Tentar de novo
            </button>
          </p>
        ) : (
          <p className="texto-discreto">Carregando…</p>
        )}
      </div>
    );
  }

  // `Array.isArray`: backend anterior pode não mandar o campo.
  const tipos = Array.isArray(dados.tipos) ? dados.tipos : [];
  const porMes = Array.isArray(dados.porMes) ? dados.porMes : [];
  const maiorTipo = Math.max(1, ...tipos.map((t) => t.emVigor));
  const totalApolices = tipos.reduce((s, t) => s + t.apolices, 0);
  const totalEmVigor = tipos.reduce((s, t) => s + t.emVigor, 0);

  const { cobertas, comSinistro, comAssistencia } = dados.frequencia;
  const frequencia = cobertas > 0 ? (comSinistro / cobertas) * 100 : null;

  // Doze meses FIXOS: mês sem acionamento aparece zerado em vez de encurtar o eixo.
  const hoje = new Date();
  const meses = Array.from({ length: 12 }, (_, i) => {
    const dt = new Date(hoje.getFullYear(), hoje.getMonth() - 11 + i, 1);
    return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}`;
  });
  const mesDoRotulo = new Map(meses.map((m) => [formatarCompetencia(m), m]));
  const serie = (tipo: 'sinistro' | 'assistencia') =>
    meses.map((m) => ({
      periodo: formatarCompetencia(m),
      valor: porMes.find((x) => x.periodo === m && x.tipo === tipo)?.quantidade ?? 0,
    }));
  const nenhumNoAno = porMes.length === 0;

  const irParaFila = (filtro: string) => (): void => {
    void navigate(`${FILA}?${filtro}`);
  };

  return (
    <div className="painel painel--tela">
      <CabecalhoPainel
        titulo="Ramos"
        descricao="A carteira por tipo de seguro e os sinistros dela. Clique num número para abrir a fila."
      />

      <div className="ramos__corpo">
        <section className="cartao ramos__tipos">
          <header className="cartao__cabecalho">
            <h2 title="Apólices em vigor por tipo de seguro (o da apólice, senão o do produto), com o prêmio delas">
              Carteira por tipo de seguro
            </h2>
          </header>
          {tipos.length === 0 ? (
            <p className="texto-discreto">Nenhuma apólice na carteira.</p>
          ) : (
            <>
              <ul className="ramos__lista">
                {tipos.map((t) => (
                  <li key={t.tipo} className="ramos__tipo">
                    <div className="ramos__tipo-linha">
                      <span className="ramos__tipo-nome">{t.tipo}</span>
                      <span className="ramos__tipo-qtd">
                        {formatarNumero(t.emVigor)} <small>em vigor</small>
                      </span>
                    </div>
                    <div className="ramos__barra" aria-hidden="true">
                      <span style={{ width: `${(t.emVigor / maiorTipo) * 100}%` }} />
                    </div>
                    <div className="ramos__tipo-linha texto-discreto">
                      <span>
                        {/* Sem prêmio na origem, "R$ 0,00" pareceria carteira sem valor. */}
                        {t.comPremio > 0 ? formatarReais(t.premioEmVigor) : 'prêmio não informado'}
                        {t.comPremio > 0 && t.comPremio < t.emVigor && ` · prêmio de ${formatarNumero(t.comPremio)}`}
                      </span>
                      <span>{formatarNumero(t.apolices)} no total</span>
                    </div>
                  </li>
                ))}
              </ul>
              <p className="ramos__nota texto-discreto">
                {formatarNumero(totalEmVigor)} apólices em vigor de {formatarNumero(totalApolices)} na base. O
                ramo SUSEP não serve de eixo: o Bradesco não o informa.
              </p>
            </>
          )}
        </section>

        <section className="cartao ramos__sinistros">
          <header className="cartao__cabecalho">
            <h2 title="Acionamentos das seguradoras que mandam relatório de sinistros">Sinistros</h2>
            <Link className="botao botao--principal botao--compacto" to={FILA}>
              Abrir fila de sinistros
            </Link>
          </header>

          <div className="tiles ramos__numeros">
            <TileKpi
              rotulo="Frequência de sinistro"
              valor={frequencia === null ? '—' : formatarPercentual(frequencia)}
              descricao={`${formatarNumero(comSinistro)} de ${formatarNumero(cobertas)} apólices cobertas`}
              menorEhMelhor
            />
            <TileKpi
              rotulo="Sinistros em análise"
              valor={formatarNumero(dados.sinistros.emAnalise)}
              descricao={
                dados.sinistros.reservaEmAnalise > 0
                  ? `reserva de ${formatarReais(dados.sinistros.reservaEmAnalise)}`
                  : 'nenhum aberto'
              }
              menorEhMelhor
              aoClicar={irParaFila('tipo=sinistro&status=em_analise')}
            />
            <TileKpi
              rotulo="Sinistros"
              valor={formatarNumero(dados.sinistros.total)}
              descricao={
                dados.sinistros.recusados > 0
                  ? `${formatarNumero(dados.sinistros.recusados)} recusado(s) pela seguradora`
                  : 'todos os acionamentos'
              }
              aoClicar={irParaFila('tipo=sinistro')}
            />
            <TileKpi
              rotulo="Assistências"
              valor={formatarNumero(dados.assistencias.total)}
              descricao={`em ${formatarNumero(comAssistencia)} apólices · não é sinistro`}
              aoClicar={irParaFila('tipo=assistencia')}
            />
          </div>

          <div className="ramos__serie">
            <h3 className="ramos__subtitulo" title="Pela data de ocorrência. Clique num mês para ver os acionamentos dele.">
              Acionamentos por mês
            </h3>
            {nenhumNoAno ? (
              <p className="texto-discreto">Nenhum acionamento nos últimos 12 meses.</p>
            ) : (
              <AreaDoGrafico>
                {(altura) => (
                  <GraficoColunas
                    series={[
                      { nome: 'Sinistros', pontos: serie('sinistro') },
                      { nome: 'Assistências', pontos: serie('assistencia') },
                    ]}
                    formatar={formatarNumero}
                    empilhado
                    altura={altura}
                    aoClicar={(rotulo) => {
                      const m = mesDoRotulo.get(rotulo);
                      if (m) void navigate(`${FILA}?mes=${m}`);
                    }}
                  />
                )}
              </AreaDoGrafico>
            )}
          </div>

          <p className="ramos__nota texto-discreto">
            O relatório traz só a RESERVA, sem valor pago: dá frequência, não sinistralidade. Assistência (guincho,
            serviço) é contada à parte.
          </p>
        </section>
      </div>
    </div>
  );
}
