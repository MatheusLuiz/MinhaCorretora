import '@/styles/carteira.css';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';

import { GraficoColunas, GraficoRosca } from '@/components/graficos';
import { AreaDoGrafico } from '@/components/graficos/AreaDoGrafico';
import { CabecalhoPainel } from '@/components/Painel';
import { useDetalhe } from '@/hooks/useDetalhe';
import { ApiError } from '@/lib/api';
import {
  filaCadastroApi,
  type ContagemDaCarteira,
  type Pendencia,
  type ResumoCarteira,
} from '@/lib/filaCadastro';
import { formatarCompetencia, formatarNumero, formatarPercentual } from '@/lib/formato';
import { ComparacaoAnual } from '@/components/ComparacaoAnual';
import { detalheDosGrupos, gruposContados, gruposDoPayload, somarGrupos } from '@/lib/gruposCliente';

/**
 * Dashboard de Clientes: quem é cliente hoje e com quem a corretora consegue falar.
 * O número de cada barra É o total da fila filtrada (mesma consulta-base no servidor).
 */

const hoje = new Date();
const mesAtual = `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, '0')}`;
const nomeDoMes = hoje.toLocaleDateString('pt-BR', { month: 'long' });

/** Inadimplente tem apólice em vigor: conta como com seguro. */
const comSeguro = (c: ContagemDaCarteira): number => c.ativo + c.inadimplente;

const QUALIDADE: { pendencia: Pendencia; rotulo: string; porque: string }[] = [
  { pendencia: 'sem_telefone', rotulo: 'Com telefone', porque: 'sem telefone, ninguém liga para renovar' },
  { pendencia: 'sem_email', rotulo: 'Com e-mail', porque: 'o segundo caminho quando o telefone não atende' },
  {
    pendencia: 'sem_endereco',
    rotulo: 'Com endereço',
    porque: 'visita, correspondência e cotação de residencial',
  },
  {
    pendencia: 'sem_nascimento',
    rotulo: 'Com nascimento/abertura',
    porque: 'idade e aniversário entram no preço e no contato',
  },
  {
    pendencia: 'sem_corretor',
    rotulo: 'Com corretor',
    porque: 'sem dono, a carteira não aparece para ninguém',
  },
];

/** A cor só acompanha: percentual e "faltam N" estão escritos, para quem não distingue cores. */
function tom(pct: number): 'bom' | 'atencao' | 'critico' {
  if (pct >= 90) return 'bom';
  if (pct >= 60) return 'atencao';
  return 'critico';
}

/** `GraficoRosca` desenha em px fixos: medir o contêiner faz a rosca crescer em F11. */
function useLadoDaRosca(): [React.RefObject<HTMLDivElement | null>, number] {
  const area = useRef<HTMLDivElement>(null);
  const [lado, setLado] = useState(180);

  useEffect(() => {
    const el = area.current;
    if (!el) return;
    const medir = (): void => {
      const { width, height } = el.getBoundingClientRect();
      if (width <= 0 || height <= 0) return;
      const novo = Math.round(Math.max(120, Math.min(height - 16, width - 240, 360)));
      setLado((atual) => (Math.abs(atual - novo) > 2 ? novo : atual));
    };
    const observador = new ResizeObserver(medir);
    observador.observe(el);
    medir();
    return () => observador.disconnect();
  });

  return [area, lado];
}

