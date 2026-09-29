import { useEffect } from 'react';
import { Link, useSearchParams } from 'react-router-dom';

import { GraficoColunas, GraficoRosca, maioresEOutras, TileKpi } from '@/components/graficos';
import { AreaDoGrafico } from '@/components/graficos/AreaDoGrafico';
import { mesesDaComparacao, SeletorMesComparacao, TilesDaComparacao } from '@/components/ComparacaoAnual';
import { FiltroConsultor } from '@/components/FiltroConsultor';
import { CabecalhoPainel } from '@/components/Painel';
import { useDetalhe } from '@/hooks/useDetalhe';
import { usePaineis } from '@/hooks/usePaineis';
import { formatarCompetencia, formatarNumero, formatarReais } from '@/lib/formato';

/** Dashboard de Renovações: vencimentos em 30/60/90 dias e o calendário; as listas moram na fila. */

const DESFECHOS = [
  ['renovada', 'Renovadas'],
  ['antes_do_prazo', 'Antes do prazo'],
  ['sem_renovacao', 'Sem renovação na base'],
] as const;

export function PainelRenovacoes(): React.JSX.Element {
  const [parametros, setParametros] = useSearchParams();
  const produtor = parametros.get('produtor') ?? '';
  const comparar = mesesDaComparacao().includes(parametros.get('comparar') ?? '') ? parametros.get('comparar')! : mesesDaComparacao()[0]!;
  const mudarFiltro = (chave: string, valor: string): void => {
    const novo = new URLSearchParams(parametros);
    if (valor) novo.set(chave, valor);
    else novo.delete(chave);
    setParametros(novo, { replace: true });
  };
  const comConsultor = (caminho: string): string =>
    produtor ? `${caminho}${caminho.includes('?') ? '&' : '?'}produtor=${produtor}` : caminho;
  const { dados, carregando, erro, recarregar } = usePaineis(produtor);
  const { abrir } = useDetalhe();

  useEffect(() => {
    document.title = 'Renovações — MinhaCorretora';
  }, []);

  useEffect(() => {
    document.body.classList.add('tela-ajustada');
    return () => document.body.classList.remove('tela-ajustada');
  }, []);

  if (carregando || erro || !dados) {
    return (
      <div className="painel">
        <CabecalhoPainel titulo="Renovações" />
        {carregando ? (
          <p className="texto-discreto">Carregando…</p>
        ) : (
          <p className="alerta alerta--erro" role="alert">
            {erro ?? 'Painel indisponível.'}{' '}
            <button type="button" className="botao botao--discreto botao--compacto" onClick={recarregar}>
              Tentar de novo
            </button>
          </p>
        )}
      </div>
    );
  }

  const r = dados.renovacoes;
  // `Array.isArray`: backend anterior não manda o campo.
  const porMes = Array.isArray(r.porMes) ? r.porMes : [];
  const encerradas = Array.isArray(dados.encerradasSeguradora) ? dados.encerradasSeguradora : [];

  // Doze meses FIXOS: mês sem vencimento aparece zerado.
  const hoje = new Date();
  const meses = Array.from({ length: 12 }, (_, i) => {
    const dt = new Date(hoje.getFullYear(), hoje.getMonth() + i, 1);
    return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}`;
  });
  const rotuloMes = (m: string): string => formatarCompetencia(m) + (m === meses[0] ? ' (resto)' : '');
  const periodoDoRotulo = new Map(meses.map((m) => [rotuloMes(m), m]));
  const seguradoras = [...new Set(porMes.map((x) => x.seguradora))];
  const somar = (nomes: string[], filtro: (periodo: string) => boolean): number =>
    porMes.filter((x) => nomes.includes(x.seguradora) && filtro(x.periodo)).reduce((t, x) => t + x.apolices, 0);

  // A paleta tem 8 cores (da nona em diante sairia PRETO): o resto vira "Outras (N)".
  const grupos = maioresEOutras(seguradoras.map((nome) => ({ rotulo: nome, valor: somar([nome], () => true) }))).map(
    (g) => ({ ...g, nomes: g.agrupadas ?? [g.rotulo] }),
  );

  const proximos3 = meses.slice(0, 3);
  const porSeguradora3 = maioresEOutras(
    seguradoras.map((nome) => ({ rotulo: nome, valor: somar([nome], (p) => proximos3.includes(p)) })),
  );
  const porDesfecho = DESFECHOS.map(([chave, rotulo]) => ({
    rotulo,
    valor: encerradas.filter((e) => e.desfecho === chave).length,
  }));

  const vencimento = (dias: '30' | '60' | '90', titulo: string) => (): void =>
    abrir({ dimensao: 'vencimento', valor: dias, titulo, fila: comConsultor(`/filas/renovacao?prazo=${dias}`) });

  return (
    <div className="painel painel--tela">
      <CabecalhoPainel
        titulo="Renovações"
        descricao="O que vence, quando, e o que voltou. Clique num número para ver as apólices."
        acoes={
          <div className="filtros-compactos">
            <FiltroConsultor valor={produtor} aoMudar={(p) => mudarFiltro('produtor', p)} />
            <SeletorMesComparacao valor={comparar} aoMudar={(m) => mudarFiltro('comparar', m)} />
          </div>
        }
      />

      <div className="tiles renovacoes__faixa">
        <TileKpi
          rotulo="Vencem em 30 dias"
          valor={formatarNumero(r.em30)}
          descricao="ligar já"
          menorEhMelhor
          aoClicar={vencimento('30', 'Vencem nos próximos 30 dias')}
        />
        <TileKpi
          rotulo="Em 60 dias"
          valor={formatarNumero(r.em60)}
          aoClicar={vencimento('60', 'Vencem nos próximos 60 dias')}
        />
        <TileKpi
          rotulo="Em 90 dias"
          valor={formatarNumero(r.em90)}
          aoClicar={vencimento('90', 'Vencem nos próximos 90 dias')}
        />
        {/* Sem prêmio na origem, "R$ 0,00" pareceria carteira sem valor. */}
        {!dados.disponivel.medirEmApolices && r.premioEm90 !== undefined && (
          <TileKpi
            rotulo="Prêmio em 90 dias"
            valor={formatarReais(r.premioEm90)}
            descricao="o que está em jogo"
            aoClicar={vencimento('90', 'Prêmio a vencer em 90 dias')}
          />
        )}
        <TilesDaComparacao metricas={['renovadas', 'taxaRenovacao']} mes={comparar} produtor={produtor} />
      </div>

      <div className="renovacoes__corpo">
        <section className="cartao renovacoes__calendario">
          <header className="cartao__cabecalho">
            <h2 title="Quantas apólices vencem em cada mês, por seguradora. Clique num mês para ver quais.">
              Vencimentos por mês
            </h2>
            <Link className="botao botao--principal botao--compacto" to={comConsultor('/filas/renovacao')}>
              Abrir fila de renovação
            </Link>
          </header>
          {porMes.length === 0 ? (
            <p className="texto-discreto">Nenhuma apólice vence nos próximos 12 meses.</p>
          ) : (
            <AreaDoGrafico>
              {(altura) => (
                <GraficoColunas
                  series={grupos.map((g) => ({
                    nome: g.rotulo,
                    pontos: meses.map((m) => ({ periodo: rotuloMes(m), valor: somar(g.nomes, (p) => p === m) })),
                  }))}
                  formatar={formatarNumero}
                  empilhado
                  altura={altura}
                  aoClicar={(rotulo) => {
                    const m = periodoDoRotulo.get(rotulo);
                    if (!m) return;
                    abrir({
                      dimensao: 'vencimentoMes',
                      valor: m,
                      titulo: `Vencem em ${rotulo}`,
                      nota: m === meses[0] ? 'Do dia de hoje até o fim do mês.' : undefined,
                    });
                  }}
                />
              )}
            </AreaDoGrafico>
          )}
        </section>

        <div className="renovacoes__lado">
          <section className="cartao cartao--esticado cartao--compacto">
            <header className="cartao__cabecalho">
              <h2 title="Apólices que vencem neste mês (de hoje em diante) e nos dois seguintes">
                Próximos 3 meses
              </h2>
            </header>
            <div className="cartao__corpo">
              {porSeguradora3.length === 0 ? (
                <p className="texto-discreto comissao-recebida">Nada vence nos próximos 3 meses.</p>
              ) : (
                <GraficoRosca dados={porSeguradora3} formatar={formatarNumero} tamanho={76} />
              )}
            </div>
          </section>

          <section className="cartao cartao--esticado cartao--compacto">
            <header className="cartao__cabecalho">
              <h2 title="Apólices que a seguradora encerrou, e se existe apólice nova do mesmo veículo (pela placa)">
                Encerradas: voltaram?
              </h2>
            </header>
            <div className="cartao__corpo">
              {encerradas.length === 0 ? (
                <p className="texto-discreto comissao-recebida">Nenhuma lista de encerradas importada.</p>
              ) : (
                <>
                  <GraficoRosca dados={porDesfecho} formatar={formatarNumero} tamanho={76} />
                  <p className="cartao__rodape">
                    <Link to={comConsultor('/filas/renovacao?aba=encerradas')}>Ver na fila</Link>
                  </p>
                </>
              )}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
