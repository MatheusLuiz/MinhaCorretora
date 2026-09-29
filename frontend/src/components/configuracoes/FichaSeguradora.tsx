import { useState } from 'react';

import { TiposDaSeguradora } from '@/components/configuracoes/TiposDaSeguradora';
import { ApiError } from '@/lib/api';
import {
  seguradorasApi,
  type Ambiente,
  type Seguradora,
  type TipoIntegracao,
} from '@/lib/seguradoras';

type AbaSeguradora = 'cadastro' | 'tipos' | 'integracao' | 'credenciais' | 'documentacao';

interface Props {
  /** `null` = cadastro novo. */
  seguradora: Seguradora | null;
  aoVoltar: () => void;
  aoSalvar: (salva: Seguradora) => void;
}

/**
 * Cadastro e integração de uma companhia. O servidor nunca devolve o segredo:
 * campo vazio ao salvar = "mantenha"; apagar tem botão próprio.
 */
export function FichaSeguradora({ seguradora, aoVoltar, aoSalvar }: Props): React.JSX.Element {
  const novo = seguradora === null;
  const [aba, setAba] = useState<AbaSeguradora>('cadastro');

  const [form, setForm] = useState({
    nome: seguradora?.nome ?? '',
    cnpj: seguradora?.cnpj ?? '',
    codigoSusep: seguradora?.codigoSusep ?? '',
    site: seguradora?.site ?? '',
    telefone: seguradora?.telefone ?? '',
    email: seguradora?.email ?? '',
    observacoes: seguradora?.observacoes ?? '',
  });

  const [integracao, setIntegracao] = useState({
    tipo: (seguradora?.integracao?.tipo ?? 'nenhuma') as TipoIntegracao,
    ambiente: (seguradora?.integracao?.ambiente ?? 'producao') as Ambiente,
    ativa: seguradora?.integracao?.ativa ?? false,
    baseUrl: seguradora?.integracao?.baseUrl ?? '',
    usuario: seguradora?.integracao?.usuario ?? '',
    observacoes: seguradora?.integracao?.observacoes ?? '',
    segredo: '',
    documentacaoUrl: seguradora?.integracao?.documentacaoUrl ?? '',
    documentacao: seguradora?.integracao?.documentacao ?? '',
  });

  // `valor` nasce vazio (nunca desce do servidor); vazio ao salvar = manter o gravado.
  const [credenciais, setCredenciais] = useState<
    { chave: string; nome: string; valor: string; dica: string | null; gravada: boolean }[]
  >(
    (seguradora?.integracao?.credenciais ?? []).map((c, i) => ({
      chave: `g${i}`,
      nome: c.nome,
      valor: '',
      dica: c.dica,
      gravada: true,
    })),
  );

  const mudarCredencial = (chave: string, campo: 'nome' | 'valor', valor: string): void =>
    setCredenciais((antes) => antes.map((c) => (c.chave === chave ? { ...c, [campo]: valor } : c)));

  const credenciaisParaSalvar = (): { nome: string; valor?: string }[] =>
    credenciais
      .filter((c) => c.nome.trim())
      .map((c) => ({ nome: c.nome.trim(), ...(c.valor.trim() ? { valor: c.valor.trim() } : {}) }));

  const recarregarCredenciais = (salva: Seguradora): void =>
    setCredenciais(
      (salva.integracao?.credenciais ?? []).map((c, i) => ({
        chave: `g${i}-${Date.now()}`,
        nome: c.nome,
        valor: '',
        dica: c.dica,
        gravada: true,
      })),
    );

  const [erros, setErros] = useState<string[]>([]);
  const [aviso, setAviso] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  const definir = (campo: keyof typeof form, valor: string): void =>
    setForm((antes) => ({ ...antes, [campo]: valor }));

  function tratar(falha: unknown, alternativa: string): void {
    setErros(
      falha instanceof ApiError
        ? falha.mensagensDeValidacao.length > 0
          ? [falha.message, ...falha.mensagensDeValidacao]
          : [falha.message]
        : [alternativa],
    );
  }

  async function salvarCadastro(evento: React.FormEvent): Promise<void> {
    evento.preventDefault();
    setErros([]);
    setAviso(null);
    setEnviando(true);

    try {
      const corpo = {
        nome: form.nome.trim(),
        cnpj: form.cnpj.trim() || null,
        codigoSusep: form.codigoSusep.trim() || null,
        site: form.site.trim() || null,
        telefone: form.telefone.trim() || null,
        email: form.email.trim() || null,
        observacoes: form.observacoes.trim() || null,
      };

      const r = novo
        ? await seguradorasApi.criar(corpo)
        : await seguradorasApi.atualizar(seguradora.id, corpo);

      aoSalvar(r.seguradora);
      setAviso(novo ? 'Seguradora cadastrada.' : 'Cadastro atualizado.');
    } catch (falha) {
      tratar(falha, 'Não foi possível salvar a seguradora.');
    } finally {
      setEnviando(false);
    }
  }

  async function salvarIntegracao(evento: React.FormEvent): Promise<void> {
    evento.preventDefault();
    if (!seguradora) return;

    setErros([]);
    setAviso(null);
    setEnviando(true);

    try {
      const r = await seguradorasApi.salvarIntegracao(seguradora.id, {
        tipo: integracao.tipo,
        ambiente: integracao.ambiente,
        ativa: integracao.ativa,
        baseUrl: integracao.baseUrl.trim() || null,
        usuario: integracao.usuario.trim() || null,
        observacoes: integracao.observacoes.trim() || null,
        documentacaoUrl: integracao.documentacaoUrl.trim() || null,
        documentacao: integracao.documentacao.trim() || null,
        credenciais: credenciaisParaSalvar(),
        // Vazio é omissão, não apagamento.
        ...(integracao.segredo.trim() ? { segredo: integracao.segredo.trim() } : {}),
      });

      aoSalvar(r.seguradora);
      setIntegracao((antes) => ({ ...antes, segredo: '' }));
      recarregarCredenciais(r.seguradora);
      setAviso('Integração salva.');
    } catch (falha) {
      tratar(falha, 'Não foi possível salvar a integração.');
    } finally {
      setEnviando(false);
    }
  }

  async function apagarSegredo(): Promise<void> {
    if (!seguradora) return;

    setErros([]);
    setEnviando(true);

    try {
      const r = await seguradorasApi.salvarIntegracao(seguradora.id, {
        tipo: integracao.tipo,
        ambiente: integracao.ambiente,
        // Sem credencial, ligada falharia a cada tentativa.
        ativa: false,
        baseUrl: integracao.baseUrl.trim() || null,
        usuario: integracao.usuario.trim() || null,
        observacoes: integracao.observacoes.trim() || null,
        documentacaoUrl: integracao.documentacaoUrl.trim() || null,
        documentacao: integracao.documentacao.trim() || null,
        segredo: null,
      });

      aoSalvar(r.seguradora);
      setIntegracao((antes) => ({ ...antes, ativa: false, segredo: '' }));
      setAviso('Credencial removida e integração desligada.');
    } catch (falha) {
      tratar(falha, 'Não foi possível remover a credencial.');
    } finally {
      setEnviando(false);
    }
  }

  async function alternarSituacao(): Promise<void> {
    if (!seguradora) return;

    setErros([]);
    setEnviando(true);

    try {
      const r = await seguradorasApi.definirSituacao(seguradora.id, !seguradora.ativa);
      aoSalvar(r.seguradora);
      setIntegracao((antes) => ({ ...antes, ativa: r.seguradora.integracao?.ativa ?? false }));
      setAviso(
        r.seguradora.ativa
          ? 'Seguradora reativada — volta a aparecer nas telas de escolha.'
          : 'Seguradora inativada — sai do cadastro de cliente e da importação.',
      );
    } catch (falha) {
      tratar(falha, 'Não foi possível mudar a situação.');
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className="ficha">
      {/* `ficha__voltar` é um quadrado de 2rem: o destino vai no aria-label e no title. */}
      <header className="ficha__topo">
        <button
          type="button"
          className="ficha__voltar"
          onClick={aoVoltar}
          aria-label="Voltar à lista de seguradoras"
          title="Voltar à lista de seguradoras"
        >
          ←
        </button>

        <div className="ficha__identidade">
          <h3>{novo ? 'Nova seguradora' : seguradora.nome}</h3>
          {!novo && (
            <p>
              {seguradora.clientes.toLocaleString('pt-BR')} cliente(s) ·{' '}
              {seguradora.apolices.toLocaleString('pt-BR')} apólice(s)
              {seguradora.inativadaEm &&
                ` · inativa desde ${new Date(seguradora.inativadaEm).toLocaleDateString('pt-BR')}`}
            </p>
          )}
        </div>

        {!novo && (
          <div className="ficha__selos">
            <span className={`etiqueta ${seguradora.ativa ? 'etiqueta--ok' : 'etiqueta--critico'}`}>
              {seguradora.ativa ? 'Ativa' : 'Inativa'}
            </span>
          </div>
        )}
      </header>

      {erros.length > 0 && (
        <div className="alerta alerta--erro" role="alert">
          {erros.map((m) => (
            <p key={m}>{m}</p>
          ))}
        </div>
      )}

      {aviso && (
        <p className="alerta alerta--ok" role="status">
          {aviso}
        </p>
      )}

      {/* Seguradora nova só tem Cadastro: as outras abas gravam ligadas a ele. */}
      <nav className="abas" aria-label="Seções da seguradora">
        {(
          [
            ['cadastro', 'Cadastro'],
            ['tipos', 'Tipos de seguro'],
            ['integracao', 'Integração'],
            ['credenciais', `Credenciais${credenciais.length > 0 ? ` (${credenciais.length})` : ''}`],
            ['documentacao', 'Documentação'],
          ] as [AbaSeguradora, string][]
        ).map(([chave, rotulo]) => (
          <button
            key={chave}
            type="button"
            className={aba === chave ? 'abas__item abas__item--ativa' : 'abas__item'}
            onClick={() => setAba(chave)}
            aria-current={aba === chave ? 'true' : undefined}
            disabled={novo && chave !== 'cadastro'}
            title={novo && chave !== 'cadastro' ? 'Disponível depois de cadastrar a seguradora' : undefined}
          >
            {rotulo}
          </button>
        ))}
      </nav>

      {aba === 'cadastro' && (
      <form className="formulario" onSubmit={(e) => void salvarCadastro(e)} noValidate>
        <div className="formulario__linha">
          <label className="campo-form campo-form--largo">
            <span>Nome *</span>
            <input
              value={form.nome}
              onChange={(e) => definir('nome', e.target.value)}
              maxLength={60}
              required
              autoComplete="off"
            />
          </label>

          <label className="campo-form">
            <span>CNPJ</span>
            <input
              value={form.cnpj}
              onChange={(e) => definir('cnpj', e.target.value)}
              maxLength={18}
              placeholder="00.000.000/0000-00"
              autoComplete="off"
            />
          </label>
        </div>

        <div className="formulario__linha">
          <label className="campo-form">
            <span>Código SUSEP</span>
            <input
              value={form.codigoSusep}
              onChange={(e) => definir('codigoSusep', e.target.value)}
              maxLength={20}
              autoComplete="off"
            />
          </label>

          <label className="campo-form">
            <span>Telefone</span>
            <input
              value={form.telefone}
              onChange={(e) => definir('telefone', e.target.value)}
              maxLength={20}
              autoComplete="off"
            />
          </label>
        </div>

        <div className="formulario__linha">
          <label className="campo-form">
            <span>E-mail</span>
            <input
              type="email"
              value={form.email}
              onChange={(e) => definir('email', e.target.value)}
              maxLength={120}
              autoComplete="off"
            />
          </label>

          <label className="campo-form">
            <span>Site</span>
            <input
              value={form.site}
              onChange={(e) => definir('site', e.target.value)}
              maxLength={200}
              placeholder="https://"
              autoComplete="off"
            />
          </label>
        </div>

        <label className="campo-form campo-form--largo">
          <span>Observações</span>
          <input
            value={form.observacoes}
            onChange={(e) => definir('observacoes', e.target.value)}
            maxLength={500}
            autoComplete="off"
          />
        </label>

        <div className="formulario__acoes">
          {!novo && (
            <button
              type="button"
              className="botao botao--discreto botao--compacto"
              onClick={() => void alternarSituacao()}
              disabled={enviando}
              title={
                seguradora.ativa
                  ? 'Some das telas de escolha; o histórico continua'
                  : 'Volta a aparecer no cadastro de cliente e na importação'
              }
            >
              {seguradora.ativa ? 'Inativar' : 'Reativar'}
            </button>
          )}

          <button
            type="submit"
            className="botao botao--principal botao--compacto"
            disabled={enviando || form.nome.trim().length < 2}
          >
            {enviando ? 'Salvando…' : novo ? 'Cadastrar' : 'Salvar cadastro'}
          </button>
        </div>
      </form>
      )}

      {aba === 'cadastro' && novo && (
        <p className="nota-integracao">
          Tipos de seguro, integração, credenciais e documentação ficam disponíveis depois do
          cadastro — elas são gravadas ligadas à seguradora, então não há onde
          guardá-las antes.
        </p>
      )}

      {!novo && aba === 'tipos' && <TiposDaSeguradora seguradora={seguradora} />}

      {/* As três abas de integração são UM formulário: trocar de aba não perde o digitado. */}
      {!novo && aba !== 'cadastro' && aba !== 'tipos' && (
        <form className="formulario" onSubmit={(e) => void salvarIntegracao(e)} noValidate>
          {aba === 'integracao' && (
          <>
          <p className="nota-integracao">
            Enquanto não houver API, o tipo é <strong>Portal</strong> — a
            importação continua sendo o arquivo baixado do site da companhia. A
            credencial é gravada cifrada e nunca volta para a tela.
          </p>

          <div className="formulario__linha">
            <label className="campo-form">
              <span>Tipo</span>
              <select
                value={integracao.tipo}
                onChange={(e) =>
                  setIntegracao((a) => ({ ...a, tipo: e.target.value as TipoIntegracao }))
                }
              >
                <option value="nenhuma">Sem integração — importação manual</option>
                <option value="portal">Portal — baixa do site da companhia</option>
                <option value="api">API</option>
                <option value="sftp">SFTP</option>
              </select>
            </label>

            <label className="campo-form">
              <span>Ambiente</span>
              <select
                value={integracao.ambiente}
                onChange={(e) =>
                  setIntegracao((a) => ({ ...a, ambiente: e.target.value as Ambiente }))
                }
              >
                <option value="producao">Produção</option>
                <option value="homologacao">Homologação</option>
              </select>
            </label>
          </div>

          <label className="campo-form campo-form--largo">
            <span>
              Endereço base <em>https:// obrigatório</em>
            </span>
            <input
              value={integracao.baseUrl}
              onChange={(e) => setIntegracao((a) => ({ ...a, baseUrl: e.target.value }))}
              maxLength={255}
              placeholder="https://api.seguradora.com.br"
              autoComplete="off"
            />
          </label>

          <div className="formulario__linha">
            <label className="campo-form">
              <span>Usuário / client id</span>
              <input
                value={integracao.usuario}
                onChange={(e) => setIntegracao((a) => ({ ...a, usuario: e.target.value }))}
                maxLength={120}
                autoComplete="off"
              />
            </label>

            <label className="campo-form">
              <span>
                Senha / chave{' '}
                {seguradora.integracao?.temSegredo && (
                  <em>cadastrada {seguradora.integracao.segredoDica ?? ''}</em>
                )}
              </span>
              <input
                type="password"
                value={integracao.segredo}
                onChange={(e) => setIntegracao((a) => ({ ...a, segredo: e.target.value }))}
                maxLength={500}
                placeholder={
                  seguradora.integracao?.temSegredo
                    ? 'Deixe vazio para manter a atual'
                    : 'Ainda não cadastrada'
                }
                autoComplete="new-password"
              />
            </label>
          </div>

          <label className="campo-form campo-form--largo">
            <span>Observações da integração</span>
            <input
              value={integracao.observacoes}
              onChange={(e) => setIntegracao((a) => ({ ...a, observacoes: e.target.value }))}
              maxLength={500}
              placeholder="Contato técnico, limites de chamada, data do contrato…"
              autoComplete="off"
            />
          </label>

          <label className="campo-check">
            <input
              type="checkbox"
              checked={integracao.ativa}
              disabled={!seguradora.ativa || integracao.tipo === 'nenhuma'}
              onChange={(e) => setIntegracao((a) => ({ ...a, ativa: e.target.checked }))}
            />
            <span>
              Integração <strong>ligada</strong>
              <br />
              <span className="texto-discreto">
                {!seguradora.ativa
                  ? 'Indisponível: a seguradora está inativa.'
                  : integracao.tipo === 'nenhuma'
                    ? 'Escolha um tipo de integração antes de ligar.'
                    : 'Desligada, a configuração fica guardada sem ser usada.'}
              </span>
            </span>
          </label>
          </>
          )}

          {aba === 'credenciais' && (
          <div className="campo-form campo-form--largo">
            <span>
              Credenciais adicionais <em>gravadas cifradas</em>
            </span>
            <small>
              Uma por linha: o nome como a documentação chama (client_id, client_secret,
              token…) e o valor. O valor nunca volta para a tela — deixe vazio para
              manter o que já está gravado.
            </small>

            <div className="credenciais">
              {credenciais.map((c) => (
                <div key={c.chave} className="credenciais__linha">
                  <input
                    value={c.nome}
                    onChange={(e) => mudarCredencial(c.chave, 'nome', e.target.value)}
                    maxLength={60}
                    placeholder="Nome (ex.: client_secret)"
                    aria-label="Nome da credencial"
                    autoComplete="off"
                  />
                  <input
                    type="password"
                    value={c.valor}
                    onChange={(e) => mudarCredencial(c.chave, 'valor', e.target.value)}
                    maxLength={2000}
                    placeholder={
                      c.gravada ? `Gravada ${c.dica ?? ''} — vazio mantém` : 'Valor'
                    }
                    aria-label={`Valor de ${c.nome || 'credencial'}`}
                    autoComplete="new-password"
                  />
                  <button
                    type="button"
                    className="botao botao--discreto botao--compacto"
                    onClick={() => setCredenciais((antes) => antes.filter((x) => x.chave !== c.chave))}
                    aria-label={`Remover ${c.nome || 'credencial'}`}
                    title="Remover — some ao salvar a integração"
                  >
                    ×
                  </button>
                </div>
              ))}

              <div>
                <button
                  type="button"
                  className="botao botao--discreto botao--compacto"
                  onClick={() =>
                    setCredenciais((antes) => [
                      ...antes,
                      { chave: `n${Date.now()}`, nome: '', valor: '', dica: null, gravada: false },
                    ])
                  }
                  disabled={credenciais.length >= 20}
                >
                  + Adicionar credencial
                </button>
              </div>
            </div>
          </div>
          )}

          {/* Documentação fica em claro, de propósito; segredo vai nas credenciais. */}
          {aba === 'documentacao' && (
          <>
          <div className="campo-form campo-form--largo">
            <span>
              <label htmlFor="documentacao-url">Link da documentação</label> <em>https://</em>
            </span>
            <div className="campo-form__com-acao">
              <input
                id="documentacao-url"
                value={integracao.documentacaoUrl}
                onChange={(e) => setIntegracao((a) => ({ ...a, documentacaoUrl: e.target.value }))}
                maxLength={255}
                placeholder="https://portal-do-desenvolvedor.seguradora.com.br"
                autoComplete="off"
              />
              {/^https:\/\//i.test(integracao.documentacaoUrl.trim()) && (
                <a
                  className="botao botao--discreto botao--compacto"
                  href={integracao.documentacaoUrl.trim()}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Abrir ↗
                </a>
              )}
            </div>
          </div>

          <label className="campo-form campo-form--largo">
            <span>Como a API funciona</span>
            <textarea
              value={integracao.documentacao}
              onChange={(e) => setIntegracao((a) => ({ ...a, documentacao: e.target.value }))}
              maxLength={20000}
              rows={10}
              placeholder={
                'Endpoints, fluxo de autenticação, ambientes, contato técnico…\n\n' +
                'Ex.:\n' +
                'Autenticação: POST https://…/V2/Auth (client_credentials)\n' +
                'Listar apólices: POST …/historicoApolices\n' +
                'Contato: fulano@seguradora.com.br'
              }
            />
            <small>
              Fica visível para quem administra integrações. Não escreva senha, token
              ou chave aqui — use a aba Credenciais, que grava cifrado.
            </small>
          </label>
          </>
          )}

          <p className="texto-discreto">
            Salvar grava Integração, Credenciais e Documentação juntas.
          </p>

          <div className="formulario__acoes">
            {aba === 'integracao' && seguradora.integracao?.temSegredo && (
              <button
                type="button"
                className="botao botao--discreto botao--compacto"
                onClick={() => void apagarSegredo()}
                disabled={enviando}
              >
                Remover credencial
              </button>
            )}

            <button
              type="submit"
              className="botao botao--principal botao--compacto"
              disabled={enviando}
            >
              {enviando ? 'Salvando…' : 'Salvar integração'}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
