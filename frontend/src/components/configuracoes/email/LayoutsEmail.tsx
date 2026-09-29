import { useCallback, useEffect, useRef, useState } from 'react';

import { useAuth } from '@/hooks/useAuth';
import {
  emailDisparoApi,
  mensagemDeErro,
  quando,
  type Caixa,
  type DadosModelo,
  type Finalidade,
  type Modelo,
} from '@/lib/emailDisparo';

// Layouts de e-mail. Um ativo por finalidade; sem layout ativo, sai o e-mail embutido.

/** Texto inicial de cada finalidade. */
const INICIO: Record<string, { assunto: string; corpo: string }> = {
  redefinicao_senha: {
    assunto: 'Redefinição de senha — MinhaCorretora',
    corpo: `<p>Olá, {{primeiro_nome}}.</p>
<p>Recebemos um pedido para redefinir a senha da sua conta no MinhaCorretora BI.</p>
<p><a href="{{link}}" style="display:inline-block;padding:12px 24px;border-radius:8px;background:#0b2a52;color:#ffffff;font-weight:bold;text-decoration:none;">Escolher nova senha</a></p>
<p>Se o botão não funcionar, copie este endereço no navegador:<br />{{link}}</p>
<p>O link vale por {{validade_minutos}} minutos e só pode ser usado uma vez. Se não foi você quem pediu, ignore esta mensagem.</p>`,
  },
  senha_alterada: {
    assunto: 'Sua senha do MinhaCorretora BI foi alterada',
    corpo: `<p>Olá, {{primeiro_nome}}.</p>
<p>A senha da sua conta foi alterada em <strong>{{quando}}</strong>.</p>
<p>Se foi você, nada a fazer. Se não foi, avise o administrador do sistema imediatamente.</p>`,
  },
  primeiro_atraso: {
    assunto: '{{titulo}}',
    corpo: `<p>{{primeiro_nome}},</p>
<p>{{mensagem}}</p>
<p>Vale ligar para o cliente antes que a segunda parcela vença.</p>`,
  },
  livre: {
    assunto: '',
    corpo: `<p>Olá, {{primeiro_nome}}.</p>
<p></p>`,
  },
};

