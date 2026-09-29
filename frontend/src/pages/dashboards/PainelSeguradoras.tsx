import '@/styles/seguradoras.css';

import { useCallback, useEffect, useState } from 'react';

import { CabecalhoPainel } from '@/components/Painel';
import { ApiError } from '@/lib/api';
import {
  painelSeguradorasApi,
  ROTULO_SITUACAO,
  type CartaoSeguradora,
  type ResumoSeguradoras,
  type SituacaoCarga,
} from '@/lib/painelSeguradoras';
import { formatarData, formatarNumero, formatarPercentual, formatarReais } from '@/lib/formato';

/**
 * Dashboard de Seguradoras, uma linha por companhia. O selo de carga fica na linha:
 * relatório atrasado é carteira do mês passado. Comissão só com `comissoes.todas`.
 */

const CLASSE_SELO: Record<SituacaoCarga, string> = {
  em_dia: 'etiqueta etiqueta--ok',
  atrasada: 'etiqueta etiqueta--critico',
  nunca: 'etiqueta etiqueta--atencao',
};

const haQuantoTempo = (dias: number): string =>
  dias <= 0 ? 'hoje' : dias === 1 ? 'ontem' : `há ${formatarNumero(dias)} dias`;

export function PainelSeguradoras(): React.JSX.Element {

  const [dados, setDados] = useState<ResumoSeguradoras | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  const carregar = useCallback(() => {
    setErro(null);
    setDados(null);
    painelSeguradorasApi
      .resumoSeguradoras()
      .then(setDados)
      .catch((falha: unknown) =>
        setErro(
          falha instanceof ApiError && falha.status === 404
            ? 'Este painel precisa do servidor atualizado: reinicie o backend.'
            : falha instanceof ApiError
              ? falha.message
              : 'Não foi possível carregar as seguradoras.',
        ),
      );
  }, []);

  useEffect(() => {
    document.title = 'Seguradoras — MinhaCorretora';
    carregar();
  }, [carregar]);

  useEffect(() => {
    document.body.classList.add('tela-ajustada');
    return () => document.body.classList.remove('tela-ajustada');
  }, []);

  const descricao = 'O peso de cada companhia na carteira e se os relatórios dela estão chegando.';

  if (!dados) {
    return (
      <div className="painel">
        <CabecalhoPainel titulo="Seguradoras" descricao={descricao} />
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

  // `Array.isArray`: backend anterior pode não mandar o campo.
  const seguradoras = Array.isArray(dados.seguradoras) ? dados.seguradoras : [];
  const ordenadas = [...seguradoras].sort(
    (a, b) => b.percentualCarteira - a.percentualCarteira || a.nome.localeCompare(b.nome, 'pt-BR'),
  );
  const comComissao = seguradoras.some((s) => s.comissao);

  return (
    <div className="painel painel--tela">
      <CabecalhoPainel titulo="Seguradoras" descricao={descricao} />

      <p className="seguradoras__legenda texto-discreto">
        {formatarNumero(dados.emVigorTotal)} apólices em vigor
        {dados.premioEmVigorTotal > 0 && <> · {formatarReais(dados.premioEmVigorTotal)} de prêmio em vigor</>}
        {' · '}% da carteira por {dados.basePercentual === 'premio' ? 'prêmio' : 'apólice (sem prêmio na base)'}
        {' · '}relatório em dia = carga há até {dados.prazoDias} dias
      </p>

      {seguradoras.length === 0 ? (
        <p className="texto-discreto">Nenhuma seguradora cadastrada.</p>
      ) : (
        <section className="cartao seguradoras__lista">
          <table className="tabela seguradoras__tabela">
            <thead>
              <tr>
                <th>Seguradora</th>
                <th>% da carteira</th>
                <th className="tabela__num">Em vigor</th>
                <th className="tabela__num">Prêmio em vigor</th>
                {comComissao && (
                  <>
                    <th className="tabela__num">Comissão · mês</th>
                    <th className="tabela__num">Comissão · ano</th>
                  </>
                )}
                <th>Relatórios</th>
                <th>Última carga</th>
              </tr>
            </thead>
            <tbody>
              {ordenadas.map((s) => (
                <Linha
                  key={s.nome}
                  s={s}
                  comComissao={comComissao}
                />
              ))}
            </tbody>
          </table>
        </section>
      )}
    </div>
  );
}

function Linha({ s, comComissao }: { s: CartaoSeguradora; comComissao: boolean }): React.JSX.Element {
  const pendentes = s.relatoriosAtrasados + s.relatoriosNuncaImportados;
  const pct = Math.min(100, Math.max(0, s.percentualCarteira));

  return (
    <tr>
      <td className="seguradoras__nome">{s.nome}</td>
      <td>
        <span className="seguradoras__fatia">
          <span className="seguradoras__barra" aria-hidden="true">
            <span style={{ width: `${pct}%` }} />
          </span>
          <strong>{formatarPercentual(s.percentualCarteira)}</strong>
        </span>
      </td>
      <td className="tabela__num">
        {formatarNumero(s.emVigor)}
        <small className="texto-discreto"> · {formatarNumero(s.clientesEmVigor)} cli.</small>
      </td>
      {/* Sem prêmio na origem, "R$ 0,00" pareceria carteira sem valor. */}
      <td className="tabela__num">
        {s.premioEmVigor === null ? (
          <span className="texto-discreto">relatório sem prêmio</span>
        ) : (
          formatarReais(s.premioEmVigor)
        )}
      </td>
      {comComissao && (
        <>
          <td className="tabela__num">{s.comissao ? formatarReais(s.comissao.mes) : '—'}</td>
          <td className="tabela__num">{s.comissao ? formatarReais(s.comissao.ano) : '—'}</td>
        </>
      )}
      <td>
        <span className={CLASSE_SELO[s.situacaoCargas]}>{ROTULO_SITUACAO[s.situacaoCargas]}</span>{' '}
        <small className={pendentes > 0 ? 'seguradoras__pendentes' : 'texto-discreto'}>
          {pendentes > 0
            ? `${formatarNumero(pendentes)} de ${formatarNumero(s.relatorios)} pendente(s)`
            : `${formatarNumero(s.relatorios)} em dia`}
        </small>
      </td>
      <td>
        {s.ultimaCarga ? (
          <>
            {haQuantoTempo(s.ultimaCarga.dias)}
            <small className="texto-discreto"> · {formatarData(s.ultimaCarga.em.slice(0, 10))}</small>
          </>
        ) : (
          <span className="texto-discreto">nenhuma ainda</span>
        )}
      </td>
    </tr>
  );
}
