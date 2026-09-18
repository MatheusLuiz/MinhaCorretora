import { Link, useNavigate } from 'react-router-dom';

import { BarrasHorizontais, GraficoColunas, GraficoLinha, maioresEOutras, TileKpi } from '@/components/graficos';
import {
  formatarCompetencia,
  formatarData,
  formatarNumero,
  formatarReais,
  formatarReaisCompacto,
} from '@/lib/formato';
import { FilaDeRenovacao } from '@/components/renovacao/FilaDeRenovacao';
import { useCliente } from '@/hooks/useCliente';
import { useDetalhe } from '@/hooks/useDetalhe';
import { detalheDosGrupos, gruposContados, gruposDoPayload, somarGrupos } from '@/lib/gruposCliente';
import type { Dimensao, PedidoDetalhe } from '@/lib/detalhe';
import type { DadosPaineis, EncerradaDaSeguradora, Fatia, RenovacaoDaSeguradora } from '@/lib/paineis';
import { WidgetSinistros } from '@/components/sinistros/WidgetSinistros';
import { WIDGETS_POR_ID } from '@/widgets/catalogo';

/**
 * Renderiza uma análise pelo id do catálogo. Sem origem de dados, mostra `Pendente`
 * em vez de inventar número; séries ficam em 12 meses porque a origem só traz vigentes.
 */
export function ConteudoWidget({ id, dados }: { id: string; dados: DadosPaineis }): React.JSX.Element {
  const { abrir } = useDetalhe();
  const { abrir: abrirCliente } = useCliente();
  return renderizar(id, dados, abrir, abrirCliente);
}

/** Abre o detalhe de um recorte: todo número com linhas por trás abre; agregados sem registro individual não fingem ser clicáveis. */
type AbrirDetalhe = (pedido: PedidoDetalhe) => void;

const barras = (lista: Fatia[]): { rotulo: string; valor: number }[] =>
  lista.map((f) => ({ rotulo: f.rotulo, valor: f.valor }));

/** A mesma barra, medida em apólices: sem prêmio, cair para `valor` desenharia barras em zero. */
const barrasPorQuantidade = (lista: Fatia[]): { rotulo: string; valor: number }[] =>
  lista.map((f) => ({ rotulo: f.rotulo, valor: f.quantidade ?? 0 }));

const serieDePremio = (d: DadosPaineis): { periodo: string; valor: number }[] =>
  d.producao.porMes.map((m) => ({
    periodo: formatarCompetencia(m.periodo) + (m.parcial ? ' (parcial)' : ''),
    valor: m.premio,
  }));

const serieDeApolices = (d: DadosPaineis): { periodo: string; valor: number }[] =>
  d.producao.porMes.map((m) => ({
    periodo: formatarCompetencia(m.periodo) + (m.parcial ? ' (parcial)' : ''),
    valor: m.apolices,
  }));

