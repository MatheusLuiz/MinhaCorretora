import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { BarrasHorizontais, GraficoColunas, TileKpi } from '@/components/graficos';
import { ApiError } from '@/lib/api';
import { filaSinistrosApi, type ResumoSinistros, type TipoAcionamento } from '@/lib/filaSinistros';
import { formatarCompetencia, formatarNumero, formatarPercentual, formatarReais } from '@/lib/formato';

/** Blocos do dashboard de Sinistros, usados também pelos widgets da Visão geral. */

// Os widgets montam juntos e pediriam o mesmo resumo várias vezes; vale por 30 s.
let emVoo: { quando: number; promessa: Promise<ResumoSinistros> } | null = null;

function buscarResumo(): Promise<ResumoSinistros> {
  if (!emVoo || Date.now() - emVoo.quando > 30_000) {
    emVoo = { quando: Date.now(), promessa: filaSinistrosApi.resumo() };
    emVoo.promessa.catch(() => {
      emVoo = null;
    });
  }
  return emVoo.promessa;
}

export function useResumoSinistros(): { resumo: ResumoSinistros | null; erro: string | null } {
  const [resumo, setResumo] = useState<ResumoSinistros | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  useEffect(() => {
    let cancelado = false;
    buscarResumo()
      .then((r) => !cancelado && setResumo(r))
      .catch((falha: unknown) => {
        if (cancelado) return;
        setErro(
          falha instanceof ApiError && falha.status === 404
            ? 'O painel de sinistros precisa do servidor atualizado: reinicie o backend.'
            : falha instanceof ApiError
              ? falha.message
              : 'Não foi possível carregar os sinistros.',
        );
      });
    return () => {
      cancelado = true;
    };
  }, []);
  return { resumo, erro };
}

export function useAbrirFila(): (filtro: Record<string, string>) => void {
  const navigate = useNavigate();
  return (filtro) => void navigate(`/filas/sinistros?${new URLSearchParams(filtro).toString()}`);
}

export function NumerosSinistros({ resumo }: { resumo: ResumoSinistros }): React.JSX.Element {
  const abrirFila = useAbrirFila();
  const { sinistros, assistencias } = resumo;
  const cobertura = Array.isArray(resumo.cobertura) ? resumo.cobertura : [];
  const comMarca = cobertura.reduce((t, c) => t + c.comMarca, 0);
  const idade = Array.isArray(resumo.idadeDosAbertos) ? resumo.idadeDosAbertos : [];
  const antigos = idade.filter((x) => x.faixa === 'mais60').reduce((t, x) => t + x.quantidade, 0);

  return (
    <div className="sinistros-painel__numeros">
      <TileKpi
        rotulo="Sinistros em análise"
        valor={formatarNumero(sinistros.emAnalise)}
        descricao={sinistros.emAnalise > 0 ? `reserva de ${formatarReais(sinistros.reservaEmAnalise)}` : 'nenhum aberto'}
        aoClicar={() => abrirFila({ tipo: 'sinistro', status: 'em_analise' })}
      />
      <TileKpi
        rotulo="Assistências em análise"
        valor={formatarNumero(assistencias.emAnalise)}
        descricao={`de ${formatarNumero(assistencias.total)} acionamento(s) de guincho e serviços`}
        aoClicar={() => abrirFila({ tipo: 'assistencia', status: 'em_analise' })}
      />
      <TileKpi
        rotulo="Abertos há mais de 60 dias"
        valor={formatarNumero(antigos)}
        descricao="sinistros e assistências em análise, desde a comunicação"
        aoClicar={() => abrirFila({ status: 'em_analise' })}
      />
      <TileKpi
        rotulo="Sinistros recusados"
        valor={formatarNumero(sinistros.recusados)}
        descricao={`de ${formatarNumero(sinistros.total)} sinistro(s) nos relatórios`}
        aoClicar={() => abrirFila({ tipo: 'sinistro', status: 'recusado' })}
      />
      {/* A marca "possui sinistro" não é acionamento: não tem lista na fila. */}
      <TileKpi
        rotulo="Apólices com sinistro (marca da origem)"
        valor={formatarNumero(comMarca)}
        descricao="marca “possui sinistro” — sem valor nem data"
      />
    </div>
  );
}

const NOMES_TIPO: Record<TipoAcionamento, string> = { sinistro: 'Sinistro', assistencia: 'Assistência' };

