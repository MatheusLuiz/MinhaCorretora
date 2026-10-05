import '@/styles/comparacao.css';

import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { TileKpi } from '@/components/graficos';
import { ApiError } from '@/lib/api';
import { formatarCompetencia, formatarNumero, formatarPercentual, formatarReais } from '@/lib/formato';
import { paineisApi, type Comparativo, type NumerosDoMes } from '@/lib/paineis';

/**
 * O mês escolhido contra o mesmo mês do ano anterior. Lado sem cobertura vem
 * sem número e com o motivo — nunca zero, que leria como queda de 100%.
 */

export type MetricaComparada = 'renovadas' | 'taxaRenovacao' | 'novosClientes' | 'carteiraAtiva';

interface Leitura {
  rotulo: string;
  dica: string;
  campo: keyof NumerosDoMes;
  valor: (n: NumerosDoMes) => number | null;
  formatar: (v: number) => string;
  detalhe?: (n: NumerosDoMes) => string | null;
  /** Taxa compara em pontos percentuais; o resto, em variação %. */
  emPontos?: boolean;
  /** Para onde o número leva (fila), quando há lista por trás. */
  fila?: (mes: string) => string;
}

const METRICAS: Record<MetricaComparada, Leitura> = {
  renovadas: {
    rotulo: 'Renovadas',
    dica: 'Apólices de renovação com início de vigência no mês.',
    campo: 'renovadas',
    valor: (n) => n.renovadas.valor?.apolices ?? null,
    formatar: formatarNumero,
    detalhe: (n) => (n.renovadas.valor && n.renovadas.valor.comPremio > 0 ? formatarReais(n.renovadas.valor.premio) : null),
    fila: (mes) => `/filas/emissoes?mes=${mes}&negocio=renovacao`,
  },
  taxaRenovacao: {
    rotulo: 'Taxa de renovação',
    dica: 'Das apólices que venceram no mês, quantas o mesmo cliente renovou (outra apólice começando até 45 dias antes ou depois).',
    campo: 'vencidas',
    valor: (n) => {
      const v = n.vencidas.valor;
      return v && v.venceram > 0 ? (v.renovaram / v.venceram) * 100 : null;
    },
    formatar: (v) => formatarPercentual(v),
    detalhe: (n) =>
      n.vencidas.valor ? `${formatarNumero(n.vencidas.valor.renovaram)} de ${formatarNumero(n.vencidas.valor.venceram)}` : null,
    emPontos: true,
  },
  novosClientes: {
    rotulo: 'Novos clientes',
    dica: 'Clientes cujo "cliente desde" cai no mês.',
    campo: 'novosClientes',
    valor: (n) => n.novosClientes.valor,
    formatar: formatarNumero,
  },
  carteiraAtiva: {
    rotulo: 'Carteira ativa',
    dica: 'Clientes com apólice em vigor no último dia do período (no mês em andamento, hoje).',
    campo: 'carteiraAtiva',
    valor: (n) => n.carteiraAtiva.valor,
    formatar: formatarNumero,
  },
};

