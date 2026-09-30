import { useEffect, useRef, useState } from 'react';

import { Modal } from '@/components/Modal';
import { ApiError } from '@/lib/api';
import { ROTULO_SITUACAO, formatarQuando, tarefasApi, type ExecucaoGeral, type LinhaLog } from '@/lib/tarefas';

/** Só a hora ("07:00:12") nas linhas: a data está no cabeçalho. */
const hora = (iso: string): string =>
  new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

/** Log de uma execução; em andamento, pede só as linhas novas (`?depois=`) até terminar. */
export function LogExecucao({ execucaoId, aoFechar }: { execucaoId: number; aoFechar: () => void }): React.JSX.Element {
  const [execucao, setExecucao] = useState<ExecucaoGeral | null>(null);
  const [linhas, setLinhas] = useState<LinhaLog[]>([]);
  const [erro, setErro] = useState<string | null>(null);
  const ultimaId = useRef(0);
  const fim = useRef<HTMLLIElement | null>(null);

  useEffect(() => {
    let vivo = true;
    let espera: ReturnType<typeof setTimeout> | null = null;

    const buscar = async (): Promise<void> => {
      try {
        const r = await tarefasApi.log(execucaoId, ultimaId.current);
        if (!vivo) return;
        setExecucao(r.execucao);
        if (r.linhas.length > 0) {
          ultimaId.current = r.linhas[r.linhas.length - 1]!.id;
          setLinhas((antes) => [...antes, ...r.linhas]);
        }
        if (r.execucao.situacao === 'executando') espera = setTimeout(() => void buscar(), 2000);
      } catch (falha) {
        if (vivo) setErro(falha instanceof ApiError ? falha.message : 'Não foi possível carregar o log.');
      }
    };
    void buscar();

    return () => {
      vivo = false;
      if (espera) clearTimeout(espera);
    };
  }, [execucaoId]);

  // Linha nova ao vivo: rola até ela.
  useEffect(() => {
    if (execucao?.situacao === 'executando') fim.current?.scrollIntoView({ block: 'nearest' });
  }, [linhas.length, execucao?.situacao]);

  return (
    <Modal
      aberto
      aoFechar={aoFechar}
      titulo={execucao ? `Log — ${execucao.tarefa}` : 'Log da execução'}
      descricao={execucao ? `${execucao.seguradora ?? ''} · ${execucao.arquivo}` : undefined}
      tamanho="largo"
    >
      <div className="modal__conteudo">
        {erro && (
          <p className="alerta alerta--erro" role="alert">
            {erro}
          </p>
        )}

        {execucao && (
          <div className="log-execucao__resumo">
            <span className={`etiqueta ${ROTULO_SITUACAO[execucao.situacao].classe}`}>
              {ROTULO_SITUACAO[execucao.situacao].texto}
            </span>
            <span className="texto-discreto">
              {formatarQuando(execucao.iniciadaEm)}
              {execucao.finalizadaEm ? ` → ${hora(execucao.finalizadaEm)}` : ' · em andamento'}
              {' · '}
              {execucao.disparo === 'agenda' ? 'pela agenda' : `manual${execucao.usuario ? `, ${execucao.usuario}` : ''}`}
            </span>
          </div>
        )}

        {execucao?.mensagem && <p className="log-execucao__mensagem">{execucao.mensagem}</p>}

        {!execucao && !erro && <p className="texto-discreto">Carregando…</p>}

        {execucao && linhas.length === 0 && (
          <p className="texto-discreto">Sem linhas de log nesta execução.</p>
        )}

        {linhas.length > 0 && (
          <ol className="log-execucao__linhas">
            {linhas.map((l) => (
              <li key={l.id} className={`log-execucao__linha log-execucao__linha--${l.nivel}`}>
                <time>{hora(l.em)}</time>
                <span>{l.mensagem}</span>
              </li>
            ))}
            <li ref={fim} aria-hidden="true" />
          </ol>
        )}
      </div>
    </Modal>
  );
}
