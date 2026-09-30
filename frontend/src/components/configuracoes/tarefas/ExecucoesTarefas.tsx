import { useCallback, useEffect, useState } from 'react';

import { LogExecucao } from '@/components/configuracoes/tarefas/LogExecucao';
import { ApiError } from '@/lib/api';
import { ROTULO_SITUACAO, formatarQuando, tarefasApi, type ExecucaoGeral, type Tarefa } from '@/lib/tarefas';

const POR_PAGINA = 8;

/** Execuções de todas as tarefas; paginado no SERVIDOR porque o histórico cresce todo dia. */
export function ExecucoesTarefas({ tarefas }: { tarefas: Tarefa[] }): React.JSX.Element {
  const [filtroTarefa, setFiltroTarefa] = useState('');
  const [filtroSituacao, setFiltroSituacao] = useState('');
  const [pagina, setPagina] = useState(1);
  const [dados, setDados] = useState<{ total: number; execucoes: ExecucaoGeral[] } | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [aberta, setAberta] = useState<number | null>(null);

  const carregar = useCallback(async (): Promise<void> => {
    setErro(null);
    try {
      setDados(
        await tarefasApi.execucoesGerais({
          tarefa: filtroTarefa || undefined,
          situacao: filtroSituacao || undefined,
          pagina,
          porPagina: POR_PAGINA,
        }),
      );
    } catch (falha) {
      setErro(falha instanceof ApiError ? falha.message : 'Não foi possível carregar as execuções.');
    }
  }, [filtroTarefa, filtroSituacao, pagina]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  // Com execução em andamento na página, a lista se atualiza sozinha.
  const emAndamento = dados?.execucoes.some((e) => e.situacao === 'executando') ?? false;
  useEffect(() => {
    if (!emAndamento) return;
    const t = setInterval(() => void carregar(), 3000);
    return () => clearInterval(t);
  }, [emAndamento, carregar]);

  const paginas = dados ? Math.max(1, Math.ceil(dados.total / POR_PAGINA)) : 1;
  const filtrar = (mudar: () => void): void => {
    mudar();
    setPagina(1);
  };

  return (
    <div className="usuarios">
      <div className="tipos-seguro__barra">
        <select
          value={filtroTarefa}
          onChange={(e) => filtrar(() => setFiltroTarefa(e.target.value))}
          aria-label="Filtrar por tarefa"
        >
          <option value="">Todas as tarefas</option>
          {tarefas.map((t) => (
            <option key={t.id} value={t.id}>
              {t.nome}
            </option>
          ))}
        </select>
        <select
          value={filtroSituacao}
          onChange={(e) => filtrar(() => setFiltroSituacao(e.target.value))}
          aria-label="Filtrar por resultado"
        >
          <option value="">Todos os resultados</option>
          {Object.entries(ROTULO_SITUACAO).map(([chave, r]) => (
            <option key={chave} value={chave}>
              {r.texto}
            </option>
          ))}
        </select>
        <button type="button" className="botao botao--discreto botao--compacto" onClick={() => void carregar()}>
          Atualizar
        </button>
      </div>

      {erro && (
        <p className="alerta alerta--erro" role="alert">
          {erro}
        </p>
      )}

      {!dados && !erro && <p className="texto-discreto">Carregando…</p>}

      {dados && dados.execucoes.length === 0 && <p className="texto-discreto">Nenhuma execução.</p>}

      {dados && dados.execucoes.length > 0 && (
        <div className="tabela-rolante">
          <table className="tabela tabela--densa tabela--clicavel">
            <thead>
              <tr>
                <th scope="col">Quando</th>
                <th scope="col">Tarefa</th>
                <th scope="col">Resultado</th>
                <th scope="col">Mensagem</th>
              </tr>
            </thead>
            <tbody>
              {dados.execucoes.map((e) => (
                <tr
                  key={e.id}
                  onClick={() => setAberta(e.id)}
                  tabIndex={0}
                  role="button"
                  aria-label={`Ver o log de ${e.tarefa} em ${formatarQuando(e.iniciadaEm)}`}
                  onKeyDown={(ev) => {
                    if (ev.key === 'Enter' || ev.key === ' ') {
                      ev.preventDefault();
                      setAberta(e.id);
                    }
                  }}
                >
                  <td title={e.disparo === 'agenda' ? 'pela agenda' : `manual${e.usuario ? `, ${e.usuario}` : ''}`}>
                    {formatarQuando(e.iniciadaEm)}
                  </td>
                  <td title={e.arquivo}>
                    {e.tarefa}
                    {e.seguradora && <span className="texto-discreto"> · {e.seguradora}</span>}
                  </td>
                  <td>
                    <span className={`etiqueta ${ROTULO_SITUACAO[e.situacao].classe}`}>
                      {ROTULO_SITUACAO[e.situacao].texto}
                    </span>
                  </td>
                  <td className="tarefas__mensagem" title={e.mensagem ?? undefined}>
                    {e.mensagem ?? '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {dados && dados.total > POR_PAGINA && (
        <nav className="paginacao" aria-label="Páginas">
          <span className="texto-discreto">{dados.total} execuções</span>
          <div className="paginacao__botoes">
            <button
              type="button"
              className="botao botao--discreto botao--compacto"
              onClick={() => setPagina((p) => p - 1)}
              disabled={pagina <= 1}
            >
              ‹ Anterior
            </button>
            <span className="texto-discreto">
              Página {pagina} de {paginas}
            </span>
            <button
              type="button"
              className="botao botao--discreto botao--compacto"
              onClick={() => setPagina((p) => p + 1)}
              disabled={pagina >= paginas}
            >
              Próxima ›
            </button>
          </div>
        </nav>
      )}

      {aberta !== null && <LogExecucao execucaoId={aberta} aoFechar={() => setAberta(null)} />}
    </div>
  );
}
