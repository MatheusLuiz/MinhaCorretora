import { useCallback, useEffect, useState } from 'react';

import { useAuth } from '@/hooks/useAuth';
import {
  emailDisparoApi,
  mensagemDeErro,
  quando,
  type Caixa,
  type DadosCaixa,
  type Seguranca,
} from '@/lib/emailDisparo';

// Caixas de saída. A PADRÃO envia todo e-mail sem caixa própria; sem nenhuma ativa, vale o SMTP do .env.

const VAZIA: DadosCaixa = {
  nome: '',
  host: '',
  porta: 587,
  seguranca: 'starttls',
  usuario: '',
  senha: '',
  remetenteNome: 'MinhaCorretora',
  remetenteEmail: '',
  responderPara: '',
  ativo: false,
  padrao: false,
};

/** Google Workspace: só servidor, porta e segurança. */
const GOOGLE: Pick<DadosCaixa, 'host' | 'porta' | 'seguranca'> = {
  host: 'smtp.gmail.com',
  porta: 587,
  seguranca: 'starttls',
};

export function CaixasEmail(): React.JSX.Element {
  const [caixas, setCaixas] = useState<Caixa[] | null>(null);
  const [envAlternativo, setEnvAlternativo] = useState<{ host: string } | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [aberta, setAberta] = useState<Caixa | 'nova' | null>(null);

  const carregar = useCallback(async (): Promise<void> => {
    setErro(null);
    try {
      const r = await emailDisparoApi.caixas();
      setCaixas(r.caixas);
      setEnvAlternativo(r.envAlternativo);
    } catch (falha) {
      setErro(mensagemDeErro(falha, 'Não foi possível carregar as caixas.'));
    }
  }, []);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  if (aberta) {
    return (
      <FichaCaixa
        caixa={aberta === 'nova' ? null : aberta}
        primeira={(caixas ?? []).length === 0}
        aoVoltar={() => {
          setAberta(null);
          void carregar();
        }}
      />
    );
  }

  if (erro) {
    return (
      <p className="alerta alerta--erro" role="alert">
        {erro}
      </p>
    );
  }
  if (!caixas) return <p className="texto-discreto">Carregando…</p>;

  const padrao = caixas.find((c) => c.padrao && c.ativo);

  return (
    <div className="usuarios">
      <div className="usuarios__barra">
        <p className="texto-discreto email__situacao">
          {padrao
            ? `O sistema envia pela caixa "${padrao.nome}" (${padrao.remetenteEmail}).`
            : envAlternativo
              ? `Nenhuma caixa padrão ativa: o sistema envia pelo SMTP do servidor (${envAlternativo.host}).`
              : 'Nenhuma caixa ativa: hoje o sistema NÃO envia e-mail — a redefinição de senha só aparece no log do servidor.'}
        </p>
        <button type="button" className="botao botao--principal botao--compacto" onClick={() => setAberta('nova')}>
          Nova caixa
        </button>
      </div>

      <table className="tabela tabela--densa tabela--clicavel">
        <thead>
          <tr>
            <th scope="col">Caixa</th>
            <th scope="col">Servidor</th>
            <th scope="col">Último teste</th>
            <th scope="col">Situação</th>
          </tr>
        </thead>
        <tbody>
          {caixas.map((c) => (
            <tr
              key={c.id}
              tabIndex={0}
              onClick={() => setAberta(c)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  setAberta(c);
                }
              }}
              className={c.ativo ? undefined : 'tabela__linha--inativa'}
            >
              <td>
                <strong>{c.nome}</strong>
                {c.padrao && <span className="etiqueta">padrão</span>}
                <br />
                <small className="texto-discreto">{c.remetenteEmail}</small>
              </td>
              <td>
                {c.host}:{c.porta}
                <br />
                <small className="texto-discreto">
                  {c.usuario ?? 'sem autenticação'}
                  {c.modelos > 0 ? ` · ${c.modelos} layout(s)` : ''}
                </small>
              </td>
              <td>
                {c.ultimoTeste ? (
                  <span
                    className={`etiqueta ${c.ultimoTeste.ok ? 'etiqueta--ok' : 'etiqueta--critico'}`}
                    title={c.ultimoTeste.erro ?? undefined}
                  >
                    {c.ultimoTeste.ok ? 'funcionou' : 'falhou'} · {quando(c.ultimoTeste.em)}
                  </span>
                ) : (
                  <span className="texto-discreto">nunca testada</span>
                )}
              </td>
              <td>
                {c.ativo ? (
                  <span className="etiqueta etiqueta--ok">Ativa</span>
                ) : (
                  <span className="etiqueta etiqueta--atencao">Desligada</span>
                )}
              </td>
            </tr>
          ))}
          {caixas.length === 0 && (
            <tr>
              <td colSpan={4} className="tabela__vazio">
                Nenhuma caixa cadastrada. Comece pela do sistema (ex.: nao-responda@).
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function FichaCaixa({
  caixa,
  primeira,
  aoVoltar,
}: {
  caixa: Caixa | null;
  /** A primeira caixa nasce padrão: sem padrão, nada sai. */
  primeira: boolean;
  aoVoltar: () => void;
}): React.JSX.Element {
  const { usuario } = useAuth();
  const [form, setForm] = useState<DadosCaixa>(
    caixa
      ? {
          nome: caixa.nome,
          host: caixa.host,
          porta: caixa.porta,
          seguranca: caixa.seguranca,
          usuario: caixa.usuario ?? '',
          senha: '',
          remetenteNome: caixa.remetenteNome ?? '',
          remetenteEmail: caixa.remetenteEmail,
          responderPara: caixa.responderPara ?? '',
          ativo: caixa.ativo,
          padrao: caixa.padrao,
        }
      : { ...VAZIA, padrao: primeira, nome: primeira ? 'Sistema' : '' },
  );
  const [para, setPara] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [teste, setTeste] = useState<{ ok: boolean; texto: string } | null>(null);
  const [ocupado, setOcupado] = useState<'salvar' | 'testar' | 'excluir' | null>(null);

  const definir = <K extends keyof DadosCaixa>(campo: K, valor: DadosCaixa[K]): void => {
    setForm((f) => ({ ...f, [campo]: valor }));
    setTeste(null);
  };

  const incompleto = form.nome.trim().length < 2 || form.host.trim() === '' || form.remetenteEmail.trim() === '';
  const faltaSenha = form.usuario.trim() !== '' && form.senha.trim() === '' && !caixa?.temSenha;

  async function salvar(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setOcupado('salvar');
    setErro(null);
    try {
      if (caixa) await emailDisparoApi.atualizarCaixa(caixa.id, form);
      else await emailDisparoApi.criarCaixa(form);
      aoVoltar();
    } catch (falha) {
      setErro(mensagemDeErro(falha, 'Não foi possível salvar.'));
      setOcupado(null);
    }
  }

  async function testar(): Promise<void> {
    setOcupado('testar');
    setErro(null);
    setTeste(null);
    try {
      const { nome: _n, ativo: _a, padrao: _p, ...campos } = form;
      const r = await emailDisparoApi.testarCaixa({ ...campos, id: caixa?.id, para: para.trim() });
      setTeste(
        r.ok
          ? { ok: true, texto: `Enviado para ${r.para}. Confira a caixa de entrada (e o spam).` }
          : { ok: false, texto: r.erro },
      );
    } catch (falha) {
      setErro(mensagemDeErro(falha, 'Não foi possível testar.'));
    } finally {
      setOcupado(null);
    }
  }

  async function excluir(): Promise<void> {
    if (!caixa) return;
    const efeito = caixa.modelos > 0 ? ` Os ${caixa.modelos} layout(s) dela passam a sair pela caixa padrão.` : '';
    if (!window.confirm(`Excluir a caixa "${caixa.nome}"?${efeito}`)) return;
    setOcupado('excluir');
    try {
      await emailDisparoApi.excluirCaixa(caixa.id);
      aoVoltar();
    } catch (falha) {
      setErro(mensagemDeErro(falha, 'Não foi possível excluir.'));
      setOcupado(null);
    }
  }

  return (
    <form className="formulario" onSubmit={(e) => void salvar(e)} noValidate>
      <div className="email__topo">
        <button type="button" className="botao botao--discreto botao--compacto" onClick={aoVoltar}>
          ← Caixas
        </button>
        <h3 className="config__titulo">{caixa ? caixa.nome : 'Nova caixa de saída'}</h3>
      </div>

      <p className="texto-discreto">
        No Google Workspace, use uma conta só para o envio e a <strong>senha de app</strong> dela
        (16 letras), nunca a senha da conta.
      </p>

      {erro && (
        <p className="alerta alerta--erro" role="alert">
          {erro}
        </p>
      )}
      {caixa?.ultimoTeste && (
        <p className="nota-integracao">
          Último teste em {quando(caixa.ultimoTeste.em)}: <strong>{caixa.ultimoTeste.ok ? 'funcionou' : 'falhou'}</strong>
          {!caixa.ultimoTeste.ok && caixa.ultimoTeste.erro ? ` — ${caixa.ultimoTeste.erro}` : ''}.
        </p>
      )}

      <label className="campo-form campo-form--largo">
        <span>
          Nome da caixa <em>obrigatório</em>
        </span>
        <input
          value={form.nome}
          onChange={(e) => definir('nome', e.target.value)}
          placeholder="Sistema, Cobrança, Renovação…"
          maxLength={80}
          autoComplete="off"
        />
      </label>

      <div className="formulario__linha">
        <label className="campo-form campo-form--largo">
          <span>
            Servidor SMTP <em>obrigatório</em>
          </span>
          <input
            value={form.host}
            onChange={(e) => definir('host', e.target.value)}
            placeholder="smtp.gmail.com"
            maxLength={255}
            autoComplete="off"
          />
        </label>
        <label className="campo-form">
          <span>Porta</span>
          <input
            type="number"
            value={form.porta}
            onChange={(e) => definir('porta', Number(e.target.value))}
            min={1}
            max={65535}
          />
        </label>
        <label className="campo-form">
          <span>Segurança</span>
          <select
            value={form.seguranca}
            onChange={(e) => {
              const s = e.target.value as Seguranca;
              // A porta acompanha, que é o erro comum: 465 com STARTTLS não conecta.
              setForm((f) => ({ ...f, seguranca: s, porta: s === 'tls' ? 465 : 587 }));
              setTeste(null);
            }}
          >
            <option value="starttls">STARTTLS (porta 587)</option>
            <option value="tls">TLS direto (porta 465)</option>
          </select>
        </label>
      </div>

      <div className="formulario__acoes formulario__acoes--esquerda">
        <button
          type="button"
          className="botao botao--discreto botao--compacto"
          onClick={() => {
            setForm((f) => ({ ...f, ...GOOGLE }));
            setTeste(null);
          }}
          title="smtp.gmail.com · 587 · STARTTLS"
        >
          Preencher Google Workspace
        </button>
      </div>

      <div className="formulario__linha">
        <label className="campo-form">
          <span>Usuário (a conta)</span>
          <input
            type="email"
            value={form.usuario}
            onChange={(e) => definir('usuario', e.target.value)}
            placeholder="nao-responda@minhacorretora.com.br"
            maxLength={254}
            autoComplete="off"
          />
        </label>
        <label className="campo-form">
          <span>
            Senha de app {caixa?.temSenha && <em>cadastrada {caixa.senhaDica ?? ''}</em>}
          </span>
          <input
            type="password"
            value={form.senha}
            onChange={(e) => definir('senha', e.target.value)}
            placeholder={caixa?.temSenha ? 'Deixe vazio para manter a atual' : 'Ainda não cadastrada'}
            maxLength={500}
            autoComplete="new-password"
          />
        </label>
      </div>

      <div className="formulario__linha">
        <label className="campo-form">
          <span>Nome do remetente</span>
          <input
            value={form.remetenteNome}
            onChange={(e) => definir('remetenteNome', e.target.value)}
            placeholder="MinhaCorretora"
            maxLength={120}
            autoComplete="off"
          />
        </label>
        <label className="campo-form">
          <span>
            E-mail do remetente <em>obrigatório</em>
          </span>
          <input
            type="email"
            value={form.remetenteEmail}
            onChange={(e) => definir('remetenteEmail', e.target.value)}
            placeholder="A própria conta, ou um alias dela"
            maxLength={254}
            autoComplete="off"
          />
        </label>
        <label className="campo-form">
          <span>Responder para</span>
          <input
            type="email"
            value={form.responderPara}
            onChange={(e) => definir('responderPara', e.target.value)}
            placeholder="Opcional — quem recebe as respostas"
            maxLength={254}
            autoComplete="off"
          />
        </label>
      </div>

      {/* Teste: com o que está no formulário, antes ou depois de salvar. */}
      <div className="formulario__linha">
        <label className="campo-form">
          <span>Enviar teste para</span>
          <input
            type="email"
            value={para}
            onChange={(e) => setPara(e.target.value)}
            placeholder={usuario?.email ?? 'seu e-mail'}
            maxLength={254}
            autoComplete="off"
          />
        </label>
        <div className="campo-form config__teste">
          <span aria-hidden="true">&nbsp;</span>
          <button
            type="button"
            className="botao botao--discreto botao--compacto"
            onClick={() => void testar()}
            disabled={ocupado !== null || form.host.trim() === '' || form.remetenteEmail.trim() === '' || faltaSenha}
            title={faltaSenha ? 'Informe a senha de app' : 'Conecta, autentica e envia um e-mail de teste'}
          >
            {ocupado === 'testar' ? 'Enviando…' : 'Enviar teste'}
          </button>
        </div>
      </div>

      {teste && (
        <p className={`alerta ${teste.ok ? 'alerta--ok' : 'alerta--erro'}`} role="status">
          {teste.texto}
        </p>
      )}

      <label className="campo-check">
        <input type="checkbox" checked={form.ativo} onChange={(e) => definir('ativo', e.target.checked)} />
        <span>
          <strong>Caixa ativa</strong>
          <br />
          <span className="texto-discreto">Desligada, nenhum e-mail sai por ela. Teste antes de ligar.</span>
        </span>
      </label>

      <label className="campo-check">
        <input
          type="checkbox"
          checked={form.padrao}
          disabled={caixa?.padrao === true}
          onChange={(e) => definir('padrao', e.target.checked)}
        />
        <span>
          <strong>Caixa padrão</strong>
          <br />
          <span className="texto-discreto">
            {caixa?.padrao
              ? 'Esta já é a padrão. Para trocar, marque outra como padrão.'
              : 'Por ela sai todo e-mail sem caixa própria no layout, inclusive a redefinição de senha. Marcar esta tira a marca da atual.'}
          </span>
        </span>
      </label>

      <div className="formulario__acoes">
        {caixa?.atualizadoEm && (
          <small className="texto-discreto config__rodape">
            Alterada em {quando(caixa.atualizadoEm)}
            {caixa.atualizadoPor ? ` por ${caixa.atualizadoPor}` : ''}
          </small>
        )}
        {caixa && !caixa.padrao && (
          <button
            type="button"
            className="botao botao--discreto botao--compacto"
            onClick={() => void excluir()}
            disabled={ocupado !== null}
          >
            Excluir
          </button>
        )}
        <button
          type="submit"
          className="botao botao--principal botao--compacto"
          disabled={ocupado !== null || incompleto || (form.ativo && faltaSenha)}
        >
          {ocupado === 'salvar' ? 'Salvando…' : caixa ? 'Salvar' : 'Cadastrar'}
        </button>
      </div>
    </form>
  );
}