/** Os 12 meses até o atual, do mais recente ao mais antigo. */
export function mesesDaComparacao(): string[] {
  const hoje = new Date();
  return Array.from({ length: 12 }, (_, i) => {
    const d = new Date(hoje.getFullYear(), hoje.getMonth() - i, 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  });
}

function useComparativo(mes: string, produtor: string): { dados: Comparativo | null; erro: string | null } {
  const [dados, setDados] = useState<Comparativo | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  useEffect(() => {
    let cancelado = false;
    setErro(null);
    paineisApi
      .comparativo(mes, produtor)
      .then((r) => !cancelado && setDados(r))
      .catch((falha: unknown) => {
        if (cancelado) return;
        setErro(
          falha instanceof ApiError && falha.status === 404
            ? 'Reinicie o backend para ver a comparação.'
            : falha instanceof ApiError
              ? falha.message
              : 'Não foi possível comparar.',
        );
      });
    return () => {
      cancelado = true;
    };
  }, [mes, produtor]);
  return { dados, erro };
}

/** O que um número mostra: valor deste ano, linha do ano passado, variação. */
function ler(chave: MetricaComparada, dados: Comparativo | null) {
  const m = METRICAS[chave];
  if (!dados) return { m, atual: null, passado: null, motivoAtual: null, motivoPassado: null, delta: null, linhaPassado: '…' };
  const atual = m.valor(dados.atual);
  const passado = m.valor(dados.anoPassado);
  const motivoAtual = dados.atual[m.campo].motivo;
  const motivoPassado = dados.anoPassado[m.campo].motivo;
  const delta =
    atual !== null && passado !== null
      ? m.emPontos
        ? atual - passado
        : passado > 0
          ? ((atual - passado) / passado) * 100
          : null
      : null;
  const seta = delta === null ? '' : delta > 0 ? ' ↑ ' : delta < 0 ? ' ↓ ' : ' → ';
  const variacao =
    delta === null ? '' : `${seta}${m.emPontos ? `${formatarNumero(Math.round(Math.abs(delta) * 10) / 10)} p.p.` : formatarPercentual(Math.abs(delta))}`;
  const linhaPassado = `${formatarCompetencia(dados.anterior)}: ${
    passado === null ? (motivoPassado ? 'falta histórico na base' : '—') : m.formatar(passado)
  }${variacao}`;
  return { m, atual, passado, motivoAtual, motivoPassado, delta, linhaPassado };
}

export function SeletorMesComparacao({ valor, aoMudar }: { valor: string; aoMudar: (mes: string) => void }): React.JSX.Element {
  return (
    <label title="O mês escolhido contra o mesmo mês do ano passado">
      <span>Comparar com o ano passado</span>
      <select value={valor} onChange={(e) => aoMudar(e.target.value)}>
        {mesesDaComparacao().map((m, i) => (
          <option key={m} value={m}>
            {formatarCompetencia(m)}
            {i === 0 ? ' (atual)' : ''}
          </option>
        ))}
      </select>
    </label>
  );
}

export function TilesDaComparacao({
  metricas,
  mes,
  produtor = '',
}: {
  metricas: MetricaComparada[];
  mes: string;
  produtor?: string;
}): React.JSX.Element {
  const navigate = useNavigate();
  const { dados, erro } = useComparativo(mes, produtor);
  return (
    <>
      {metricas.map((chave) => {
        const l = ler(chave, dados);
        const sufixo = dados?.emAndamento ? ` até dia ${dados.ateDia}` : '';
        const descricao = erro
          ? erro
          : [l.atual !== null ? l.m.detalhe?.(dados!.atual) : l.motivoAtual, l.linhaPassado].filter(Boolean).join(' · ');
        const fila = l.m.fila && dados && l.atual !== null ? l.m.fila(dados.mes) : null;
        return (
          <TileKpi
            key={chave}
            rotulo={`${l.m.rotulo} em ${formatarCompetencia(mes)}${sufixo}`}
            valor={dados ? (l.atual === null ? '—' : l.m.formatar(l.atual)) : '…'}
            descricao={descricao}
            aoClicar={fila ? () => void navigate(fila) : undefined}
          />
        );
      })}
    </>
  );
}

export function ComparacaoAnual({
  metricas,
  produtor = '',
}: {
  metricas: MetricaComparada[];
  produtor?: string;
}): React.JSX.Element {
  const navigate = useNavigate();
  const [mes, setMes] = useState(mesesDaComparacao()[0]!);
  const { dados, erro } = useComparativo(mes, produtor);

  return (
    <section className="comparacao" aria-label="Este ano comparado ao ano passado">
      <header className="comparacao__topo">
        <span className="comparacao__titulo">Este ano × ano passado</span>
        <select value={mes} onChange={(e) => setMes(e.target.value)} aria-label="Mês da comparação">
          {mesesDaComparacao().map((m, i) => (
            <option key={m} value={m}>
              {formatarCompetencia(m)}
              {i === 0 ? ' (atual)' : ''}
            </option>
          ))}
        </select>
      </header>

      {erro ? (
        <p className="texto-discreto comparacao__erro">{erro}</p>
      ) : (
        <div className="comparacao__numeros">
          {metricas.map((chave) => {
            const l = ler(chave, dados);
            const fila = l.m.fila && dados && l.atual !== null ? l.m.fila(dados.mes) : null;
            const conteudo = (
              <>
                <span className="comparacao__rotulo" title={l.m.dica}>
                  {l.m.rotulo}
                </span>
                <span className="comparacao__valor">{dados ? (l.atual === null ? '—' : l.m.formatar(l.atual)) : '…'}</span>
                {dados && l.atual !== null && l.m.detalhe?.(dados.atual) && (
                  <span className="comparacao__detalhe">{l.m.detalhe(dados.atual)}</span>
                )}
                {dados && l.atual === null && l.motivoAtual && <span className="comparacao__falta">{l.motivoAtual}</span>}
                <span className={`comparacao__passado${l.delta === null ? '' : l.delta > 0 ? ' comparacao__passado--sobe' : l.delta < 0 ? ' comparacao__passado--desce' : ''}`}>
                  {l.linhaPassado}
                </span>
              </>
            );
            return fila ? (
              <button key={chave} type="button" className="comparacao__item comparacao__item--clicavel" onClick={() => void navigate(fila)} title={`${l.m.dica} Clique para ver as apólices.`}>
                {conteudo}
              </button>
            ) : (
              <div key={chave} className="comparacao__item" title={l.m.dica}>
                {conteudo}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