export function LayoutsEmail(): React.JSX.Element {
  const [modelos, setModelos] = useState<Modelo[] | null>(null);
  const [finalidades, setFinalidades] = useState<Finalidade[]>([]);
  const [caixas, setCaixas] = useState<Caixa[]>([]);
  const [erro, setErro] = useState<string | null>(null);
  const [aberto, setAberto] = useState<Modelo | 'novo' | null>(null);

  const carregar = useCallback(async (): Promise<void> => {
    setErro(null);
    try {
      const [m, c] = await Promise.all([emailDisparoApi.modelos(), emailDisparoApi.caixas()]);
      setModelos(m.modelos);
      setFinalidades(m.finalidades);
      setCaixas(c.caixas);
    } catch (falha) {
      setErro(mensagemDeErro(falha, 'Não foi possível carregar os layouts.'));
    }
  }, []);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  if (erro) {
    return (
      <p className="alerta alerta--erro" role="alert">
        {erro}
      </p>
    );
  }
  if (!modelos) return <p className="texto-discreto">Carregando…</p>;

  if (aberto) {
    return (
      <EditorLayout
        modelo={aberto === 'novo' ? null : aberto}
        finalidades={finalidades}
        caixas={caixas}
        aoVoltar={() => {
          setAberto(null);
          void carregar();
        }}
      />
    );
  }

  const rotulo = (chave: string): string => finalidades.find((f) => f.chave === chave)?.rotulo ?? chave;
  // As finalidades do sistema que ainda saem com o e-mail embutido.
  const semLayout = finalidades.filter(
    (f) => f.chave !== 'livre' && !modelos.some((m) => m.finalidade === f.chave && m.ativo),
  );

  return (
    <div className="usuarios">
      <div className="usuarios__barra">
        <p className="texto-discreto email__situacao">
          {semLayout.length > 0
            ? `Com o e-mail embutido do sistema (sem layout ativo): ${semLayout.map((f) => f.rotulo).join(', ')}.`
            : 'Todos os e-mails do sistema saem com layout cadastrado.'}
        </p>
        <button type="button" className="botao botao--principal botao--compacto" onClick={() => setAberto('novo')}>
          Novo layout
        </button>
      </div>

      <table className="tabela tabela--densa tabela--clicavel">
        <thead>
          <tr>
            <th scope="col">Layout</th>
            <th scope="col">Quando é usado</th>
            <th scope="col">Sai pela caixa</th>
            <th scope="col">Situação</th>
          </tr>
        </thead>
        <tbody>
          {modelos.map((m) => (
            <tr
              key={m.id}
              tabIndex={0}
              onClick={() => setAberto(m)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  setAberto(m);
                }
              }}
              className={m.ativo ? undefined : 'tabela__linha--inativa'}
            >
              <td>
                <strong>{m.nome}</strong>
                <br />
                <small className="texto-discreto">{m.assunto}</small>
              </td>
              <td>{rotulo(m.finalidade)}</td>
              <td>{m.caixaNome ?? <span className="texto-discreto">a padrão</span>}</td>
              <td>
                {m.ativo ? (
                  <span className="etiqueta etiqueta--ok">Ativo</span>
                ) : (
                  <span className="etiqueta etiqueta--atencao">Desligado</span>
                )}
              </td>
            </tr>
          ))}
          {modelos.length === 0 && (
            <tr>
              <td colSpan={4} className="tabela__vazio">
                Nenhum layout ainda. Os e-mails do sistema saem com o modelo embutido até existir um.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function EditorLayout({
  modelo,
  finalidades,
  caixas,
  aoVoltar,
}: {
  modelo: Modelo | null;
  finalidades: Finalidade[];
  caixas: Caixa[];
  aoVoltar: () => void;
}): React.JSX.Element {
  const { usuario } = useAuth();
  const inicial = finalidades.find((f) => f.chave !== 'livre')?.chave ?? 'livre';
  const [form, setForm] = useState<DadosModelo>(
    modelo
      ? {
          nome: modelo.nome,
          finalidade: modelo.finalidade,
          caixa: modelo.caixa ?? '',
          assunto: modelo.assunto,
          corpoHtml: modelo.corpoHtml,
          corpoTexto: modelo.corpoTexto ?? '',
          usarMoldura: modelo.usarMoldura,
          ativo: modelo.ativo,
        }
      : {
          nome: '',
          finalidade: inicial,
          caixa: '',
          assunto: INICIO[inicial]?.assunto ?? '',
          corpoHtml: INICIO[inicial]?.corpo ?? '',
          corpoTexto: '',
          usarMoldura: true,
          ativo: false,
        },
  );
  const [para, setPara] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [teste, setTeste] = useState<{ ok: boolean; texto: string } | null>(null);
  const [previa, setPrevia] = useState<{ assunto: string; html: string } | null>(null);
  const [erroPrevia, setErroPrevia] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState<'salvar' | 'testar' | 'excluir' | null>(null);

  // Onde a variável clicada entra: o último campo focado (assunto ou corpo).
  const assuntoRef = useRef<HTMLInputElement>(null);
  const corpoRef = useRef<HTMLTextAreaElement>(null);
  const ultimoCampo = useRef<'assunto' | 'corpoHtml'>('corpoHtml');

  const finalidade = finalidades.find((f) => f.chave === form.finalidade);
  const definir = <K extends keyof DadosModelo>(campo: K, valor: DadosModelo[K]): void => {
    setForm((f) => ({ ...f, [campo]: valor }));
    setTeste(null);
  };

  /** Troca de finalidade num layout NOVO e ainda intocado: troca também o texto inicial. */
  function trocarFinalidade(chave: string): void {
    setForm((f) => {
      const intocado =
        !modelo &&
        f.corpoHtml === (INICIO[f.finalidade]?.corpo ?? '') &&
        f.assunto === (INICIO[f.finalidade]?.assunto ?? '');
      return intocado
        ? { ...f, finalidade: chave, assunto: INICIO[chave]?.assunto ?? '', corpoHtml: INICIO[chave]?.corpo ?? '' }
        : { ...f, finalidade: chave };
    });
  }

  function inserir(variavel: string): void {
    const trecho = `{{${variavel}}}`;
    const campo = ultimoCampo.current;
    const el = campo === 'assunto' ? assuntoRef.current : corpoRef.current;
    const atual = form[campo];
    const ini = el?.selectionStart ?? atual.length;
    const fim = el?.selectionEnd ?? atual.length;
    definir(campo, atual.slice(0, ini) + trecho + atual.slice(fim));
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(ini + trecho.length, ini + trecho.length);
    });
  }

  // Prévia renderizada no SERVIDOR (o mesmo código que envia), com espera após a digitação.
  useEffect(() => {
    if (!form.assunto.trim() || !form.corpoHtml.trim()) {
      setPrevia(null);
      return;
    }
    const t = setTimeout(() => {
      const { nome: _n, ativo: _a, ...campos } = form;
      emailDisparoApi
        .previa(campos)
        .then((p) => {
          setPrevia(p);
          setErroPrevia(null);
        })
        .catch((falha: unknown) => setErroPrevia(mensagemDeErro(falha, 'Pré-visualização indisponível.')));
    }, 500);
    return () => clearTimeout(t);
  }, [form]);

  async function salvar(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setOcupado('salvar');
    setErro(null);
    try {
      if (modelo) await emailDisparoApi.atualizarModelo(modelo.id, form);
      else await emailDisparoApi.criarModelo(form);
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
      const { nome: _n, ativo: _a, ...campos } = form;
      const r = await emailDisparoApi.testarModelo({ ...campos, para: para.trim() });
      setTeste(
        r.ok
          ? { ok: true, texto: `Enviado para ${r.para}, com os valores de exemplo. Confira a caixa de entrada.` }
          : { ok: false, texto: r.erro },
      );
    } catch (falha) {
      setErro(mensagemDeErro(falha, 'Não foi possível testar.'));
    } finally {
      setOcupado(null);
    }
  }

  async function excluir(): Promise<void> {
    if (!modelo) return;
    if (!window.confirm(`Excluir o layout "${modelo.nome}"?`)) return;
    setOcupado('excluir');
    try {
      await emailDisparoApi.excluirModelo(modelo.id);
      aoVoltar();
    } catch (falha) {
      setErro(mensagemDeErro(falha, 'Não foi possível excluir.'));
      setOcupado(null);
    }
  }

  const incompleto = form.nome.trim().length < 2 || form.assunto.trim().length < 2 || !form.corpoHtml.trim();

  return (
    <form className="formulario" onSubmit={(e) => void salvar(e)} noValidate>
      <div className="email__topo">
        <button type="button" className="botao botao--discreto botao--compacto" onClick={aoVoltar}>
          ← Layouts
        </button>
        <h3 className="config__titulo">{modelo ? modelo.nome : 'Novo layout'}</h3>
      </div>

      {erro && (
        <p className="alerta alerta--erro" role="alert">
          {erro}
        </p>
      )}

      <div className="formulario__linha">
        <label className="campo-form">
          <span>
            Nome do layout <em>obrigatório</em>
          </span>
          <input
            value={form.nome}
            onChange={(e) => definir('nome', e.target.value)}
            placeholder="Ex.: Redefinição de senha — 2026"
            maxLength={120}
            autoComplete="off"
          />
        </label>
        <label className="campo-form">
          <span>Quando é usado</span>
          <select value={form.finalidade} onChange={(e) => trocarFinalidade(e.target.value)}>
            {finalidades.map((f) => (
              <option key={f.chave} value={f.chave}>
                {f.rotulo}
              </option>
            ))}
          </select>
        </label>
        <label className="campo-form">
          <span>Sai pela caixa</span>
          <select value={form.caixa} onChange={(e) => definir('caixa', e.target.value)}>
            <option value="">A padrão</option>
            {caixas.map((c) => (
              <option key={c.id} value={c.id}>
                {c.nome}
                {c.ativo ? '' : ' (desligada)'}
              </option>
            ))}
          </select>
        </label>
      </div>
      {finalidade && <p className="texto-discreto email__dica">{finalidade.descricao}</p>}

      <label className="campo-form campo-form--largo">
        <span>
          Assunto <em>obrigatório</em>
        </span>
        <input
          ref={assuntoRef}
          value={form.assunto}
          onChange={(e) => definir('assunto', e.target.value)}
          onFocus={() => (ultimoCampo.current = 'assunto')}
          maxLength={255}
          autoComplete="off"
        />
      </label>

      {finalidade && (
        <div className="email__variaveis" aria-label="Variáveis disponíveis">
          <span className="texto-discreto">Inserir:</span>
          {finalidade.variaveis.map((v) => (
            <button
              key={v.nome}
              type="button"
              className="email__variavel"
              onClick={() => inserir(v.nome)}
              title={`${v.descricao} — ex.: ${v.exemplo}`}
            >
              {`{{${v.nome}}}`}
              {finalidade.obrigatorias.includes(v.nome) && <strong> *</strong>}
            </button>
          ))}
        </div>
      )}

      <div className="email__editor">
        <label className="campo-form">
          <span>
            Corpo (HTML) <em>obrigatório</em>
          </span>
          <textarea
            ref={corpoRef}
            value={form.corpoHtml}
            onChange={(e) => definir('corpoHtml', e.target.value)}
            onFocus={() => (ultimoCampo.current = 'corpoHtml')}
            rows={14}
            spellCheck={false}
          />
          <small className="texto-discreto">
            HTML simples: &lt;p&gt;, &lt;strong&gt;, &lt;br /&gt;, &lt;a href="…"&gt;. Estilo inline (o Outlook ignora o resto).
          </small>
        </label>

        <div className="email__previa">
          <span className="email__previa-rotulo">
            Pré-visualização <small className="texto-discreto">com valores de exemplo</small>
          </span>
          {erroPrevia ? (
            <p className="alerta alerta--aviso">{erroPrevia}</p>
          ) : previa ? (
            <>
              <p className="email__previa-assunto">
                <strong>Assunto:</strong> {previa.assunto}
              </p>
              {/* sandbox vazio: sem script, sem formulário, sem navegar. */}
              <iframe className="email__previa-quadro" title="Pré-visualização do e-mail" sandbox="" srcDoc={previa.html} />
            </>
          ) : (
            <p className="texto-discreto">Preencha assunto e corpo.</p>
          )}
        </div>
      </div>

      <details className="colunas-modelo">
        <summary>Versão só texto (opcional)</summary>
        <p className="texto-discreto">
          Para quem tem HTML bloqueado no e-mail. Vazia, é gerada a partir do corpo.
        </p>
        <label className="campo-form">
          <textarea
            value={form.corpoTexto}
            onChange={(e) => definir('corpoTexto', e.target.value)}
            rows={6}
            spellCheck={false}
          />
        </label>
      </details>

      <label className="campo-check">
        <input type="checkbox" checked={form.usarMoldura} onChange={(e) => definir('usarMoldura', e.target.checked)} />
        <span>
          <strong>Usar a moldura da MinhaCorretora</strong>
          <br />
          <span className="texto-discreto">
            Cabeçalho e rodapé padrão em volta do corpo. Desmarque se o corpo já é o HTML completo.
          </span>
        </span>
      </label>

      {/* Teste: o layout do formulário, com os valores de exemplo. */}
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
            disabled={ocupado !== null || incompleto}
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
          <strong>Layout ativo</strong>
          <br />
          <span className="texto-discreto">
            {form.finalidade === 'livre'
              ? 'Layout livre: fica guardado para uso manual.'
              : 'O sistema passa a usar este layout. Só um pode estar ativo por finalidade.'}
          </span>
        </span>
      </label>

      <div className="formulario__acoes">
        {modelo?.atualizadoEm && (
          <small className="texto-discreto config__rodape">
            Alterado em {quando(modelo.atualizadoEm)}
            {modelo.atualizadoPor ? ` por ${modelo.atualizadoPor}` : ''}
          </small>
        )}
        {modelo && (
          <button
            type="button"
            className="botao botao--discreto botao--compacto"
            onClick={() => void excluir()}
            disabled={ocupado !== null}
          >
            Excluir
          </button>
        )}
        <button type="submit" className="botao botao--principal botao--compacto" disabled={ocupado !== null || incompleto}>
          {ocupado === 'salvar' ? 'Salvando…' : modelo ? 'Salvar' : 'Cadastrar'}
        </button>
      </div>
    </form>
  );
}