export function SerieSinistros({ resumo, altura }: { resumo: ResumoSinistros; altura?: number }): React.JSX.Element {
  const abrirFila = useAbrirFila();
  const porMes = Array.isArray(resumo.porMes) ? resumo.porMes : [];
  const hoje = new Date();
  const meses = Array.from({ length: 12 }, (_, i) => {
    const d = new Date(hoje.getFullYear(), hoje.getMonth() - 11 + i, 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  });
  const rotulo = new Map(meses.map((m) => [formatarCompetencia(m), m]));
  if (porMes.length === 0) return <p className="texto-discreto">Nenhum acionamento nos últimos 12 meses.</p>;
  return (
    <GraficoColunas
      series={(['sinistro', 'assistencia'] as const).map((tipo) => ({
        nome: NOMES_TIPO[tipo],
        pontos: meses.map((m) => ({
          periodo: formatarCompetencia(m),
          valor: porMes.filter((x) => x.periodo === m && x.tipo === tipo).reduce((t, x) => t + x.quantidade, 0),
        })),
      }))}
      formatar={formatarNumero}
      empilhado
      altura={altura}
      aoClicar={(r) => {
        const m = rotulo.get(r);
        if (m) abrirFila({ mes: m });
      }}
    />
  );
}

export function PorSeguradora({ resumo }: { resumo: ResumoSinistros }): React.JSX.Element {
  const abrirFila = useAbrirFila();
  const linhas = Array.isArray(resumo.porSeguradora) ? resumo.porSeguradora : [];
  const total = new Map<string, number>();
  for (const l of linhas) total.set(l.seguradora, (total.get(l.seguradora) ?? 0) + l.quantidade);
  const dados = [...total].sort((a, b) => b[1] - a[1]).map(([rotulo, valor]) => ({ rotulo, valor }));
  if (dados.length === 0) return <p className="texto-discreto">Nenhum acionamento importado.</p>;
  return <BarrasHorizontais dados={dados} formatar={formatarNumero} limite={8} aoClicar={(seguradora) => abrirFila({ seguradora })} />;
}

export function PorCausa({ resumo }: { resumo: ResumoSinistros }): React.JSX.Element {
  const abrirFila = useAbrirFila();
  const linhas = Array.isArray(resumo.porCausa) ? resumo.porCausa : [];
  // Sinistro antes de assistência: é o que custa; dentro, a mais frequente.
  const dados = [...linhas]
    .sort((a, b) => (a.tipo === b.tipo ? b.quantidade - a.quantidade : a.tipo === 'sinistro' ? -1 : 1))
    .slice(0, 6)
    .map((l) => ({ rotulo: `${NOMES_TIPO[l.tipo]} · ${l.causa}`, valor: l.quantidade, l }));
  if (dados.length === 0) return <p className="texto-discreto">Sem causa informada.</p>;
  return (
    <BarrasHorizontais
      dados={dados.map(({ rotulo, valor }) => ({ rotulo, valor }))}
      formatar={formatarNumero}
      aoClicar={(r) => {
        const item = dados.find((d) => d.rotulo === r);
        if (item) abrirFila({ tipo: item.l.tipo, causa: item.l.causa });
      }}
    />
  );
}

/** Sem relatório de uma companhia, o zero dela é falta de dado, não carteira sem sinistro. */
export function AvisoCobertura({ resumo }: { resumo: ResumoSinistros }): React.JSX.Element | null {
  const cobertura = Array.isArray(resumo.cobertura) ? resumo.cobertura : [];
  if (cobertura.length === 0) return null;
  const com = cobertura.filter((c) => c.temRelatorio);
  const sem = cobertura.filter((c) => !c.temRelatorio);
  if (sem.length === 0) return null;
  const emVigor = cobertura.reduce((t, c) => t + c.emVigor, 0);
  const cobertas = com.reduce((t, c) => t + c.emVigor, 0);
  const principais = sem.slice(0, 5).map((c) => `${c.seguradora} (${formatarNumero(c.emVigor)})`).join(', ');
  return (
    <p className="alerta alerta--aviso sinistros-painel__aviso" title={sem.map((c) => `${c.seguradora}: ${formatarNumero(c.emVigor)} em vigor`).join('\n')}>
      Relatório de sinistros importado de {com.length ? com.map((c) => c.seguradora).join(', ') : 'nenhuma seguradora'} —{' '}
      {formatarPercentual(emVigor ? (cobertas / emVigor) * 100 : 0)} das apólices em vigor. Sem relatório:{' '}
      {principais}
      {sem.length > 5 ? ` e mais ${sem.length - 5}` : ''}. Nelas, zero aqui é falta de dado.
    </p>
  );
}
