import { useCallback, useEffect, useState } from 'react';

import { Paginacao, usePaginacao } from '@/components/Paginacao';
import { ExecucoesTarefas } from '@/components/configuracoes/tarefas/ExecucoesTarefas';
import { LogExecucao } from '@/components/configuracoes/tarefas/LogExecucao';
import { ApiError } from '@/lib/api';
import { seguradorasApi, type Seguradora } from '@/lib/seguradoras';
import {
  DIAS,
  ROTULO_SITUACAO,
  descreverDias,
  formatarQuando,
  tarefasApi,
  type ArquivoIntegracao,
  type Execucao,
  type Tarefa,
} from '@/lib/tarefas';

/** Sem acento e sem caixa, para a busca. */
const comparavel = (s: string): string =>
  s
    .normalize('NFD')
    .replace(/[\u{300}-\u{36f}]/gu, '')
    .toLowerCase();

const mensagemDe = (falha: unknown, alternativa: string): string =>
  falha instanceof ApiError
    ? [falha.message, ...falha.mensagensDeValidacao].filter(Boolean).join(' ')
    : alternativa;

/** Tarefas agendadas: a tarefa é cadastro; o que ela executa é uma rotina do backend. */
export function PainelTarefas(): React.JSX.Element {
  const [tarefas, setTarefas] = useState<Tarefa[]>([]);
  const [arquivos, setArquivos] = useState<ArquivoIntegracao[]>([]);
  const [aba, setAba] = useState<'tarefas' | 'execucoes'>('tarefas');
  const [seguradoras, setSeguradoras] = useState<Seguradora[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [busca, setBusca] = useState('');
  const [aberta, setAberta] = useState<Tarefa | 'nova' | null>(null);

  const carregar = useCallback(async (): Promise<void> => {
    setErro(null);
    try {
      const [t, s] = await Promise.all([tarefasApi.listar(), seguradorasApi.listar()]);
      setTarefas(t.tarefas);
      setArquivos(Array.isArray(t.arquivos) ? t.arquivos : []);
      setSeguradoras(s.seguradoras);
    } catch (falha) {
      setErro(
        falha instanceof ApiError && falha.status === 404
          ? 'Tarefas precisam do servidor atualizado: reinicie o backend.'
          : mensagemDe(falha, 'Não foi possível carregar as tarefas.'),
      );
    } finally {
      setCarregando(false);
    }
  }, []);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  const termo = comparavel(busca.trim());
  const filtradas = termo
    ? tarefas.filter((t) => comparavel(`${t.nome} ${t.seguradora ?? ''} ${t.arquivoNome} ${t.arquivo}`).includes(termo))
    : tarefas;
  const pagina = usePaginacao(filtradas, [busca], 5);

  if (aberta !== null) {
    return (
      <FichaTarefa
        tarefa={aberta === 'nova' ? null : aberta}
        arquivos={arquivos}
        seguradoras={seguradoras}
        aoVoltar={() => {
          setAberta(null);
          void carregar();
        }}
        aoSalvar={(t) => {
          setTarefas((antes) => (antes.some((x) => x.id === t.id) ? antes.map((x) => (x.id === t.id ? t : x)) : [...antes, t]));
          setAberta(t);
        }}
        aoExcluir={(id) => {
          setTarefas((antes) => antes.filter((x) => x.id !== id));
          setAberta(null);
        }}
      />
    );
  }

  if (carregando) return <p className="texto-discreto">Carregando tarefas…</p>;

  return (
    <div className="tarefas">
      <nav className="abas" aria-label="Tarefas">
        {(
          [
            ['tarefas', 'Tarefas'],
            ['execucoes', 'Execuções e logs'],
          ] as const
        ).map(([chave, rotulo]) => (
          <button
            key={chave}
            type="button"
            className={aba === chave ? 'abas__item abas__item--ativa' : 'abas__item'}
            onClick={() => setAba(chave)}
            aria-current={aba === chave ? 'true' : undefined}
          >
            {rotulo}
          </button>
        ))}
      </nav>

      {aba === 'execucoes' ? (
        <ExecucoesTarefas tarefas={tarefas} />
      ) : (
        <div className="usuarios">
          <div className="tipos-seguro__barra">
            <input
              type="search"
              className="tipos-seguro__busca"
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder="Pesquisar tarefa…"
              aria-label="Pesquisar tarefa"
            />
            <button
              type="button"
              className="botao botao--principal botao--compacto"
              onClick={() => setAberta('nova')}
              disabled={arquivos.length === 0}
              title={arquivos.length === 0 ? 'Nenhum arquivo de integração no backend ainda' : undefined}
            >
              Nova tarefa
            </button>
          </div>

          {erro && (
            <p className="alerta alerta--erro" role="alert">
              {erro}
            </p>
          )}

          {tarefas.length === 0 && !erro ? (
            <p className="texto-discreto">Nenhuma tarefa cadastrada.</p>
          ) : filtradas.length === 0 ? (
            <p className="texto-discreto">Nenhuma tarefa com “{busca.trim()}”.</p>
          ) : (
            <div className="tabela-rolante">
              <table className="tabela tabela--densa tabela--clicavel">
                <thead>
                  <tr>
                    <th scope="col">Tarefa</th>
                    <th scope="col">Quando</th>
                    <th scope="col">Próxima</th>
                    <th scope="col">Última</th>
                  </tr>
                </thead>
                <tbody>
                  {pagina.visiveis.map((t) => (
                    <tr
                      key={t.id}
                      className={t.ativa ? undefined : 'tabela__linha--inativa'}
                      onClick={() => setAberta(t)}
                      tabIndex={0}
                      role="button"
                      aria-label={`Abrir a tarefa ${t.nome}`}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          setAberta(t);
                        }
                      }}
                    >
                      <td title={`${t.arquivoNome} — ${t.arquivo}`}>
                        <strong>{t.nome}</strong>
                        {t.seguradora && <span className="texto-discreto"> · {t.seguradora}</span>}
                      </td>
                      <td>
                        {descreverDias(t.diasSemana)}, {t.horario}
                      </td>
                      <td>{t.ativa ? formatarQuando(t.proximaExecucao) : 'inativa'}</td>
                      <td title={t.ultimaExecucao?.mensagem ?? undefined}>
                        {t.executando ? (
                          <span className="etiqueta etiqueta--atencao">Executando</span>
                        ) : t.ultimaExecucao ? (
                          <span className={`etiqueta ${ROTULO_SITUACAO[t.ultimaExecucao.situacao].classe}`}>
                            {ROTULO_SITUACAO[t.ultimaExecucao.situacao].texto}
                          </span>
                        ) : (
                          <span className="texto-discreto">nunca</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <Paginacao p={pagina} />
        </div>
      )}
    </div>
  );
}

function FichaTarefa({
  tarefa,
  arquivos,
  seguradoras,
  aoVoltar,
  aoSalvar,
  aoExcluir,
}: {
  tarefa: Tarefa | null;
  arquivos: ArquivoIntegracao[];
  seguradoras: Seguradora[];
  aoVoltar: () => void;
  aoSalvar: (t: Tarefa) => void;
  aoExcluir: (id: string) => void;
}): React.JSX.Element {
  const nova = tarefa === null;
  const [form, setForm] = useState({
    nome: tarefa?.nome ?? '',
    descricao: tarefa?.descricao ?? '',
    arquivo: tarefa?.arquivo ?? '',
    seguradoraId: tarefa?.seguradoraId ?? null,
    diasSemana: tarefa?.diasSemana ?? 62,
    horario: tarefa?.horario ?? '07:00',
  });
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [execucoes, setExecucoes] = useState<Execucao[] | null>(null);

  const [logAberto, setLogAberto] = useState<number | null>(null);

  // Os da pasta da seguradora e os genéricos; o servidor confere de novo ao salvar.
  const chaveSeguradora = seguradoras.find((s) => s.id === form.seguradoraId)?.chave ?? null;
  const arquivosDaSeguradora = form.seguradoraId
    ? arquivos.filter((a) => a.seguradoraChave === null || a.seguradoraChave === chaveSeguradora)
    : [];
  const arquivoEscolhido = arquivosDaSeguradora.find((a) => a.arquivo === form.arquivo);

  const carregarHistorico = useCallback(async (): Promise<void> => {
    if (!tarefa) return;
    try {
      setExecucoes((await tarefasApi.execucoes(tarefa.id)).execucoes);
    } catch {
      setExecucoes([]);
    }
  }, [tarefa]);

  useEffect(() => {
    void carregarHistorico();
  }, [carregarHistorico]);

  // Enquanto houver execução em andamento, o histórico se atualiza sozinho.
  const emAndamento = execucoes?.some((e) => e.situacao === 'executando') ?? false;
  useEffect(() => {
    if (!emAndamento) return;
    const t = setInterval(() => void carregarHistorico(), 3000);
    return () => clearInterval(t);
  }, [emAndamento, carregarHistorico]);

  const alternarDia = (i: number): void => setForm((f) => ({ ...f, diasSemana: f.diasSemana ^ (1 << i) }));

  async function salvar(evento: React.FormEvent): Promise<void> {
    evento.preventDefault();
    setOcupado(true);
    setErro(null);
    setAviso(null);
    try {
      const { tarefa: salva } = tarefa
        ? await tarefasApi.atualizar(tarefa.id, form)
        : await tarefasApi.criar(form);
      setAviso('Tarefa salva.');
      aoSalvar(salva);
    } catch (falha) {
      setErro(mensagemDe(falha, 'Não foi possível salvar a tarefa.'));
    } finally {
      setOcupado(false);
    }
  }

  async function acao(fazer: () => Promise<void>, falhaPadrao: string): Promise<void> {
    setOcupado(true);
    setErro(null);
    setAviso(null);
    try {
      await fazer();
    } catch (falha) {
      setErro(mensagemDe(falha, falhaPadrao));
    } finally {
      setOcupado(false);
    }
  }

  return (
    <div className="ficha">
      <button type="button" className="botao botao--discreto botao--compacto tipos-seguro__voltar" onClick={aoVoltar}>
        ← Tarefas
      </button>

      <h3 className="formulario__titulo">{nova ? 'Nova tarefa' : tarefa.nome}</h3>

      {erro && (
        <p className="alerta alerta--erro" role="alert">
          {erro}
        </p>
      )}
      {aviso && (
        <p className="alerta alerta--sucesso" role="status">
          {aviso}
        </p>
      )}

      <form className="formulario" onSubmit={(e) => void salvar(e)}>
        <div className="formulario__linha">
          <label className="campo-form">
            <span>Nome</span>
            <input
              type="text"
              value={form.nome}
              onChange={(e) => setForm({ ...form, nome: e.target.value })}
              maxLength={100}
              required
              placeholder="Ex.: Porto — apólices emitidas"
            />
          </label>
          <label className="campo-form">
            <span>Seguradora</span>
            <select
              value={form.seguradoraId ?? ''}
              onChange={(e) => {
                const id = e.target.value ? Number(e.target.value) : null;
                const chave = seguradoras.find((s) => s.id === id)?.chave ?? null;
                // O arquivo escolhido pode ser de outra seguradora: troca-se junto.
                const serve = arquivos.some(
                  (a) => a.arquivo === form.arquivo && (a.seguradoraChave === null || a.seguradoraChave === chave),
                );
                setForm({ ...form, seguradoraId: id, arquivo: serve ? form.arquivo : '' });
              }}
              required
            >
              <option value="">Escolha…</option>
              {seguradoras.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.nome}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="formulario__linha">
          <label className="campo-form">
            <span>Arquivo de integração</span>
            <select
              value={form.arquivo}
              onChange={(e) => setForm({ ...form, arquivo: e.target.value })}
              title={arquivoEscolhido ? `${arquivoEscolhido.descricao} (${arquivoEscolhido.arquivo})` : undefined}
              required
              disabled={!form.seguradoraId}
            >
              <option value="">{form.seguradoraId ? 'Escolha…' : 'Escolha a seguradora antes'}</option>
              {arquivosDaSeguradora.map((a) => (
                <option key={a.arquivo} value={a.arquivo}>
                  {a.nome} — {a.arquivo}
                </option>
              ))}
            </select>
            {form.seguradoraId && arquivosDaSeguradora.every((a) => a.seguradoraChave === null) && (
              <small className="texto-discreto">
                Nenhum arquivo próprio desta seguradora ainda (pasta {chaveSeguradora ?? 'sem chave'}).
              </small>
            )}
          </label>
          <label className="campo-form">
            <span>Horário (Brasília)</span>
            <input
              type="time"
              value={form.horario}
              onChange={(e) => setForm({ ...form, horario: e.target.value })}
              required
            />
          </label>
        </div>

        <fieldset className="tarefas__dias">
          <legend>Dias</legend>
          {DIAS.map((dia, i) => (
            <label key={dia} className={`tarefas__dia${form.diasSemana & (1 << i) ? ' tarefas__dia--marcado' : ''}`}>
              <input type="checkbox" checked={Boolean(form.diasSemana & (1 << i))} onChange={() => alternarDia(i)} />
              {dia}
            </label>
          ))}
        </fieldset>

        <label className="campo-form campo-form--largo">
          <span>
            Descrição <em>opcional</em>
          </span>
          <input
            type="text"
            value={form.descricao}
            onChange={(e) => setForm({ ...form, descricao: e.target.value })}
            maxLength={255}
          />
        </label>

        <div className="papeis__acoes">
          <div className="papeis__acoes-grupo">
            {!nova && (
              <>
                <button
                  type="button"
                  className="botao botao--discreto botao--compacto"
                  disabled={ocupado || tarefa.executando || emAndamento}
                  onClick={() =>
                    void acao(async () => {
                      setAviso((await tarefasApi.executarAgora(tarefa.id)).mensagem);
                      // Dá um instante para a execução aparecer no histórico.
                      setTimeout(() => void carregarHistorico(), 800);
                    }, 'Não foi possível executar.')
                  }
                >
                  Executar agora
                </button>
                <button
                  type="button"
                  className="botao botao--discreto botao--compacto"
                  disabled={ocupado}
                  onClick={() =>
                    void acao(async () => {
                      aoSalvar((await tarefasApi.definirSituacao(tarefa.id, !tarefa.ativa)).tarefa);
                    }, 'Não foi possível mudar a situação.')
                  }
                >
                  {tarefa.ativa ? 'Inativar' : 'Ativar'}
                </button>
                <button
                  type="button"
                  className="botao botao--perigo botao--compacto"
                  disabled={ocupado}
                  onClick={() => {
                    if (!window.confirm(`Excluir a tarefa "${tarefa.nome}" e o histórico dela?`)) return;
                    void acao(async () => {
                      await tarefasApi.excluir(tarefa.id);
                      aoExcluir(tarefa.id);
                    }, 'Não foi possível excluir.');
                  }}
                >
                  Excluir
                </button>
              </>
            )}
          </div>
          <div className="papeis__acoes-grupo">
            {!nova && (
              <span className="texto-discreto">
                {tarefa.ativa ? `Próxima: ${formatarQuando(tarefa.proximaExecucao)}` : 'Inativa'}
              </span>
            )}
            <button
              type="submit"
              className="botao botao--principal botao--compacto"
              disabled={ocupado || form.nome.trim().length < 2 || form.diasSemana === 0 || !form.seguradoraId || !form.arquivo}
            >
              {nova ? 'Criar tarefa' : 'Salvar'}
            </button>
          </div>
        </div>
      </form>

      {!nova && (
        <section className="tarefas__historico">
          <h4>Histórico <small className="texto-discreto">— clique numa linha para ver o log</small></h4>
          {execucoes === null ? (
            <p className="texto-discreto">Carregando…</p>
          ) : execucoes.length === 0 ? (
            <p className="texto-discreto">Ainda não executou.</p>
          ) : (
            <div className="tabela-rolante">
              <table className="tabela tabela--densa tabela--clicavel">
                <thead>
                  <tr>
                    <th scope="col">Quando</th>
                    <th scope="col">Como</th>
                    <th scope="col">Resultado</th>
                    <th scope="col">Mensagem</th>
                  </tr>
                </thead>
                <tbody>
                  {execucoes.slice(0, 5).map((e) => (
                    <tr
                      key={e.id}
                      onClick={() => setLogAberto(e.id)}
                      tabIndex={0}
                      role="button"
                      aria-label={`Ver o log de ${formatarQuando(e.iniciadaEm)}`}
                      onKeyDown={(ev) => {
                        if (ev.key === 'Enter' || ev.key === ' ') {
                          ev.preventDefault();
                          setLogAberto(e.id);
                        }
                      }}
                    >
                      <td>{formatarQuando(e.iniciadaEm)}</td>
                      <td>{e.disparo === 'agenda' ? 'agenda' : `manual${e.usuario ? ` · ${e.usuario}` : ''}`}</td>
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
        </section>
      )}

      {logAberto !== null && <LogExecucao execucaoId={logAberto} aoFechar={() => setLogAberto(null)} />}
    </div>
  );
}