export function PainelCarteira(): React.JSX.Element {
  const navigate = useNavigate();
  const { abrir } = useDetalhe();
  const [resumo, setResumo] = useState<ResumoCarteira | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [areaRosca, ladoRosca] = useLadoDaRosca();

  const carregar = useCallback(() => {
    setErro(null);
    filaCadastroApi
      .resumo()
      .then(setResumo)
      .catch((falha: unknown) =>
        setErro(
          falha instanceof ApiError && falha.status === 404
            ? 'O resumo da carteira precisa do servidor atualizado: reinicie o backend.'
            : falha instanceof ApiError
              ? falha.message
              : 'Não foi possível carregar o resumo da carteira.',
        ),
      );
  }, []);

  useEffect(() => {
    document.title = 'Clientes — MinhaCorretora';
    carregar();
  }, [carregar]);

  useEffect(() => {
    document.body.classList.add('tela-ajustada');
    return () => document.body.classList.remove('tela-ajustada');
  }, []);

  const irParaFila = (pendencia: Pendencia): void => {
    void navigate(`/filas/cadastro?pendencia=${pendencia}`);
  };

  const cabecalho = (
    <CabecalhoPainel
      titulo="Clientes"
      descricao="Saúde da carteira: quem é cliente e com quem a corretora consegue falar. Clique numa barra para corrigir na fila."
    />
  );

  if (!resumo) {
    return (
      <div className="painel">
        {cabecalho}
        {erro ? (
          <p className="alerta alerta--erro" role="alert">
            {erro}{' '}
            <button type="button" className="botao botao--discreto botao--compacto" onClick={carregar}>
              Tentar de novo
            </button>
          </p>
        ) : (
          <p className="texto-discreto">Carregando…</p>
        )}
      </div>
    );
  }

  const { total, situacao, pendencias } = resumo;
  const fatias = [
    { rotulo: 'Ativos', valor: situacao.ativo },
    { rotulo: 'Inadimplentes', valor: situacao.inadimplente },
    { rotulo: 'Inativos', valor: situacao.inativo },
    { rotulo: 'Prospectos', valor: situacao.prospecto },
    { rotulo: 'Sem situação', valor: situacao.semSituacao },
  ];
  const semContato = pendencias.sem_contato;
  const porCarteira = resumo.porCarteira;
  const grupos = gruposDoPayload(resumo.grupos);
  const daCorretora = porCarteira ? gruposContados(grupos, porCarteira) : [];
  const somar = (campo: 'novosNoMes' | 'novosNoMesComSeguro' | 'novosMesAnterior'): number =>
    somarGrupos(daCorretora, (c) => c[campo]);
  // Mês sem entrada vira zero: senão o gráfico pularia o mês e pareceria contínuo.
  const entradas = Array.isArray(resumo.entradasPorMes)
    ? Array.from({ length: 12 }, (_, i) => {
        const d = new Date(hoje.getFullYear(), hoje.getMonth() - 11 + i, 1);
        const mes = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
        const x = resumo.entradasPorMes!.find((e) => e.mes === mes);
        return {
          mes,
          rotulo: formatarCompetencia(mes) + (mes === mesAtual ? ' (parcial)' : ''),
          clientes: x?.clientes ?? 0,
          comSeguro: x?.comSeguro ?? 0,
        };
      })
    : null;
  const novos =
    porCarteira && Object.values(porCarteira).some((c) => c.novosNoMes !== undefined)
      ? {
          total: somar('novosNoMes'),
          comSeguro: somar('novosNoMesComSeguro'),
          anterior: somar('novosMesAnterior'),
        }
      : null;

  return (
    <div className="painel painel--tela">
      {cabecalho}

      {resumo.recorte.semCarteira && (
        <p className="alerta" role="status">
          Nenhuma carteira ligada ao seu usuário ainda: os números aparecem quando um cliente for atribuído a
          você.
        </p>
      )}

      {porCarteira && (
        <div className="carteira__bases" role="group" aria-label="Base de clientes">
          <div
            className="carteira__base"
            title={`${daCorretora.map((g) => g.nome).join(' + ') || 'Corretora'}: a carteira da corretora.`}
          >
            <span className="carteira__base-nome">Corretora</span>
            <span className="carteira__base-numeros">
              <span>
                <strong>{formatarNumero(somarGrupos(daCorretora, comSeguro))}</strong> ativos
                <small className="texto-discreto">
                  {detalheDosGrupos(daCorretora, comSeguro, formatarNumero)}
                </small>
              </span>
              <span>
                <strong>{formatarNumero(somarGrupos(daCorretora, (c) => c.inativo))}</strong> inativos
                <small className="texto-discreto">
                  {detalheDosGrupos(daCorretora, (c) => c.inativo, formatarNumero)}
                </small>
              </span>
            </span>
          </div>
        </div>
      )}

      <div className="carteira__faixa">
        {/* O total da gaveta é este número (mesma condição no servidor). */}
        {novos && (
          <button
            type="button"
            className="carteira__destaque"
            onClick={() =>
              abrir({
                dimensao: 'entradaMes',
                valor: mesAtual,
                titulo: `Entraram em ${nomeDoMes}`,
                nota: 'Pela data de entrada do cadastro (há origem que manda só mês e ano).',
              })
            }
            title="Ver os clientes que entraram neste mês"
          >
            <span className="carteira__destaque-valor">{formatarNumero(novos.total)}</span>
            <span className="carteira__destaque-texto">
              <strong>entraram em {nomeDoMes}</strong>
              <span className="texto-discreto">
                {formatarNumero(novos.comSeguro)} com seguro vigente ·{' '}
                {formatarNumero(novos.total - novos.comSeguro)} sem apólice · no mês anterior,{' '}
                {formatarNumero(novos.anterior)} (o atual ainda está em curso)
              </span>
            </span>
            <span className="carteira__destaque-acao" aria-hidden="true">
              Ver →
            </span>
          </button>
        )}

        <button
          type="button"
          className={`carteira__destaque${semContato > 0 ? ' carteira__destaque--alerta' : ''}`}
          onClick={() => irParaFila('sem_contato')}
          title="Abrir na fila de cadastro os clientes sem telefone e sem e-mail"
        >
          <span className="carteira__destaque-valor">{formatarNumero(semContato)}</span>
          <span className="carteira__destaque-texto">
            <strong>sem nenhum contato</strong>
            <span className="texto-discreto">
              de {formatarNumero(total)} clientes da base, sem telefone nem e-mail — não há como
              avisar da renovação
            </span>
          </span>
          <span className="carteira__destaque-acao" aria-hidden="true">
            Corrigir →
          </span>
        </button>
        <ComparacaoAnual metricas={['novosClientes', 'carteiraAtiva']} />
      </div>

      <div className="carteira__corpo">
        <section className="cartao carteira__situacao">
          <header className="cartao__cabecalho">
            <h2 title="Ativo tem apólice em vigor na base; inativo não tem nenhuma vigente">Situação</h2>
          </header>
          <div ref={areaRosca} className="carteira__rosca">
            <GraficoRosca dados={fatias} formatar={formatarNumero} tamanho={ladoRosca} />
          </div>
          <p className="cartao__rodape carteira__atalhos">
            <Link to="/filas/cadastro?pendencia=inadimplente">
              Inadimplentes ({formatarNumero(situacao.inadimplente)})
            </Link>
            <Link to="/filas/cadastro?pendencia=inativo">
              Inativos a recuperar ({formatarNumero(situacao.inativo)})
            </Link>
            {pendencias.nome_mascarado > 0 && (
              <Link to="/filas/cadastro?pendencia=nome_mascarado">
                Nome mascarado ({formatarNumero(pendencias.nome_mascarado)})
              </Link>
            )}
          </p>
        </section>

        {entradas && (
          <section className="cartao carteira__entradas">
            <header className="cartao__cabecalho">
              <h2 title="Pela data de entrada do cadastro. Clique numa coluna para ver os clientes.">
                Entraram por mês
              </h2>
            </header>
            {entradas.every((e) => e.clientes === 0) ? (
              <p className="texto-discreto">Nenhum cliente com data de entrada nos últimos 12 meses.</p>
            ) : (
              <AreaDoGrafico>
                {(altura) => (
                  <GraficoColunas
                    series={[
                      {
                        nome: 'Com seguro hoje',
                        pontos: entradas.map((e) => ({ periodo: e.rotulo, valor: e.comSeguro })),
                      },
                      {
                        nome: 'Sem apólice vigente',
                        pontos: entradas.map((e) => ({ periodo: e.rotulo, valor: e.clientes - e.comSeguro })),
                      },
                    ]}
                    formatar={formatarNumero}
                    empilhado
                    altura={altura}
                    aoClicar={(rotulo) => {
                      const e = entradas.find((x) => x.rotulo === rotulo);
                      if (!e) return;
                      abrir({
                        dimensao: 'entradaMes',
                        valor: e.mes,
                        titulo: `Entraram em ${formatarCompetencia(e.mes)}`,
                        nota: 'Pela data de entrada do cadastro (há origem que manda só mês e ano).',
                      });
                    }}
                  />
                )}
              </AreaDoGrafico>
            )}
          </section>
        )}

        <section className="cartao carteira__qualidade">
          <header className="cartao__cabecalho">
            <h2 title="Quanto da base tem cada dado preenchido. Clique para ver quem falta.">
              Qualidade do cadastro
            </h2>
            <Link
              className="botao botao--principal botao--compacto carteira__botao-fila"
              to="/filas/cadastro"
              title="Abrir a fila de cadastro"
            >
              Fila
            </Link>
          </header>
          <ul className="carteira__barras">
            {QUALIDADE.map((q) => {
              const faltam = pendencias[q.pendencia] ?? 0;
              const tem = Math.max(0, total - faltam);
              const pct = total > 0 ? (tem / total) * 100 : 0;
              return (
                <li key={q.pendencia}>
                  <button
                    type="button"
                    className={`carteira__barra carteira__barra--${tom(pct)}`}
                    onClick={() => irParaFila(q.pendencia)}
                    disabled={faltam === 0}
                    title={
                      faltam === 0
                        ? 'Nenhum cliente com esta pendência'
                        : `Ver os ${faltam} na fila — ${q.porque}`
                    }
                  >
                    <span className="carteira__barra-rotulo">{q.rotulo}</span>
                    <span className="carteira__barra-numero">
                      <strong>{formatarPercentual(pct, 0)}</strong>
                      <span className="texto-discreto">
                        {faltam === 0 ? 'completo' : `faltam ${formatarNumero(faltam)}`}
                      </span>
                    </span>
                    <span
                      className="carteira__barra-trilho"
                      role="progressbar"
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-valuenow={Math.round(pct)}
                      aria-label={`${q.rotulo}: ${formatarPercentual(pct, 0)}`}
                    >
                      <span className="carteira__barra-preenchido" style={{ width: `${pct}%` }} />
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      </div>
    </div>
  );
}