function renderizar(
  id: string,
  d: DadosPaineis,
  abrir: AbrirDetalhe,
  abrirCliente: (uuid: string) => void,
): React.JSX.Element {
  const { producao, renovacoes, receita, comissaoCarteira, disponivel: ok } = d;

  const ver =
    (
      dimensao: Dimensao,
      titulo: (rotulo: string) => string,
      extras: Omit<PedidoDetalhe, 'dimensao' | 'valor' | 'titulo'> = {},
    ) =>
    (rotulo: string) =>
      abrir({ dimensao, valor: rotulo, titulo: titulo(rotulo), ...extras });

  const notaJanela = `Últimos ${producao.janelaMeses} meses — a mesma janela do gráfico.`;

  // O gráfico mostra "ago/26"; o servidor espera "2026-08" — sem a tradução o detalhe volta vazio.
  const mesDoRotulo = new Map<string, string>();
  for (const m of producao.porMes) {
    mesDoRotulo.set(formatarCompetencia(m.periodo), m.periodo);
    mesDoRotulo.set(`${formatarCompetencia(m.periodo)} (parcial)`, m.periodo);
  }

  const verMes = (rotulo: string): void => {
    const periodo = mesDoRotulo.get(rotulo);
    if (!periodo) return;
    abrir({ dimensao: 'mes', valor: periodo, titulo: `Apólices de ${rotulo}` });
  };

  switch (id) {
    // ═══════════════════ Produção ═══════════════════

    case 'prod.resumo':
      if (!ok.producao) return <SemApolice />;

      // Sem prêmio: só contagens, com uma frase dizendo por que o valor não aparece.
      if (ok.medirEmApolices) {
        return (
          <>
            <div className="tiles">
              <TileKpi
                rotulo="Apólices importadas"
                valor={formatarNumero(producao.apolices)}
                aoClicar={() => abrir({ dimensao: 'todasApolices', titulo: 'Todas as apólices da carteira' })}
              />
              <TileKpi
                rotulo="Em vigor"
                valor={formatarNumero(renovacoes.total)}
                descricao="não canceladas e dentro da vigência"
                aoClicar={() =>
                  abrir({ dimensao: 'aRenovar', titulo: 'Apólices em vigor', fila: '/filas/renovacao' })
                }
              />
              <TileKpi
                rotulo="Vencem em 30 dias"
                valor={formatarNumero(renovacoes.em30)}
                descricao="fila de renovação"
                aoClicar={() =>
                  abrir({
                    dimensao: 'vencimento',
                    valor: '30',
                    titulo: 'Vencem nos próximos 30 dias',
                    fila: '/filas/renovacao?prazo=30',
                  })
                }
              />
            </div>
            <SemPremio />
          </>
        );
      }

      return (
        <div className="tiles">
          <TileKpi
            rotulo="Apólices importadas"
            valor={formatarNumero(producao.apolices)}
            aoClicar={() => abrir({ dimensao: 'todasApolices', titulo: 'Todas as apólices da carteira' })}
          />
          <TileKpi
            rotulo="Prêmio apurado"
            valor={formatarReais(producao.premioTotal)}
            descricao={`de ${formatarNumero(producao.comPremio)} apólice(s) com valor`}
            aoClicar={() =>
              abrir({
                dimensao: 'todasApolices',
                titulo: 'Todas as apólices da carteira',
                nota: 'Ordenadas pelo maior prêmio.',
              })
            }
          />
          <TileKpi
            rotulo="Ticket médio"
            valor={producao.ticketMedio === null ? '—' : formatarReais(producao.ticketMedio)}
            descricao="sobre as que têm prêmio"
          />
          {ok.comissaoPorApolice && (
            <TileKpi
              rotulo="Comissão na apólice"
              valor={formatarReais(comissaoCarteira.total)}
              descricao={
                comissaoCarteira.percentualMedio === null
                  ? `${formatarNumero(comissaoCarteira.apolices)} apólice(s)`
                  : `${comissaoCarteira.percentualMedio.toFixed(1)}% do prêmio, em ${formatarNumero(comissaoCarteira.apolices)} apólice(s)`
              }
            />
          )}
          {/* Total menos as com prêmio = quanto da carteira ainda não tem valor conhecido. */}
          <TileKpi
            rotulo="Sem prêmio"
            valor={formatarNumero(producao.apolices - producao.comPremio)}
            descricao="o relatório de origem não trouxe o valor"
            menorEhMelhor
            aoClicar={() =>
              abrir({
                dimensao: 'semPremio',
                titulo: 'Apólices sem prêmio',
                nota: 'A origem não trouxe o valor — não significa prêmio zero.',
              })
            }
          />
        </div>
      );

    case 'prod.premio':
      // Sem prêmio a série não some: troca de unidade (apólices emitidas).
      if (ok.medirEmApolices) {
        if (!ok.serieApolices) {
          return (
            <SerieCurta
              o="a produção mês a mês"
              meses={producao.porMes.filter((m) => m.apolices > 0).length}
            />
          );
        }

        return (
          <>
            <GraficoColunas
              series={[{ nome: 'Apólices emitidas', pontos: serieDeApolices(d) }]}
              formatar={formatarNumero}
              altura={260}
              aoClicar={verMes}
            />
            <SemPremio o="a série mede apólices emitidas, não reais" />
            <NotaDaJanela d={d} />
          </>
        );
      }

      if (!ok.serieProducao) {
        return (
          <SerieCurta o="o prêmio mês a mês" meses={producao.porMes.filter((m) => m.premio > 0).length} />
        );
      }

      return (
        <>
          <GraficoColunas
            series={[{ nome: 'Prêmio emitido', pontos: serieDePremio(d) }]}
            formatar={formatarReais}
            altura={260}
            aoClicar={verMes}
          />
          {/* Sem cadastro de metas: dizer isso em vez de desenhar uma linha inventada. */}
          <p className="texto-discreto">
            Só o emitido: não existe meta cadastrada para servir de segunda linha. O cartão passa a comparar
            assim que houver.
          </p>
          <CoberturaDoPremio d={d} />
          <NotaDaJanela d={d} />
        </>
      );

    case 'prod.propostas':
      // O relatório de vigentes só traz propostas que viraram apólice: qualquer taxa daria 100%.
      return (
        <Pendente
          o="Só existem as propostas que viraram apólice."
          porque="Conversão é proposta fechada sobre proposta feita. O relatório de seguros vigentes traz só o numerador — a taxa daria 100% sempre, o que descreveria o relatório e não a corretora."
          quando="Quando houver relatório de propostas, inclusive as recusadas e as que caducaram."
          alternativa="O número da proposta JÁ é guardado em cada apólice, e é ele que identifica as apólices cujo número o Excel destruiu."
        />
      );

    case 'prod.ticket':
      // Ticket é prêmio ÷ apólices: sem prêmio não há substituto por contagem.
      if (ok.medirEmApolices) return <SemPremio comoCartao o="o ticket médio" />;

      if (!ok.serieProducao)
        return (
          <SerieCurta
            o="o ticket médio mês a mês"
            meses={producao.porMes.filter((m) => m.premio > 0).length}
          />
        );

      return (
        <>
          <GraficoLinha
            series={[
              {
                nome: 'Ticket médio',
                pontos: producao.porMes
                  .filter((m) => m.apolices > 0)
                  .map((m) => ({
                    periodo: formatarCompetencia(m.periodo),
                    valor: m.premio / m.apolices,
                  })),
              },
            ]}
            formatar={formatarReais}
            formatarEixo={formatarReaisCompacto}
            altura={240}
            aoClicar={verMes}
          />
          <p className="texto-discreto">
            Média geral de {producao.ticketMedio === null ? '—' : formatarReais(producao.ticketMedio)}. Meses
            com apólice de grande porte deslocam a linha: uma única apólice de grande porte pesa como
            centenas de apólices de automóvel.
          </p>
        </>
      );

    case 'prod.vendedor':
      if (!ok.producaoPorVendedor) {
        return (
          <Pendente
            o="Nenhuma apólice da sua carteira tem vendedor identificado."
            porque="A produção por vendedor sai de `apolices.produtor_id`, preenchido na importação da carteira. Atribuir a venda pelo produtor do CLIENTE contaria como venda do corretor qualquer apólice que ele já tivesse na carteira."
            quando="Depois de importar um relatório de carteira que traga o produtor por linha."
          />
        );
      }

      return (
        <>
          <BarrasHorizontais
            dados={barras(producao.porVendedor)}
            formatar={formatarReais}
            colorido
            limite={12}
            aoClicar={ver('vendedor', (v) => `Vendas de ${v}`, { naJanela: true, nota: notaJanela })}
          />
          {/* Vendedor da apólice ≠ produtor da carteira do cliente. */}
          <CoberturaDoPremio d={d} />
          <p className="texto-discreto">
            Quem <strong>vendeu</strong> a apólice, nos últimos {producao.janelaMeses} meses — não de quem é a
            carteira do cliente. As duas coisas divergem, e é por isso que são colunas diferentes no banco.
          </p>
        </>
      );

    case 'prod.filial':
      return (
        <Pendente
          o="A apólice não carrega filial."
          porque="Filial só aparece no demonstrativo de comissão, que vem agregado e não desce até a apólice."
          quando="Quando a estrutura de vendas for ligada à apólice na importação."
        />
      );

    case 'prod.seguradora':
      if (!ok.producao) return <SemApolice />;

      return (
        <>
          <BarrasHorizontais
            dados={
              ok.medirEmApolices
                ? barrasPorQuantidade(producao.porSeguradora)
                : barras(producao.porSeguradora)
            }
            formatar={ok.medirEmApolices ? formatarNumero : formatarReais}
            colorido
            limite={12}
            aoClicar={ver('seguradora', (v) => `Apólices da ${v}`)}
          />
          {ok.medirEmApolices && <SemPremio o="a barra conta apólices, não reais" />}
          {!ok.producaoPorSeguradora && (
            <p className="texto-discreto">
              Só há apólice de uma companhia importada — por isso a barra única. A distribuição aparece quando
              a segunda seguradora entrar.
            </p>
          )}
        </>
      );

    case 'prod.ramo':
      // O ramo existe; falta o prêmio — não dizer que falta classificação.
      if (ok.apolicesPorRamo && ok.medirEmApolices) {
        return (
          <>
            <BarrasHorizontais
              dados={barrasPorQuantidade(producao.porRamo)}
              formatar={formatarNumero}
              colorido
              limite={10}
              aoClicar={ver('ramo', (v) => `Apólices do ramo ${v}`)}
            />
            <SemPremio o="a barra conta apólices, não reais" />
            <p className="texto-discreto">
              Ramo SUSEP, pelo produto de cada apólice. Contando apólices, um ramo de muitas apólices pequenas
              parece maior do que um de poucas apólices grandes — a leitura por valor só aparece quando a
              origem trouxer prêmio.
            </p>
          </>
        );
      }

      if (!ok.premioPorRamo) {
        return (
          <Pendente
            o="Os produtos importados não vieram classificados por ramo."
            porque="Agrupar prêmio por ramo exigiria adivinhar o ramo pelo nome do produto — e “YELUM AUTO PERFIL” até seria fácil, mas o erro nos casos difíceis ficaria invisível."
            quando="Depois de importar um relatório de carteira que traga o ramo por linha."
            alternativa={
              ok.ramoPorCliente
                ? 'A composição por ramo da CARTEIRA está em Ramos → Participação por ramo, apurada pelos vínculos de cliente.'
                : undefined
            }
          />
        );
      }

      return (
        <>
          <BarrasHorizontais
            dados={barras(producao.porRamo)}
            formatar={formatarReais}
            colorido
            limite={10}
            aoClicar={ver('ramo', (v) => `Apólices do ramo ${v}`)}
          />
          <CoberturaDoPremio d={d} />
          <p className="texto-discreto">
            Prêmio por ramo SUSEP, pelo produto de cada apólice. Alguns ramos têm poucas apólices de valor
            muito alto — a barra mede dinheiro, não volume.
          </p>
        </>
      );

    case 'prod.canal':
      if (!ok.producaoPorCanal) {
        return (
          <Pendente
            o="As apólices não trazem o canal de entrada."
            porque="Sem ele não há como saber por qual rota o negócio chegou — campanha, central de renovação, atendimento ou emissão direta."
            quando="Depois de importar um relatório de carteira que traga o grupo de produção por linha."
          />
        );
      }

      return (
        <>
          <BarrasHorizontais
            dados={barras(producao.porCanal)}
            formatar={formatarReais}
            colorido
            limite={10}
            aoClicar={ver('canal', (v) => `Negócios que entraram por ${v}`, {
              naJanela: true,
              nota: notaJanela,
            })}
          />
          {/* O rótulo do canal é o nome da rota na origem; nenhum canal dispensa o corretor. */}
          <p className="texto-discreto">
            Por qual rota o negócio chegou, nos últimos {producao.janelaMeses} meses. Os nomes vêm da origem e
            identificam a campanha ou a central — não o esforço: toda renovação é trabalhada pelo corretor
            responsável.
          </p>
        </>
      );

    case 'prod.tipoNegocio':
      if (!ok.tipoNegocio) {
        return (
          <Pendente
            o="As apólices não vieram classificadas como novo ou renovação."
            porque="Sem a classificação da origem, separar novo de renovação exigiria inferir pela existência de apólice anterior — que o relatório de vigentes não garante ter."
            quando="Depois de importar um relatório que traga “Tipo de Negócio” por linha."
          />
        );
      }

      return (
        <>
          <GraficoColunas
            series={[
              {
                nome: 'Novos',
                pontos: producao.porMes.map((m) => ({
                  periodo: formatarCompetencia(m.periodo),
                  valor: m.novos,
                })),
              },
              {
                nome: 'Renovações',
                pontos: producao.porMes.map((m) => ({
                  periodo: formatarCompetencia(m.periodo),
                  valor: m.renovacoes,
                })),
              },
            ]}
            formatar={formatarNumero}
            altura={260}
            aoClicar={verMes}
          />
          <div className="tiles">
            {producao.porTipoNegocio.map((t) => (
              <TileKpi
                key={t.rotulo}
                rotulo={t.rotulo}
                valor={formatarNumero(t.apolices)}
                descricao={formatarReais(t.premio)}
                aoClicar={() =>
                  abrir({
                    dimensao: 'tipoNegocio',
                    valor: t.rotulo === 'Novo' ? 'novo' : 'renovacao',
                    titulo: `Apólices: ${t.rotulo.toLowerCase()}`,
                    naJanela: true,
                    nota: notaJanela,
                  })
                }
              />
            ))}
          </div>
          <NotaDaJanela d={d} />
        </>
      );

    // ═══════════════════ Renovações ═══════════════════

    case 'renov.resumo':
      if (!ok.renovacoes) {
        return (
          <Pendente
            o="Nenhuma apólice com vigência futura."
            porque="Sem data de fim de vigência não há o que vencer."
            quando="Quando forem importadas apólices vigentes."
          />
        );
      }

      return (
        <div className="tiles">
          <TileKpi
            rotulo="Em vigor"
            valor={formatarNumero(renovacoes.total)}
            descricao="toda apólice que ainda vai vencer"
            aoClicar={() =>
              abrir({
                dimensao: 'aRenovar',
                titulo: 'Apólices com vigência em aberto',
                fila: '/filas/renovacao',
              })
            }
          />
          <TileKpi
            rotulo="Vencem em 30 dias"
            valor={formatarNumero(renovacoes.em30)}
            descricao="ligar já"
            menorEhMelhor
            aoClicar={() =>
              abrir({
                dimensao: 'vencimento',
                valor: '30',
                titulo: 'Vencem nos próximos 30 dias',
                fila: '/filas/renovacao?prazo=30',
              })
            }
          />
          <TileKpi
            rotulo="Vencem em 60 dias"
            valor={formatarNumero(renovacoes.em60)}
            aoClicar={() =>
              abrir({
                dimensao: 'vencimento',
                valor: '60',
                titulo: 'Vencem nos próximos 60 dias',
                fila: '/filas/renovacao?prazo=60',
              })
            }
          />
          <TileKpi
            rotulo="Vencem em 90 dias"
            valor={formatarNumero(renovacoes.em90)}
            aoClicar={() =>
              abrir({
                dimensao: 'vencimento',
                valor: '90',
                titulo: 'Vencem nos próximos 90 dias',
                fila: '/filas/renovacao?prazo=90',
              })
            }
          />
          {/* Prêmio do que vence em 90 dias; sem prêmio na origem o cartão sai. */}
          {!ok.medirEmApolices && renovacoes.premioEm90 !== undefined && (
            <TileKpi
              rotulo="Prêmio a vencer em 90 dias"
              valor={formatarReais(renovacoes.premioEm90)}
              descricao="o que está em jogo agora"
              aoClicar={() =>
                abrir({
                  dimensao: 'vencimento',
                  valor: '90',
                  titulo: 'Prêmio a vencer em 90 dias',
                  nota: 'As apólices que vencem nos próximos 90 dias, pelo maior prêmio.',
                  fila: '/filas/renovacao?prazo=90',
                })
              }
            />
          )}
        </div>
      );

    case 'renov.porMes': {
      // `Array.isArray`: backend anterior não manda o campo.
      const lista = Array.isArray(renovacoes.porMes) ? renovacoes.porMes : [];
      if (lista.length === 0) {
        return (
          <Pendente
            o="Nenhuma apólice vence nos próximos 12 meses."
            porque="O calendário sai do fim de vigência das apólices em vigor."
            quando="Quando forem importadas apólices vigentes."
          />
        );
      }

      // Doze meses fixos (mês sem vencimento aparece zerado); conta apólices, não prêmio.
      const hoje = new Date();
      const meses = Array.from({ length: 12 }, (_, i) => {
        const dt = new Date(hoje.getFullYear(), hoje.getMonth() + i, 1);
        return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}`;
      });
      const rotuloMes = (m: string, i: number): string =>
        formatarCompetencia(m) + (i === 0 ? ' (resto)' : '');
      const periodoDoRotulo = new Map(meses.map((m, i) => [rotuloMes(m, i), m]));
      // As maiores ganham cor; o resto vira "Outras (N)" (a paleta não cobre dezenas de seguradoras).
      const grupos = maioresEOutras(
        [...new Set(lista.map((x) => x.seguradora))].map((nome) => ({
          rotulo: nome,
          valor: lista.filter((x) => x.seguradora === nome).reduce((t, x) => t + x.apolices, 0),
        })),
      ).map((g) => ({ ...g, nomes: g.agrupadas ?? [g.rotulo] }));
      const noMes = (m: string): { apolices: number; premio: number } =>
        lista
          .filter((x) => x.periodo === m)
          .reduce((t, x) => ({ apolices: t.apolices + x.apolices, premio: t.premio + x.premio }), {
            apolices: 0,
            premio: 0,
          });
      const pico = meses.reduce((a, b) => (noMes(b).apolices > noMes(a).apolices ? b : a));

      return (
        <>
          <GraficoColunas
            series={grupos.map((g) => ({
              nome: g.rotulo,
              pontos: meses.map((m, i) => ({
                periodo: rotuloMes(m, i),
                valor: lista.filter((x) => x.periodo === m && g.nomes.includes(x.seguradora)).reduce((t, x) => t + x.apolices, 0),
              })),
            }))}
            formatar={formatarNumero}
            empilhado
            altura={220}
            aoClicar={(rotulo) => {
              const periodo = periodoDoRotulo.get(rotulo);
              if (!periodo) return;
              abrir({
                dimensao: 'vencimentoMes',
                valor: periodo,
                titulo: `Vencem em ${rotulo}`,
                nota: periodo === meses[0] ? 'Do dia de hoje até o fim do mês.' : undefined,
              });
            }}
          />
          <p className="texto-discreto">
            Mês mais carregado: <strong>{formatarCompetencia(pico)}</strong>, com{' '}
            {formatarNumero(noMes(pico).apolices)} apólice(s)
            {!ok.medirEmApolices && <> e {formatarReais(noMes(pico).premio)} de prêmio</>}. Prepare a equipe
            antes dele.
          </p>
        </>
      );
    }

    case 'renov.carteira':
      if (renovacoes.proximas.length === 0) {
        return <p className="texto-discreto">Nenhuma apólice a vencer.</p>;
      }

      return (
        <FilaDeRenovacao
          proximas={renovacoes.proximas}
          total={renovacoes.total}
          mostrarPremio={!ok.medirEmApolices}
          abrirCliente={abrirCliente}
        />
      );

    case 'renov.seguradora': {
      // `Array.isArray`: backend anterior não manda o campo.
      const lista = Array.isArray(d.renovacoesSeguradora) ? d.renovacoesSeguradora : [];
      if (lista.length === 0) {
        return (
          <Pendente
            o="Nenhuma lista de renovação de seguradora importada."
            porque="O Bradesco não exporta carteira, mas o portal dele gera a lista de apólices a renovar, com o percentual de comissão de cada uma."
            quando="Importe em Importações → Importar arquivos → Bradesco — Apólices a renovar."
          />
        );
      }
      return <ResumoListaDaSeguradora lista={lista} />;
    }

    case 'geral.hoje':
      return <HojeNaCorretora d={d} />;

    case 'fin.inadimplencia': {
      // Nulo para quem não tem `inadimplencia.ler`.
      const atraso = d.inadimplencia;
      if (!atraso) return <p className="texto-discreto">Inadimplência indisponível para o seu perfil.</p>;

      return (
        <>
          <div className="tiles">
            <TileKpi
              rotulo="Em atraso"
              valor={formatarReais(atraso.valorEmAtraso)}
              descricao={`${formatarNumero(atraso.parcelasAtrasadas)} parcela(s)`}
              menorEhMelhor
            />
            <TileKpi
              rotulo="Clientes devendo"
              valor={formatarNumero(atraso.clientesInadimplentes)}
              menorEhMelhor
            />
            <TileKpi
              rotulo="Mais de 30 dias"
              valor={formatarReais(atraso.valorAtrasoGrave)}
              descricao={`${formatarNumero(atraso.parcelasAtrasoGrave)} parcela(s)`}
              menorEhMelhor
            />
          </div>
          <p className="texto-discreto">
            Os mesmos números da tela de <Link to="/financeiro/inadimplencia">Inadimplência</Link>, onde cada
            um abre as parcelas.
          </p>
        </>
      );
    }

    case 'renov.encerradas': {
      const lista = Array.isArray(d.encerradasSeguradora) ? d.encerradasSeguradora : [];
      if (lista.length === 0) {
        return (
          <Pendente
            o="Nenhuma lista de apólices encerradas importada."
            porque="É ela que diz quais apólices acabaram. Cruzada com a placa das apólices novas, mostra quais voltaram."
            quando="Importe em Importações → Importar arquivos → Bradesco — Apólices encerradas."
          />
        );
      }
      return <ResumoEncerradas lista={lista} />;
    }

    case 'renov.historico':
      if (!ok.tipoNegocio) {
        return (
          <Pendente
            o="Não há histórico de renovação e cancelamento."
            porque="A base tem a foto de hoje, não a série dos 24 meses que o gráfico compara."
            quando="Conforme as importações mensais forem se acumulando."
          />
        );
      }

      return (
        <>
          <div className="tiles">
            {/* Sem cobertura, a proporção daria N ÷ N = 100%: mostra quantas estão classificadas. */}
            <TileKpi
              rotulo="Proporção de renovação"
              valor={
                renovacoes.proporcaoRenovacao === null
                  ? '—'
                  : `${(renovacoes.proporcaoRenovacao * 100).toFixed(1)}%`
              }
              descricao={
                renovacoes.proporcaoRenovacao === null && renovacoes.classificacaoTipoNegocio
                  ? `só ${formatarNumero(renovacoes.classificacaoTipoNegocio.classificadas)} de ${formatarNumero(
                      renovacoes.classificacaoTipoNegocio.naJanela,
                    )} apólices dizem se são novas ou renovação`
                  : `das apólices dos últimos ${producao.janelaMeses} meses`
              }
            />
            {producao.porTipoNegocio.map((t) => (
              <TileKpi
                key={t.rotulo}
                rotulo={t.rotulo}
                valor={formatarNumero(t.apolices)}
                aoClicar={() =>
                  abrir({
                    dimensao: 'tipoNegocio',
                    valor: t.rotulo === 'Novo' ? 'novo' : 'renovacao',
                    titulo: `Apólices: ${t.rotulo.toLowerCase()}`,
                    naJanela: true,
                    nota: notaJanela,
                  })
                }
              />
            ))}
          </div>

          <GraficoColunas
            series={[
              {
                nome: 'Renovações',
                pontos: producao.porMes.map((m) => ({
                  periodo: formatarCompetencia(m.periodo),
                  valor: m.renovacoes,
                })),
              },
              {
                nome: 'Novos',
                pontos: producao.porMes.map((m) => ({
                  periodo: formatarCompetencia(m.periodo),
                  valor: m.novos,
                })),
              },
            ]}
            formatar={formatarNumero}
            altura={240}
            aoClicar={verMes}
          />

          {/* Não é taxa de retenção: o relatório de vigentes não traz as que não voltaram. */}
          <p
            className="texto-discreto"
            title="Para retenção faltaria o que venceu e não voltou — que o relatório de seguros vigentes, por definição, não traz."
          >
            Proporção sobre o emitido, não taxa de retenção · canceladas na base:{' '}
            {formatarNumero(renovacoes.canceladas)}
          </p>
          <NotaDaJanela d={d} />
        </>
      );

    case 'renov.probabilidade':
      return (
        <Pendente
          o="Probabilidade de renovação precisa de histórico por cliente."
          porque="O modelo pesa renovações anteriores, sinistro e atraso de pagamento. Com uma única foto da carteira, qualquer número seria um palpite com cara de cálculo."
          quando="Depois de alguns ciclos de renovação importados."
        />
      );

    // ═══════════════════ Receita ═══════════════════

    case 'rec.comissao':
      if (!ok.comissaoPorApolice && !ok.receita) return <SemComissao />;

      return (
        <>
          {ok.comissaoPorApolice && (
            <>
              <GraficoColunas
                series={[
                  {
                    nome: 'Comissão da apólice',
                    pontos: comissaoCarteira.porMes.map((p) => ({
                      periodo: formatarCompetencia(p.periodo),
                      valor: p.valor,
                    })),
                  },
                ]}
                formatar={formatarReais}
                altura={240}
                aoClicar={(rotulo) => {
                  const periodo = mesDoRotulo.get(rotulo);
                  if (periodo) {
                    abrir({
                      dimensao: 'mes',
                      valor: periodo,
                      titulo: `Comissão de ${rotulo}`,
                      nota: 'Comissão bruta da apólice, não o demonstrativo pago.',
                    });
                  }
                }}
              />
              <div className="tiles">
                <TileKpi
                  rotulo="Comissão na apólice"
                  valor={formatarReais(comissaoCarteira.total)}
                  descricao={`${formatarNumero(comissaoCarteira.apolices)} apólice(s), bruto`}
                />
                <TileKpi
                  rotulo="Percentual médio"
                  valor={
                    comissaoCarteira.percentualMedio === null
                      ? '—'
                      : `${comissaoCarteira.percentualMedio.toFixed(2)}%`
                  }
                  descricao="ponderado pelo prêmio"
                />
              </div>
            </>
          )}

          {ok.receita && (
            <div className="tiles">
              <TileKpi
                rotulo="Demonstrativo líquido"
                valor={formatarReais(receita.liquido)}
                descricao={receita.competencias.map(formatarCompetencia).join(' · ')}
              />
              <TileKpi rotulo="Bruto" valor={formatarReais(receita.bruto)} />
              <TileKpi rotulo="Impostos" valor={formatarReais(receita.impostos)} menorEhMelhor />
            </div>
          )}

          {ok.receita && <ComposicaoDaReceita fatias={receita.porTipo} />}
          {ok.receita && <FechamentoPorCompetencia linhas={receita.fechamento} />}

          {ok.comissaoPorApolice && ok.receita && <AvisoDuasComissoes />}
          <NotaDaJanela d={d} />
        </>
      );

    case 'rec.acumulada':
      if (!ok.receita) return <SemComissao />;

      return (
        <>
          {ok.serieReceita && <SerieDeReceita d={d} />}
          <div className="tiles">
            <TileKpi
              rotulo="Acumulado importado"
              valor={formatarReais(receita.liquido)}
              descricao={`${receita.competencias.length} competência(s)`}
            />
            <TileKpi
              rotulo="Carga tributária"
              valor={receita.bruto > 0 ? `${Math.round((receita.impostos / receita.bruto) * 100)}%` : '—'}
              descricao="impostos sobre o bruto"
              menorEhMelhor
            />
          </div>
        </>
      );

    case 'rec.meta':
    case 'seg.metas':
    case 'seg.projecao':
      return (
        <Pendente
          o="Não existe meta cadastrada no sistema."
          porque="Atingimento, gap e projeção são o realizado DIVIDIDO pela meta. Sem ela, o cartão só poderia repetir o realizado com outro nome — ou inventar um alvo, que é pior."
          quando="Quando houver cadastro de metas, por período e por seguradora."
        />
      );

    case 'rec.ramo':
      if (!ok.comissaoPorApolice) {
        return (
          <Pendente
            o="O demonstrativo de comissão não desce até o ramo."
            porque="Ele vem agregado por filial, sem apólice nem produto — não há de onde tirar a comissão de cada ramo."
            quando="Depois de importar um relatório que traga comissão por apólice."
          />
        );
      }

      return (
        <>
          <BarrasHorizontais
            dados={barras(comissaoCarteira.porRamo)}
            formatar={formatarReais}
            colorido
            limite={10}
            aoClicar={ver('ramo', (v) => `Comissão do ramo ${v}`, { nota: 'Comissão bruta da apólice.' })}
          />
          <p className="texto-discreto">
            Comissão <strong>bruta da apólice</strong>, somada por ramo — não o demonstrativo de pagamento.
          </p>
        </>
      );

    case 'rec.seguradora':
      if (!ok.comissaoPorApolice && !ok.receita) return <SemComissao />;

      return (
        <>
          <BarrasHorizontais
            dados={barras(ok.comissaoPorApolice ? comissaoCarteira.porSeguradora : receita.porSeguradora)}
            formatar={formatarReais}
            colorido
            limite={12}
            aoClicar={ok.comissaoPorApolice ? ver('seguradora', (v) => `Comissão na ${v}`) : undefined}
          />
          <p className="texto-discreto">
            {ok.comissaoPorApolice
              ? 'Comissão bruta da apólice, por companhia.'
              : 'Comissão líquida do demonstrativo, por companhia.'}
          </p>
        </>
      );

    case 'rec.vendedor':
      if (!ok.comissaoPorApolice || comissaoCarteira.porVendedor.length === 0) {
        return (
          <Pendente
            o="O demonstrativo de comissão não identifica o corretor."
            porque="Ele vem agregado por filial. Ratear o total pela carteira de cada um seria inventar a divisão — e número inventado em tela de dinheiro é o pior lugar para inventar."
            quando="Depois de importar um relatório que traga comissão e produtor por apólice."
          />
        );
      }

      return (
        <>
          <BarrasHorizontais
            dados={barras(comissaoCarteira.porVendedor)}
            formatar={formatarReais}
            colorido
            limite={12}
            aoClicar={ver('vendedor', (v) => `Comissão gerada por ${v}`, {
              naJanela: true,
              nota: notaJanela,
            })}
          />
          <p className="texto-discreto">
            Comissão bruta gerada por quem <strong>vendeu</strong> a apólice, nos últimos{' '}
            {producao.janelaMeses} meses. Não é o que cada um recebe: o repasse depende de regra de
            comissionamento, que o sistema não tem.
          </p>
        </>
      );

    // ═══════════════════ Clientes ═══════════════════
    // Para a Visão Geral; a área tem página própria (`PainelClientes`).

    case 'cli.resumo':
      if (!ok.carteira) {
        return (
          <Pendente
            o="Nenhum cliente na sua carteira."
            porque="Ou a base não foi importada, ou o seu usuário não tem produtor vinculado."
            quando="Depois da importação de clientes, e do vínculo em Configurações → Usuários."
          />
        );
      }

      return (
        <div className="tiles">
          <TileKpi
            rotulo="Com apólice em vigor"
            valor={formatarNumero(d.carteira.comApoliceVigente)}
            descricao="seguro vigente na base"
            aoClicar={() =>
              abrir({ dimensao: 'situacaoCliente', valor: 'ativo', titulo: 'Clientes com apólice em vigor' })
            }
          />
          {/* "Sem apólice CONHECIDA": a apólice pode só não ter sido importada. */}
          {ok.clientesSemApoliceImportada && (
            <TileKpi
              rotulo="Sem apólice conhecida"
              valor={formatarNumero(d.carteira.semApoliceConhecida)}
              descricao="apólice não importada, não é perda"
              aoClicar={() =>
                abrir({
                  dimensao: 'situacaoCliente',
                  valor: 'sem_apolice_conhecida',
                  titulo: 'Clientes sem apólice conhecida',
                  nota: 'Entraram por uma planilha de cadastro. As apólices deles ainda não foram importadas.',
                })
              }
            />
          )}
          {/* Só quem TEVE apólice e não tem mais; quem nunca teve fica no cartão acima. */}
          <TileKpi
            rotulo="Sem apólice em vigor"
            valor={formatarNumero(d.carteira.inativos)}
            descricao="teve apólice, venceu e não voltou"
            menorEhMelhor
            aoClicar={() =>
              abrir({
                dimensao: 'situacaoCliente',
                valor: 'inativo',
                titulo: 'Clientes sem apólice em vigor',
                nota: 'Tiveram apólice na base e nenhuma está vigente. Derivado — nenhum arquivo traz a situação.',
              })
            }
          />
          <TileKpi
            rotulo="Inadimplentes"
            valor={formatarNumero(d.carteira.inadimplentes)}
            menorEhMelhor
            aoClicar={
              d.carteira.inadimplentes > 0
                ? () =>
                    abrir({
                      dimensao: 'situacaoCliente',
                      valor: 'inadimplente',
                      titulo: 'Clientes inadimplentes',
                    })
                : undefined
            }
          />
          <TileKpi rotulo="Total" valor={formatarNumero(d.carteira.total)} />
        </div>
      );

    case 'cli.movimento':
      if (!ok.carteira) return <SemVinculo />;

      // Entrada e saída precisam de data; `cliente_desde` quase nunca vem preenchido.
      if (!ok.movimentoDeClientes) {
        return (
          <Pendente
            o="Os clientes importados não têm data de entrada nem de saída."
            porque="O movimento é contado por mês, e o relatório das companhias traz a apólice — não a data em que a pessoa passou a ser cliente da corretora. Sem data não há mês onde pendurar o ponto, e a série sairia em zero como se ninguém tivesse entrado."
            quando="Quando entrar um relatório de cadastro com data de inclusão."
            alternativa="A produção mês a mês está em Produção → Prêmio emitido, contada por apólice emitida."
          />
        );
      }

      return (
        <>
          <GraficoColunas
            series={[
              {
                nome: 'Novos',
                pontos: d.movimento.map((m) => ({
                  periodo: formatarCompetencia(m.periodo),
                  valor: m.novos,
                })),
              },
              ...(ok.saidasDeClientes
                ? [
                    {
                      nome: 'Perdidos',
                      pontos: d.movimento.map((m) => ({
                        periodo: formatarCompetencia(m.periodo),
                        valor: m.perdidos,
                      })),
                    },
                  ]
                : []),
            ]}
            formatar={formatarNumero}
            altura={240}
          />
          {/* Sem saída registrada, a linha em zero se leria como "não perdemos ninguém". */}
          {!ok.saidasDeClientes && (
            <p className="texto-discreto">
              Só entradas: nenhuma saída foi registrada com data na base, então a barra de perdidos ficaria em
              zero sem que isso queira dizer retenção perfeita.
            </p>
          )}
        </>
      );

    case 'cli.frequencia': {
      if (!ok.frequenciaDeContratacao) {
        return (
          <Pendente
            o="Nenhum cliente da sua carteira tem mais de uma apólice."
            porque="O gráfico seria uma barra só, com a carteira inteira em 1 apólice — parece apurado e não diz nada."
            quando="Quando houver apólice de mais de um produto por cliente."
          />
        );
      }

      const comApolice = d.clientes.porApolices.reduce((s, x) => s + x.clientes, 0);
      const comMaisDeUma = d.clientes.porApolices
        .filter((x) => x.apolices > 1)
        .reduce((s, x) => s + x.clientes, 0);

      return (
        <>
          <BarrasHorizontais
            dados={d.clientes.porApolices.map((x) => ({
              rotulo: x.apolices === 1 ? '1 apólice' : `${x.apolices} apólices`,
              valor: x.clientes,
            }))}
            formatar={formatarNumero}
            colorido
            aoClicar={(rotulo) => {
              const n = Number.parseInt(rotulo, 10);
              if (Number.isFinite(n)) {
                abrir({
                  dimensao: 'quantidadeApolices',
                  valor: String(n),
                  titulo: `Clientes com ${rotulo}`,
                });
              }
            }}
          />
          <p className="texto-discreto">
            {formatarNumero(comMaisDeUma)} de {formatarNumero(comApolice)} clientes com apólice têm mais de
            uma — {comApolice > 0 ? `${((comMaisDeUma / comApolice) * 100).toFixed(1)}%` : '—'} da carteira
            com apólice.
          </p>
        </>
      );
    }

    case 'cli.crosssell':
      if (!ok.crossSell) {
        return (
          <Pendente
            o="Depende de cliente com mais de um ramo contratado."
            porque="Com um ramo por cliente, a tabela de combinações viria vazia."
            quando="Quando as apólices cobrirem mais de um ramo por cliente."
          />
        );
      }

      return (
        <div className="tabela-rolante">
          <table className="tabela tabela--densa">
            <thead>
              <tr>
                <th scope="col">Ramo</th>
                <th scope="col" className="tabela__num">
                  Clientes
                </th>
                <th scope="col" className="tabela__num">
                  Só esse ramo
                </th>
                <th scope="col" className="tabela__num">
                  Espaço
                </th>
              </tr>
            </thead>
            <tbody>
              {d.clientes.crossSell.map((r) => (
                <tr
                  key={r.ramo}
                  className="tabela__linha--clicavel"
                  onClick={() =>
                    abrir({
                      dimensao: 'crossSellRamo',
                      valor: r.ramo,
                      titulo: `Só têm ${r.ramo}`,
                      nota: 'Clientes deste ramo sem nenhum outro — é a lista de quem abordar.',
                    })
                  }
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      abrir({
                        dimensao: 'crossSellRamo',
                        valor: r.ramo,
                        titulo: `Só têm ${r.ramo}`,
                      });
                    }
                  }}
                >
                  <td>{r.ramo}</td>
                  <td className="tabela__num">{formatarNumero(r.clientes)}</td>
                  <td className="tabela__num">{formatarNumero(r.exclusivos)}</td>
                  <td className="tabela__num">
                    {r.clientes > 0 ? `${((r.exclusivos / r.clientes) * 100).toFixed(0)}%` : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="texto-discreto">
            <strong>Espaço</strong> é a fatia de clientes daquele ramo que não têm nenhum outro — é a lista de
            quem dá para abordar.
          </p>
        </div>
      );

    // ═══════════════════ Ramos ═══════════════════

    case 'ramo.comparativo': {
      // Sem prêmio, a tabela fica só com ramo e contagem.
      if (ok.medirEmApolices && ok.apolicesPorRamo) {
        const totalApolices = producao.porRamo.reduce((s, x) => s + (x.quantidade ?? 0), 0);

        return (
          <>
            <div className="tabela-rolante">
              <table className="tabela tabela--densa">
                <thead>
                  <tr>
                    <th scope="col">Ramo</th>
                    <th scope="col" className="tabela__num">
                      Apólices
                    </th>
                    <th scope="col" className="tabela__num">
                      Part.
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {producao.porRamo.map((r) => {
                    const qtd = r.quantidade ?? 0;
                    const ir = (): void =>
                      abrir({ dimensao: 'ramo', valor: r.rotulo, titulo: `Apólices do ramo ${r.rotulo}` });

                    return (
                      <tr
                        key={r.rotulo}
                        className="tabela__linha--clicavel"
                        onClick={ir}
                        tabIndex={0}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            ir();
                          }
                        }}
                      >
                        <td>{r.rotulo}</td>
                        <td className="tabela__num">{formatarNumero(qtd)}</td>
                        <td className="tabela__num">
                          {totalApolices > 0 ? `${((qtd / totalApolices) * 100).toFixed(1)}%` : '—'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <SemPremio o="prêmio, participação em reais e ticket saem da tabela" />
          </>
        );
      }

      if (!ok.premioPorRamo) {
        if (!ok.ramoPorCliente) return <SemVinculo />;
        return <BarrasHorizontais dados={barras(d.ramosPorCliente)} formatar={formatarNumero} colorido />;
      }

      const totalPremio = producao.porRamo.reduce((s, x) => s + x.valor, 0);
      const comissaoPorRamo = new Map(comissaoCarteira.porRamo.map((r) => [r.rotulo, r.valor]));

      return (
        <div className="tabela-rolante">
          <table className="tabela tabela--densa">
            <thead>
              <tr>
                <th scope="col">Ramo</th>
                <th scope="col" className="tabela__num">
                  Apólices
                </th>
                <th scope="col" className="tabela__num">
                  Prêmio
                </th>
                <th scope="col" className="tabela__num">
                  Part.
                </th>
                <th scope="col" className="tabela__num">
                  Ticket
                </th>
                {ok.comissaoPorApolice && (
                  <th scope="col" className="tabela__num">
                    Comissão
                  </th>
                )}
              </tr>
            </thead>
            <tbody>
              {producao.porRamo.map((r) => {
                const qtd = r.quantidade ?? 0;
                return (
                  <tr
                    key={r.rotulo}
                    className="tabela__linha--clicavel"
                    onClick={() =>
                      abrir({ dimensao: 'ramo', valor: r.rotulo, titulo: `Apólices do ramo ${r.rotulo}` })
                    }
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        abrir({ dimensao: 'ramo', valor: r.rotulo, titulo: `Apólices do ramo ${r.rotulo}` });
                      }
                    }}
                  >
                    <td>{r.rotulo}</td>
                    <td className="tabela__num">{formatarNumero(qtd)}</td>
                    <td className="tabela__num">{formatarReais(r.valor)}</td>
                    <td className="tabela__num">
                      {totalPremio > 0 ? `${((r.valor / totalPremio) * 100).toFixed(1)}%` : '—'}
                    </td>
                    <td className="tabela__num">{qtd > 0 ? formatarReais(r.valor / qtd) : '—'}</td>
                    {ok.comissaoPorApolice && (
                      <td className="tabela__num">
                        {comissaoPorRamo.has(r.rotulo) ? (
                          formatarReais(comissaoPorRamo.get(r.rotulo) ?? 0)
                        ) : (
                          <span className="texto-discreto">—</span>
                        )}
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
          {/* "Possui Sinistro" é sim/não: não serve de numerador para sinistralidade. */}
          <p className="texto-discreto">
            Sem sinistralidade: o relatório de origem traz apenas “possui sinistro” como sim/não — não o valor
            pago, que é o que entraria na conta.
          </p>
        </div>
      );
    }

    case 'ramo.participacao':
      if (ok.premioPorRamo) {
        return (
          <>
            <BarrasHorizontais
              dados={barras(producao.porRamo)}
              formatar={formatarReais}
              colorido
              limite={10}
              aoClicar={ver('ramo', (v) => `Apólices do ramo ${v}`)}
            />
            <p className="texto-discreto">Peso de cada ramo no prêmio emitido.</p>
          </>
        );
      }
      // Sem prêmio, o peso do ramo é medido em apólices da produção, não em vínculos de cliente.
      if (ok.medirEmApolices && ok.apolicesPorRamo) {
        return (
          <>
            <BarrasHorizontais
              dados={barrasPorQuantidade(producao.porRamo)}
              formatar={formatarNumero}
              colorido
              limite={10}
              aoClicar={ver('ramo', (v) => `Apólices do ramo ${v}`)}
            />
            <SemPremio o="o peso de cada ramo é medido em apólices" />
          </>
        );
      }

      if (!ok.ramoPorCliente) return <SemVinculo />;
      return <BarrasHorizontais dados={barras(d.ramosPorCliente)} formatar={formatarNumero} colorido />;

    case 'ramo.crescimento':
      return (
        <Pendente
          o="Crescimento compara dois períodos."
          porque="A base tem uma foto só — o período anterior não existe para servir de base da variação."
          quando="A partir da segunda importação mensal."
        />
      );

    // Usa o mesmo resumo do dashboard de Sinistros.
    case 'sin.resumo':
    case 'sin.mes':
    case 'sin.seguradoras':
      return <WidgetSinistros parte={id} />;

    case 'ramo.sinistralidade':
      if (!ok.frequenciaDeSinistro) {
        return (
          <Pendente
            o="Sinistro nunca foi importado."
            porque="Sinistralidade é sinistro dividido por prêmio. Sem o numerador não há cálculo, e um gráfico zerado pareceria uma carteira sem sinistro, que é outra afirmação."
            quando="Quando houver importação de sinistros, ou a integração trouxer o valor pago."
          />
        );
      }

      return (
        <div className="tabela-rolante">
          <table className="tabela tabela--densa">
            <thead>
              <tr>
                <th scope="col">Ramo</th>
                <th scope="col" className="tabela__num">
                  Apólices
                </th>
                <th scope="col" className="tabela__num">
                  Com sinistro
                </th>
                <th scope="col" className="tabela__num">
                  Frequência
                </th>
                <th scope="col" className="tabela__num">
                  Com assistência
                </th>
              </tr>
            </thead>
            <tbody>
              {d.sinistroPorRamo.map((r) => {
                const total = r.quantidade ?? 0;
                const assistencias = r.assistencias ?? 0;
                const verSinistros = (): void =>
                  abrir({
                    dimensao: 'sinistroRamo',
                    valor: r.rotulo,
                    titulo: `Apólices com sinistro — ${r.rotulo}`,
                    nota: 'Só as que tiveram sinistro. A origem não traz o valor pago.',
                  });
                const verAssistencias = (evento: React.SyntheticEvent): void => {
                  evento.stopPropagation();
                  abrir({
                    dimensao: 'assistenciaRamo',
                    valor: r.rotulo,
                    titulo: `Apólices com assistência — ${r.rotulo}`,
                    nota: 'Guincho e serviços 24h. Não entram na frequência de sinistro.',
                  });
                };

                return (
                  <tr
                    key={r.rotulo}
                    className={r.valor > 0 ? 'tabela__linha--clicavel' : undefined}
                    onClick={r.valor > 0 ? verSinistros : undefined}
                    tabIndex={r.valor > 0 ? 0 : undefined}
                    onKeyDown={
                      r.valor > 0
                        ? (e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault();
                              verSinistros();
                            }
                          }
                        : undefined
                    }
                  >
                    <td>{r.rotulo}</td>
                    <td className="tabela__num">{formatarNumero(total)}</td>
                    <td className="tabela__num">{formatarNumero(r.valor)}</td>
                    <td className="tabela__num">
                      {total > 0 ? `${((r.valor / total) * 100).toFixed(1)}%` : '—'}
                    </td>
                    {assistencias > 0 ? (
                      <td
                        className="tabela__num tabela__celula--clicavel"
                        onClick={verAssistencias}
                        tabIndex={0}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            verAssistencias(e);
                          }
                        }}
                      >
                        {formatarNumero(assistencias)}
                      </td>
                    ) : (
                      <td className="tabela__num">{formatarNumero(assistencias)}</td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
          {/* Frequência (apólices com sinistro) ≠ sinistralidade (prêmio consumido): só a primeira é mensurável. */}
          <p className="texto-discreto">
            É <strong>frequência</strong>, não sinistralidade: os relatórios trazem o acionamento e a reserva,
            sem o valor pago. Diz quantas apólices tiveram sinistro, não quanto do prêmio ele consumiu.
            Assistência 24h (guincho, serviços) fica em coluna própria e não entra na frequência. Ramos com
            menos de 20 apólices ficam fora — 1 sinistro em 3 vira “33%” e não descreve risco nenhum.
          </p>
        </div>
      );

    // ═══════════════════ Seguradoras ═══════════════════

    case 'seg.participacao': {
      if (!ok.producaoPorSeguradora) {
        if (d.seguradorasPorCliente.length === 0) return <SemVinculo />;
        return (
          <BarrasHorizontais
            dados={barras(d.seguradorasPorCliente)}
            formatar={formatarNumero}
            colorido
            limite={10}
          />
        );
      }

      const totalSeg = producao.porSeguradora.reduce((s, x) => s + x.valor, 0);
      const lideres = producao.porSeguradora.slice(0, 3);
      const pesoLideres = totalSeg > 0 ? (lideres.reduce((s, x) => s + x.valor, 0) / totalSeg) * 100 : 0;

      return (
        <>
          <BarrasHorizontais
            dados={barras(producao.porSeguradora)}
            formatar={formatarReais}
            colorido
            limite={12}
            aoClicar={ver('seguradora', (v) => `Apólices da ${v}`)}
          />
          <p className="texto-discreto">
            Por prêmio emitido, em {formatarNumero(producao.porSeguradora.length)} companhias. As três maiores
            concentram {pesoLideres.toFixed(0)}% do prêmio.
          </p>
        </>
      );
    }

    // ═══════════════════ Previsões ═══════════════════

    case 'prev.tendencia':
    case 'prev.sazonalidade':
    case 'prev.forecast':
    case 'prev.demanda':
      // Série de vigentes inclina para cima por sobrevivência: projetar repetiria o viés.
      return (
        <Pendente
          o={`A série tem ${producao.porMes.length} meses, mas vem de um relatório de apólices vigentes.`}
          porque="Cada mês mais antigo já perdeu as apólices que venceram e não foram renovadas. A curva sobe por sobrevivência do dado, não por crescimento da venda — projetá-la levaria esse viés para a frente com cara de previsão."
          quando="Com importações mensais acumuladas, que preservam o que venceu: aí a série passa a medir venda."
          alternativa={`O emitido mês a mês, sem projeção, está em Produção → Prêmio. Fora da janela há ${formatarNumero(producao.foraDaJanela.apolices)} apólice(s) em ${producao.foraDaJanela.meses} meses — resíduo de vigência, não histórico.`}
        />
      );

    case 'prev.cancelamento':
      return (
        <Pendente
          o="Risco de cancelamento precisa de histórico por apólice."
          porque="Ele pesa atraso de pagamento, sinistro e renovações anteriores. Com uma foto só, o modelo não tem o que aprender."
          quando="Depois de alguns meses de importação."
        />
      );

    default: {
      const w = WIDGETS_POR_ID.get(id);
      return (
        <Pendente
          o={`A análise “${w?.titulo ?? id}” ainda não foi ligada a uma origem.`}
          porque="Ela existe no catálogo, mas nenhuma consulta foi escrita para ela."
          quando="Sem previsão."
        />
      );
    }
  }
}

// ─────────────────────────── Ausências recorrentes ───────────────────────────

function SemApolice(): React.JSX.Element {
  return (
    <Pendente
      o="Nenhuma apólice importada ainda."
      porque="Os números de produção saem das apólices; sem elas não há o que somar."
      quando="Depois da primeira importação em Importações → Importar arquivos."
    />
  );
}

/** Aviso de que a origem não traz prêmio; com `comoCartao`, substitui a análise (ex.: ticket médio). */
function SemPremio({ o, comoCartao }: { o?: string; comoCartao?: boolean }): React.JSX.Element {
  if (comoCartao) {
    return (
      <Pendente
        o={`Não há prêmio importado para calcular ${o ?? 'este número'}.`}
        porque="O relatório de apólices emitidas da companhia tem 21 colunas e nenhuma de valor — traz quem, o quê e quando, não quanto. Calcular sobre zero devolveria zero com cara de apurado."
        quando="Quando entrar um relatório que traga prêmio por apólice, como o de produção da companhia."
      />
    );
  }

  return (
    <p className="texto-discreto">
      <strong>Sem valor na origem:</strong> o relatório de apólices emitidas da companhia não traz prêmio —{' '}
      {o ?? 'os números aqui contam apólices, não reais'}. A leitura em dinheiro aparece quando entrar um
      relatório com prêmio por apólice.
    </p>
  );
}

/** Composição da receita: destaca lançamento acima de 1/3 do mês (ex.: acerto retroativo), que distorce a série. */
function ComposicaoDaReceita({ fatias }: { fatias: Fatia[] }): React.JSX.Element | null {
  // Backend anterior não manda o campo.
  if (!Array.isArray(fatias) || fatias.length < 2) return null;

  const total = fatias.reduce((s, f) => s + Math.abs(f.valor), 0);
  const dominante = total > 0 ? fatias.find((f) => Math.abs(f.valor) / total > 1 / 3) : undefined;

  return (
    <>
      <BarrasHorizontais dados={barras(fatias)} formatar={formatarReais} colorido limite={10} />

      {dominante ? (
        <p className="alerta alerta--aviso">
          <strong>
            {dominante.rotulo} responde por {((Math.abs(dominante.valor) / total) * 100).toFixed(0)}% do total
          </strong>{' '}
          ({formatarReais(dominante.valor)} em {formatarNumero(dominante.quantidade ?? 0)} lançamento(s)). Um
          acerto retroativo entra inteiro no mês em que foi pago, mesmo cobrindo meses anteriores — compare a
          série sabendo disso.
        </p>
      ) : (
        <p className="texto-discreto">
          Composição do que a companhia pagou, pelo tipo que ela mesma declara. Cancelamento e restituição
          entram negativos.
        </p>
      )}
    </>
  );
}

/** Fechamento por competência no formato do extrato da companhia, para conferir ordens faltantes contra o portal. */
function FechamentoPorCompetencia({
  linhas,
}: {
  linhas: DadosPaineis['receita']['fechamento'];
}): React.JSX.Element | null {
  if (!Array.isArray(linhas) || linhas.length === 0) return null;

  return (
    <>
      <div className="tabela-rolante">
        <table className="tabela tabela--densa">
          <thead>
            <tr>
              <th scope="col">Competência</th>
              <th scope="col" className="tabela__num">
                Ordens
              </th>
              <th scope="col">Pagamentos</th>
              <th scope="col" className="tabela__num">
                Bruto
              </th>
              <th scope="col" className="tabela__num">
                Impostos
              </th>
              <th scope="col" className="tabela__num">
                Líquido
              </th>
            </tr>
          </thead>
          <tbody>
            {linhas.map((l) => (
              <tr key={l.competencia}>
                <td>{formatarCompetencia(l.competencia)}</td>
                <td className="tabela__num">{formatarNumero(l.ordens)}</td>
                <td className="texto-discreto">
                  {l.primeiro && l.ultimo ? `${formatarData(l.primeiro)} a ${formatarData(l.ultimo)}` : '—'}
                </td>
                <td className="tabela__num">{formatarReais(l.bruto)}</td>
                <td className="tabela__num">{formatarReais(l.impostos)}</td>
                <td className="tabela__num">
                  <strong>{formatarReais(l.liquido)}</strong>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="alerta alerta--aviso">
        <strong>Confira a contagem de ordens contra o portal da companhia.</strong> O demonstrativo vem em um
        arquivo por ordem de pagamento, e o sistema não tem como saber que um deles não foi baixado — cada
        arquivo que chega confere com o próprio rodapé. Já aconteceu de ordens ficarem de fora sem
        que nada acusasse a diferença.
      </p>
    </>
  );
}

/** Receita mensal; separa o tipo de lançamento que passa de 1/3 de algum mês (pelo TIPO da companhia). */
function SerieDeReceita({ d }: { d: DadosPaineis }): React.JSX.Element | null {
  const linhas = d.receita.porCompetenciaTipo;
  if (!Array.isArray(linhas) || linhas.length === 0) return null;

  const meses = [...new Set(linhas.map((l) => l.periodo))].sort();
  const totalDoMes = new Map<string, number>();
  for (const l of linhas) totalDoMes.set(l.periodo, (totalDoMes.get(l.periodo) ?? 0) + l.valor);

  const destaque =
    linhas.find((l) => {
      const total = Math.abs(totalDoMes.get(l.periodo) ?? 0);
      return total > 0 && Math.abs(l.valor) / total > 1 / 3;
    })?.rotulo ?? null;

  const ponto = (periodo: string, valor: number) => ({
    periodo: formatarCompetencia(periodo),
    valor,
  });

  const valorDe = (periodo: string, rotulo: string): number =>
    linhas.find((l) => l.periodo === periodo && l.rotulo === rotulo)?.valor ?? 0;

  const series = destaque
    ? [
        {
          nome: 'Recorrente',
          pontos: meses.map((m) => ponto(m, (totalDoMes.get(m) ?? 0) - valorDe(m, destaque))),
        },
        { nome: destaque, pontos: meses.map((m) => ponto(m, valorDe(m, destaque))) },
      ]
    : [{ nome: 'Comissão bruta', pontos: meses.map((m) => ponto(m, totalDoMes.get(m) ?? 0)) }];

  return (
    <>
      <GraficoColunas
        series={series}
        formatar={formatarReais}
        formatarEixo={formatarReaisCompacto}
        altura={260}
      />
      <p className="texto-discreto">
        Comissão <strong>bruta</strong>, pela data do pagamento.
        {destaque && (
          <>
            {' '}
            <strong>{destaque}</strong> aparece separado porque em algum mês respondeu por mais de um terço do
            total — é lançamento extraordinário, e somado ao recorrente faria o mês seguinte parecer uma
            queda.
          </>
        )}
      </p>
    </>
  );
}

/** Aviso de cobertura do prêmio somado; some a partir de 90%. */
function CoberturaDoPremio({ d }: { d: DadosPaineis }): React.JSX.Element | null {
  const { apolices, comPremio } = d.producao;
  if (apolices === 0 || comPremio === 0) return null;

  const cobertura = comPremio / apolices;
  if (cobertura >= 0.9) return null;

  return (
    <p className="texto-discreto">
      Soma o prêmio de{' '}
      <strong>
        {formatarNumero(comPremio)} de {formatarNumero(apolices)}
      </strong>{' '}
      apólices ({(cobertura * 100).toFixed(0)}%). As demais não têm valor na origem — o total real é maior,
      não menor.
    </p>
  );
}

function SemComissao(): React.JSX.Element {
  return (
    <Pendente
      o="Nenhum demonstrativo de comissão disponível para o seu acesso."
      porque="Ou nada foi importado, ou o seu perfil não vê a comissão da corretora — o demonstrativo vem agregado por filial e não tem como ser recortado por corretor."
      quando="Depois da importação do demonstrativo, com perfil que veja comissão."
    />
  );
}

function SemVinculo(): React.JSX.Element {
  return (
    <Pendente
      o="Nenhum vínculo de cliente com seguradora na sua carteira."
      porque="A composição sai desses vínculos; sem eles a distribuição viria vazia."
      quando="Depois da importação de clientes."
    />
  );
}

/** Explica o corte da série em 12 meses. */
function NotaDaJanela({ d }: { d: DadosPaineis }): React.JSX.Element | null {
  const { janelaMeses, foraDaJanela } = d.producao;
  if (!d.disponivel.serieRecortada) return null;

  return (
    <p className="texto-discreto">
      Últimos {janelaMeses} meses. A origem é o relatório de seguros <strong>vigentes</strong>: apólice que
      venceu e não foi renovada não sai nele. Fora da janela sobram {formatarNumero(foraDaJanela.apolices)}{' '}
      apólice(s) espalhadas por {foraDaJanela.meses} meses — são as plurianuais ainda vivas, não o histórico
      da corretora, e incluí-las desenharia um crescimento que não houve.
    </p>
  );
}

/** As duas comissões (por apólice e demonstrativo) não somam. */
function AvisoDuasComissoes(): React.JSX.Element {
  return (
    <p className="texto-discreto">
      <strong>São duas medidas diferentes e não se somam.</strong> A comissão da apólice é bruta e vem do
      relatório da carteira — sabe o cliente, o vendedor e o ramo. O demonstrativo é o que a seguradora
      efetivamente pagou, já líquido de imposto e agregado por filial, sem descer até o cliente.
    </p>
  );
}

function SerieCurta({ o, meses }: { o: string; meses: number }): React.JSX.Element {
  return (
    <Pendente
      o={`Há ${meses} mês(es) de dado para ${o}.`}
      porque="Uma linha com um ponto sugere uma tendência que não foi medida. Preferimos mostrar o número e dizer que a série ainda não existe."
      quando="A partir do terceiro mês importado."
    />
  );
}

/** Análise sem origem de dados: diz o que falta e para onde ir enquanto isso. */
export function Pendente({
  o,
  porque,
  quando,
  alternativa,
}: {
  o: string;
  porque: string;
  quando: string;
  alternativa?: string;
}): React.JSX.Element {
  return (
    <div className="pendente">
      <p className="pendente__titulo">Sem origem de dados ainda</p>
      <p>{o}</p>
      <p className="texto-discreto">{porque}</p>
      <p className="pendente__quando">{quando}</p>
      {alternativa && <p className="texto-discreto">{alternativa}</p>}
    </div>
  );
}

export function metadadosWidget(id: string): { titulo: string; descricao: string } {
  const w = WIDGETS_POR_ID.get(id);
  return { titulo: w?.titulo ?? id, descricao: w?.descricao ?? '' };
}

/** "Hoje na corretora": números de bater o olho, cada um leva ao detalhe; sem dado para o perfil, não aparece. */
function HojeNaCorretora({ d }: { d: DadosPaineis }): React.JSX.Element {
  const ir = useNavigate();
  const comissao = d.comissaoMes ?? null;
  const atraso = d.inadimplencia ?? null;
  const { abrir } = useDetalhe();
  const c = d.carteiras ?? null;
  const comSeguro = (x: { ativo: number; inadimplente: number }): number => x.ativo + x.inadimplente;
  const agora = new Date();
  const mes = agora.toLocaleDateString('pt-BR', { month: 'long' });
  const mesAtual = `${agora.getFullYear()}-${String(agora.getMonth() + 1).padStart(2, '0')}`;
  const grupos = gruposDoPayload(d.grupos);
  const daCorretora = c ? gruposContados(grupos, c) : [];
  const novos =
    c && Object.values(c).some((x) => x.novosNoMes !== undefined)
      ? {
          total: somarGrupos(daCorretora, (x) => x.novosNoMes),
          comSeguro: somarGrupos(daCorretora, (x) => x.novosNoMesComSeguro),
          anterior: somarGrupos(daCorretora, (x) => x.novosMesAnterior),
        }
      : null;

  return (
    <div className="tiles">
      <TileKpi
        rotulo="Apólices em vigor"
        valor={formatarNumero(d.renovacoes.total)}
        aoClicar={() => ir('/clientes/apolices')}
      />
      {/* Ativo conta o inadimplente (tem apólice em vigor). Sem `carteiras`, o cartão antigo. */}
      {c ? (
        <>
          <TileKpi
            rotulo="Clientes ativos"
            valor={formatarNumero(somarGrupos(daCorretora, comSeguro))}
            descricao={detalheDosGrupos(daCorretora, comSeguro, formatarNumero)}
            aoClicar={() => ir('/dashboards/clientes')}
          />
          <TileKpi
            rotulo="Clientes inativos"
            valor={formatarNumero(somarGrupos(daCorretora, (x) => x.inativo))}
            descricao={`sem apólice vigente · ${detalheDosGrupos(daCorretora, (x) => x.inativo, formatarNumero)}`}
            menorEhMelhor
            aoClicar={() => ir('/dashboards/clientes')}
          />
          {novos && (
            <TileKpi
              rotulo={`Entraram em ${mes}`}
              valor={formatarNumero(novos.total)}
              descricao={`${formatarNumero(novos.comSeguro)} com seguro · mês anterior ${formatarNumero(novos.anterior)}`}
              aoClicar={() =>
                abrir({
                  dimensao: 'entradaMes',
                  valor: mesAtual,
                  titulo: `Entraram em ${mes}`,
                  nota: 'Pela data de entrada do cadastro (há origem que manda só mês e ano).',
                })
              }
            />
          )}
        </>
      ) : (
        <TileKpi
          rotulo="Clientes ativos"
          valor={formatarNumero(d.carteira.comApoliceVigente)}
          aoClicar={() => ir('/dashboards/clientes')}
        />
      )}
      <TileKpi
        rotulo="Vencem em 30 dias"
        valor={formatarNumero(d.renovacoes.em30)}
        descricao="a renovar"
        aoClicar={() => ir('/dashboards/renovacoes')}
      />
      {comissao && (
        <TileKpi
          rotulo={`Comissão recebida em ${mes}`}
          valor={formatarReais(comissao.recebido)}
          aoClicar={() => ir('/dashboards/comissoes')}
        />
      )}
      {comissao && (
        <TileKpi
          rotulo="A receber no mês"
          valor={formatarReais(comissao.aReceber)}
          descricao={
            comissao.emAtraso > 0 ? `+ ${formatarReais(comissao.emAtraso)} travados em atraso` : 'estimado'
          }
          aoClicar={() => ir('/dashboards/comissoes')}
        />
      )}
      {atraso && (
        <TileKpi
          rotulo="Em atraso"
          valor={formatarReais(atraso.valorEmAtraso)}
          descricao={`${formatarNumero(atraso.clientesInadimplentes)} cliente(s)`}
          menorEhMelhor
          aoClicar={() => ir('/financeiro/inadimplencia')}
        />
      )}
    </div>
  );
}

/** Renovações por seguradora em números; cada um leva à aba da Fila de renovação. */
function ResumoListaDaSeguradora({ lista }: { lista: RenovacaoDaSeguradora[] }): React.JSX.Element {
  const ir = useNavigate();
  const hoje = Date.parse(`${new Date().toISOString().slice(0, 10)}T12:00:00`);
  const em30 = lista.filter(
    (r) => (Date.parse(`${r.vigenciaFim}T12:00:00`) - hoje) / 86_400_000 <= 30,
  ).length;
  const semCliente = lista.filter((r) => !r.clienteId).length;
  const cotadas = lista.filter((r) => r.cotadoOutroCorretor).length;
  const abrirLista = (): void => void ir('/filas/renovacao?aba=seguradora');

  return (
    <div className="tiles">
      <TileKpi
        rotulo="Na lista da seguradora"
        valor={formatarNumero(lista.length)}
        descricao="apólices a renovar"
        aoClicar={abrirLista}
      />
      <TileKpi rotulo="Vencem em 30 dias" valor={formatarNumero(em30)} menorEhMelhor aoClicar={abrirLista} />
      <TileKpi
        rotulo="Sem cliente na base"
        valor={formatarNumero(semCliente)}
        descricao="o arquivo não traz CPF"
        menorEhMelhor
        aoClicar={abrirLista}
      />
      <TileKpi
        rotulo="Cotadas por outro corretor"
        valor={formatarNumero(cotadas)}
        descricao="nos últimos 7 dias"
        menorEhMelhor
        aoClicar={abrirLista}
      />
    </div>
  );
}

function ResumoEncerradas({ lista }: { lista: EncerradaDaSeguradora[] }): React.JSX.Element {
  const ir = useNavigate();
  const conta = (x: EncerradaDaSeguradora['desfecho']): number =>
    lista.filter((e) => e.desfecho === x).length;
  const abrir = (x: EncerradaDaSeguradora['desfecho']) => (): void =>
    void ir(`/filas/renovacao?aba=encerradas&desfecho=${x}`);

  return (
    <div className="tiles">
      <TileKpi
        rotulo="Renovadas"
        valor={formatarNumero(conta('renovada'))}
        descricao="apólice nova do mesmo veículo"
        aoClicar={abrir('renovada')}
      />
      <TileKpi
        rotulo="Antes do prazo"
        valor={formatarNumero(conta('antes_do_prazo'))}
        descricao="cancelamento ou endosso"
        menorEhMelhor
        aoClicar={abrir('antes_do_prazo')}
      />
      <TileKpi
        rotulo="Sem renovação na base"
        valor={formatarNumero(conta('sem_renovacao'))}
        descricao="não quer dizer perdida"
        menorEhMelhor
        aoClicar={abrir('sem_renovacao')}
      />
    </div>
  );
}
