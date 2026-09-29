import { useEffect, useMemo, useState } from 'react';

import { useAuth } from '@/hooks/useAuth';
import { ApiError } from '@/lib/api';
import {
  atendimentosApi,
  CANAIS,
  MOTIVOS,
  RESULTADOS,
  type ApoliceAtiva,
  type Atendimento,
  type CanalAtendimento,
  type MotivoAtendimento,
  type ResultadoAtendimento,
} from '@/lib/atendimentos';
import type { ClienteCompleto } from '@/lib/clientes';
import { formatarData } from '@/lib/formato';

/** Aba "Atendimentos" da ficha: o histórico de contatos com o cliente. */

const DIAS = 86_400_000;

function hojeIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function agoraLocal(): string {
  const d = new Date();
  const p = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

const diasAte = (iso: string): number =>
  Math.round((Date.parse(`${iso.slice(0, 10)}T12:00:00`) - Date.parse(`${hojeIso()}T12:00:00`)) / DIAS);

/** O motivo provável, com a razão — sugestão, nunca imposição. */
function motivoSugerido(cliente: ClienteCompleto): { motivo: MotivoAtendimento; porque: string } | null {
  if (cliente.situacaoChave === 'inadimplente') {
    return { motivo: 'inadimplencia', porque: 'cliente inadimplente' };
  }
  const vencendo = cliente.apolices
    .filter((a) => a.vigenciaFim && (a.situacao === 'vigente' || a.situacao === 'a_vencer'))
    .map((a) => ({ a, dias: diasAte(a.vigenciaFim!) }))
    .filter((x) => x.dias >= 0 && x.dias <= 60)
    .sort((x, y) => x.dias - y.dias)[0];
  if (vencendo) {
    return {
      motivo: 'renovacao',
      porque: `apólice ${vencendo.a.numero} vence em ${vencendo.dias} dia(s)`,
    };
  }
  const inicios = [
    cliente.clienteDesde,
    ...cliente.apolices.map((a) => a.vigenciaInicio).filter((x): x is string => Boolean(x)),
  ].filter((x): x is string => Boolean(x));
  const primeiro = inicios.sort()[0];
  if (primeiro && -diasAte(primeiro) <= 90) {
    return { motivo: 'novo_cliente', porque: `cliente desde ${formatarData(primeiro)}` };
  }
  return null;
}

function linkDoCanal(
  canal: CanalAtendimento,
  cliente: ClienteCompleto,
): { href: string; rotulo: string } | null {
  const telefone = cliente.telefones[0]?.numero ?? cliente.celular;
  const email = cliente.emails[0]?.endereco ?? cliente.email;
  const digitos = (telefone ?? '').replace(/\D/g, '');
  if (canal === 'whatsapp' && digitos.length >= 10) {
    return { href: `https://wa.me/55${digitos}`, rotulo: `Abrir WhatsApp · ${telefone}` };
  }
  if (canal === 'ligacao' && digitos.length >= 10)
    return { href: `tel:${digitos}`, rotulo: `Ligar · ${telefone}` };
  if (canal === 'email' && email)
    return { href: `mailto:${email.toLowerCase()}`, rotulo: `Escrever · ${email}` };
  return null;
}

export function Atendimentos({ cliente }: { cliente: ClienteCompleto }): React.JSX.Element {
  const { usuario } = useAuth();
  const sugestao = useMemo(() => motivoSugerido(cliente), [cliente]);

  const [lista, setLista] = useState<Atendimento[] | null>(null);
  const [ativas, setAtivas] = useState<ApoliceAtiva[]>([]);
  const [erro, setErro] = useState<string | null>(null);
  const [filtro, setFiltro] = useState<'' | MotivoAtendimento>('');

  const [canal, setCanal] = useState<CanalAtendimento>('whatsapp');
  const [motivo, setMotivo] = useState<MotivoAtendimento>(sugestao?.motivo ?? 'outro');
  const [resultado, setResultado] = useState<ResultadoAtendimento>('contato_feito');
  const [contatoEm, setContatoEm] = useState(agoraLocal());
  const [proximo, setProximo] = useState('');
  const [apolice, setApolice] = useState('');
  const [descricao, setDescricao] = useState('');
  const [salvando, setSalvando] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);

  useEffect(() => {
    let cancelado = false;
    atendimentosApi
      .listar(cliente.id)
      .then((r) => {
        if (cancelado) return;
        setLista(r.atendimentos);
        setAtivas(Array.isArray(r.apolicesAtivas) ? r.apolicesAtivas : []);
      })
      .catch((falha: unknown) => {
        if (cancelado) return;
        setLista([]);
        setErro(
          falha instanceof ApiError && falha.status === 404
            ? 'O histórico precisa do servidor atualizado: reinicie o backend.'
            : falha instanceof ApiError
              ? falha.message
              : 'Não foi possível carregar o histórico.',
        );
      });
    return () => {
      cancelado = true;
    };
  }, [cliente.id]);

  // Carta e e-mail raramente têm resposta na hora: o resultado natural é "enviado".
  const trocarCanal = (novo: CanalAtendimento): void => {
    setCanal(novo);
    if (novo === 'carta' || novo === 'email') setResultado('enviado');
    else if (resultado === 'enviado') setResultado('contato_feito');
  };

  const registrar = async (): Promise<void> => {
    setSalvando(true);
    setAviso(null);
    try {
      const r = await atendimentosApi.registrar(cliente.id, {
        canal,
        motivo,
        resultado,
        contatoEm,
        ...(descricao.trim() ? { descricao: descricao.trim() } : {}),
        ...(proximo ? { proximoContato: proximo } : {}),
        ...(apolice ? { apolice } : {}),
      });
      setLista(r.atendimentos);
      setAtivas(Array.isArray(r.apolicesAtivas) ? r.apolicesAtivas : []);
      setApolice('');
      setDescricao('');
      setProximo('');
      setContatoEm(agoraLocal());
      setAviso(r.mensagem);
    } catch (falha) {
      setAviso(falha instanceof ApiError ? falha.message : 'Não foi possível registrar.');
    } finally {
      setSalvando(false);
    }
  };

  const excluir = async (id: string): Promise<void> => {
    try {
      const r = await atendimentosApi.excluir(cliente.id, id);
      setLista(r.atendimentos);
    } catch (falha) {
      setAviso(falha instanceof ApiError ? falha.message : 'Não foi possível apagar.');
    }
  };

  const itens = lista ?? [];
  const visiveis = itens.filter((a) => !filtro || a.motivo === filtro);
  const ultimo = itens[0];
  // O combinado mais próximo que ainda não foi cumprido por um contato posterior.
  const combinado = itens
    .filter((a) => a.proximoContato && !itens.some((b) => b.contatoEm.slice(0, 10) >= a.proximoContato!))
    .map((a) => a.proximoContato!)
    .sort()[0];
  const link = linkDoCanal(canal, cliente);

  return (
    <div className="atendimentos">
      <div className="atendimentos__resumo">
        <div>
          <span className="atendimentos__rotulo">Último contato</span>
          {ultimo ? (
            <strong>
              {formatarData(ultimo.contatoEm)} · {CANAIS.find((c) => c.chave === ultimo.canal)?.rotulo} ·{' '}
              {RESULTADOS[ultimo.resultado].toLowerCase()}
            </strong>
          ) : (
            <strong className="texto-discreto">nenhum registrado</strong>
          )}
        </div>
        <div>
          <span className="atendimentos__rotulo">Próximo contato combinado</span>
          {combinado ? (
            <strong className={diasAte(combinado) < 0 ? 'situacao--inadimplente' : undefined}>
              {formatarData(combinado)}
              {diasAte(combinado) < 0
                ? ` · atrasado ${-diasAte(combinado)} dia(s)`
                : diasAte(combinado) === 0
                  ? ' · hoje'
                  : ` · em ${diasAte(combinado)} dia(s)`}
            </strong>
          ) : (
            <strong className="texto-discreto">nada agendado</strong>
          )}
        </div>
        {sugestao && (
          <div>
            <span className="atendimentos__rotulo">Atenção</span>
            <strong>
              {MOTIVOS[sugestao.motivo]} — {sugestao.porque}
            </strong>
          </div>
        )}
      </div>

      <section className="atendimentos__novo" aria-label="Registrar atendimento">
        <div className="atendimentos__canais" role="radiogroup" aria-label="Canal">
          {CANAIS.map((c) => (
            <button
              key={c.chave}
              type="button"
              role="radio"
              aria-checked={canal === c.chave}
              className={
                canal === c.chave ? 'atendimentos__canal atendimentos__canal--ativo' : 'atendimentos__canal'
              }
              onClick={() => trocarCanal(c.chave)}
            >
              <span aria-hidden="true">{c.icone}</span> {c.rotulo}
            </button>
          ))}
          {link && (
            <a className="atendimentos__abrir" href={link.href} target="_blank" rel="noreferrer">
              {link.rotulo} ↗
            </a>
          )}
        </div>

        <div className="atendimentos__campos">
          <label className="campo-form">
            <span>Motivo{sugestao && sugestao.motivo === motivo && <em>sugerido</em>}</span>
            <select value={motivo} onChange={(e) => setMotivo(e.target.value as MotivoAtendimento)}>
              {Object.entries(MOTIVOS).map(([chave, rotulo]) => (
                <option key={chave} value={chave}>
                  {rotulo}
                </option>
              ))}
            </select>
          </label>
          <label className="campo-form">
            <span>Resultado</span>
            <select value={resultado} onChange={(e) => setResultado(e.target.value as ResultadoAtendimento)}>
              {Object.entries(RESULTADOS).map(([chave, rotulo]) => (
                <option key={chave} value={chave}>
                  {rotulo}
                </option>
              ))}
            </select>
          </label>
          <label className="campo-form">
            <span>Quando</span>
            <input
              type="datetime-local"
              value={contatoEm}
              max={agoraLocal()}
              onChange={(e) => setContatoEm(e.target.value)}
            />
          </label>
          <label className="campo-form">
            <span>Próximo contato</span>
            <input type="date" value={proximo} min={hojeIso()} onChange={(e) => setProximo(e.target.value)} />
          </label>
        </div>

        {/* As ativas vêm do servidor (`condicaoEmVigor`): as datas da ficha dariam
            por ativa uma apólice cancelada com vigência em curso. */}
        {ativas.length === 1 && (
          <p className="atendimentos__destino">
            Vai para a <strong>{ativas[0]!.seguradora}</strong> · apólice {ativas[0]!.numero}
            {ativas[0]!.vigenciaFim && `, vigente até ${formatarData(ativas[0]!.vigenciaFim)}`}
          </p>
        )}
        {ativas.length > 1 && (
          <label className="campo-form atendimentos__destino-escolha">
            <span>
              Seguradora / apólice ativa <em>obrigatório</em>
            </span>
            <select value={apolice} onChange={(e) => setApolice(e.target.value)} required>
              <option value="">Selecione para qual seguradora vai este atendimento…</option>
              {ativas.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.seguradora} · apólice {a.numero}
                  {a.vigenciaFim ? ` · até ${formatarData(a.vigenciaFim)}` : ''}
                </option>
              ))}
            </select>
          </label>
        )}
        {ativas.length === 0 && lista !== null && (
          <p className="texto-discreto atendimentos__destino">
            Cliente sem apólice ativa: o atendimento fica sem seguradora.
          </p>
        )}

        <label className="campo-form">
          <span>O que foi conversado</span>
          <textarea
            rows={2}
            maxLength={2000}
            value={descricao}
            placeholder="Ex.: prometeu pagar a parcela até sexta; falar com a esposa à tarde."
            onChange={(e) => setDescricao(e.target.value)}
          />
        </label>

        <div className="atendimentos__acoes">
          {aviso && <span className="texto-discreto">{aviso}</span>}
          <button
            type="button"
            className="botao botao--principal botao--compacto"
            onClick={() => void registrar()}
            disabled={salvando || !contatoEm || (ativas.length > 1 && !apolice)}
          >
            {salvando ? 'Registrando…' : 'Registrar atendimento'}
          </button>
        </div>
      </section>

      {erro && (
        <p className="alerta alerta--erro" role="alert">
          {erro}
        </p>
      )}

      <div className="atendimentos__filtro" role="tablist" aria-label="Filtrar por motivo">
        {(['', 'inadimplencia', 'novo_cliente', 'renovacao', 'outro'] as const).map((m) => {
          const n = m ? itens.filter((a) => a.motivo === m).length : itens.length;
          if (m && n === 0) return null;
          return (
            <button
              key={m || 'todos'}
              type="button"
              className={filtro === m ? 'atendimentos__chip atendimentos__chip--ativo' : 'atendimentos__chip'}
              onClick={() => setFiltro(m)}
            >
              {m ? MOTIVOS[m].split(' (')[0] : 'Todos'} ({n})
            </button>
          );
        })}
      </div>

      {lista === null ? (
        <p className="texto-discreto">Carregando…</p>
      ) : visiveis.length === 0 ? (
        <p className="texto-discreto">
          {itens.length === 0
            ? 'Nenhum atendimento registrado para este cliente.'
            : 'Nenhum atendimento com este motivo.'}
        </p>
      ) : (
        <ol className="atendimentos__linha-do-tempo">
          {visiveis.map((a) => {
            const c = CANAIS.find((x) => x.chave === a.canal);
            return (
              <li key={a.id} className="atendimentos__item">
                <span className="atendimentos__icone" aria-hidden="true">
                  {c?.icone}
                </span>
                <div className="atendimentos__conteudo">
                  <div className="atendimentos__cabeca">
                    <strong>{c?.rotulo}</strong>
                    <span
                      className={`etiqueta ${a.motivo === 'inadimplencia' ? 'etiqueta--critico' : a.motivo === 'renovacao' ? 'etiqueta--atencao' : 'etiqueta--ok'}`}
                    >
                      {MOTIVOS[a.motivo].split(' (')[0]}
                    </span>
                    <span className="texto-discreto">{RESULTADOS[a.resultado]}</span>
                  </div>
                  {a.descricao && <p className="atendimentos__descricao">{a.descricao}</p>}
                  <small className="texto-discreto">
                    {formatarData(a.contatoEm)} {a.contatoEm.slice(11, 16)} · {a.registradoPor.nome}
                    {a.seguradora && ` · ${a.seguradora}`}
                    {a.apolice && ` · apólice ${a.apolice.numero}`}
                    {a.proximoContato && ` · próximo contato ${formatarData(a.proximoContato)}`}
                  </small>
                </div>
                {usuario?.id === a.registradoPor.id && (
                  <button
                    type="button"
                    className="botao botao--discreto botao--compacto"
                    onClick={() => void excluir(a.id)}
                    title="Apagar este registro (só quem registrou pode)"
                  >
                    Apagar
                  </button>
                )}
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
