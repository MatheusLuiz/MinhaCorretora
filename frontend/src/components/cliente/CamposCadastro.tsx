/** Peças de formulário comuns ao cadastro de cliente e à correção de cadastro. */

import { useRef, useState } from 'react';

import { ApiError } from '@/lib/api';
import {
  clientesApi,
  type EmailFicha,
  type EmpresaDoCnpj,
  type SocioDoCnpj,
  type TelefoneFicha,
} from '@/lib/clientes';

export type AbaCadastro = 'dados' | 'contato' | 'endereco' | 'seguros';

/** `seguros` ausente esconde a aba de tipos de seguro; o número é quantos estão marcados. */
export function AbasCadastro({
  aba,
  aoTrocar,
  empresa,
  seguros,
}: {
  aba: AbaCadastro;
  aoTrocar: (aba: AbaCadastro) => void;
  empresa: boolean;
  seguros?: number;
}): React.JSX.Element {
  const abas: [AbaCadastro, string][] = [
    ['dados', empresa ? 'Dados da empresa' : 'Dados do cliente'],
    ['contato', 'Contato'],
    ['endereco', 'Endereço'],
    ...(seguros === undefined
      ? []
      : ([['seguros', seguros > 0 ? `Tipos de seguro (${seguros})` : 'Tipos de seguro']] as [AbaCadastro, string][])),
  ];

  return (
    <nav className="abas" aria-label="Seções do cadastro">
      {abas.map(([chave, rotulo]) => (
        <button
          key={chave}
          type="button"
          className={aba === chave ? 'abas__item abas__item--ativa' : 'abas__item'}
          onClick={() => aoTrocar(chave)}
          aria-current={aba === chave ? 'true' : undefined}
        >
          {rotulo}
        </button>
      ))}
    </nav>
  );
}

export interface LinhaResponsavel {
  chave: string;
  nome: string;
  cargo: string;
  telefone: string;
  email: string;
}

/** Em caixa alta porque é como o servidor grava — a sugestão volta igual na ficha. */
const FUNCOES_RESPONSAVEL = [
  'SÓCIO / PROPRIETÁRIO',
  'DIRETOR',
  'FINANCEIRO',
  'ADMINISTRATIVO',
  'FROTA',
  'COMPRAS',
  'RH',
  'JURÍDICO',
  'CONTADOR',
];

export const novaLinhaResponsavel = (): LinhaResponsavel => ({
  chave: `n${Date.now()}${Math.random().toString(36).slice(2, 6)}`,
  nome: '',
  cargo: '',
  telefone: '',
  email: '',
});

/** Sem linhas em branco nem campo vazio: mantém estável a comparação "mudou ou não". */
export function responsaveisParaEnviar(
  lista: LinhaResponsavel[],
): { nome: string; cargo?: string; telefone?: string; email?: string }[] {
  return lista
    .filter((r) => r.nome.trim() || r.cargo.trim() || r.telefone.trim() || r.email.trim())
    .map((r) => ({
      nome: r.nome.trim(),
      ...(r.cargo.trim() ? { cargo: r.cargo.trim() } : {}),
      ...(r.telefone.trim() ? { telefone: r.telefone.trim() } : {}),
      ...(r.email.trim() ? { email: r.email.trim() } : {}),
    }));
}

export function EditorResponsaveis({
  lista,
  aoMudar,
}: {
  lista: LinhaResponsavel[];
  aoMudar: (lista: LinhaResponsavel[]) => void;
}): React.JSX.Element {
  const mudar = (chave: string, campo: keyof Omit<LinhaResponsavel, 'chave'>, valor: string): void =>
    aoMudar(lista.map((r) => (r.chave === chave ? { ...r, [campo]: valor } : r)));

  return (
    <section className="bloco">
      <header className="bloco__cabecalho">
        <div>
          <h4>Responsáveis de contato</h4>
          <p className="texto-discreto">
            Quem responde pela empresa — dono, financeiro, frota. Cada um com telefone
            ou e-mail; o primeiro da lista é o principal.
          </p>
        </div>
      </header>

      {lista.map((r, i) => (
        <div key={r.chave} className="responsavel">
          <div className="responsavel__cabecalho">
            <strong>{i === 0 ? 'Principal' : `Responsável ${i + 1}`}</strong>
            <button
              type="button"
              className="botao botao--discreto botao--compacto"
              onClick={() => aoMudar(lista.filter((x) => x.chave !== r.chave))}
              aria-label={`Remover ${r.nome || 'responsável'}`}
            >
              Remover
            </button>
          </div>

          <div className="formulario__linha">
            <label className="campo-form">
              <span>Nome</span>
              <input
                value={r.nome}
                onChange={(e) => mudar(r.chave, 'nome', e.target.value)}
                maxLength={150}
                autoComplete="off"
              />
            </label>
            <label className="campo-form">
              <span>Cargo</span>
              <input
                value={r.cargo}
                onChange={(e) => mudar(r.chave, 'cargo', e.target.value)}
                maxLength={80}
                placeholder="Escolha ou digite"
                list="funcoes-responsavel"
                autoComplete="off"
              />
            </label>
          </div>

          <div className="formulario__linha">
            <label className="campo-form">
              <span>Telefone</span>
              <input
                type="tel"
                value={r.telefone}
                onChange={(e) => mudar(r.chave, 'telefone', e.target.value)}
                maxLength={20}
                placeholder="(41) 99999-9999"
                autoComplete="off"
              />
            </label>
            <label className="campo-form">
              <span>E-mail</span>
              <input
                type="email"
                value={r.email}
                onChange={(e) => mudar(r.chave, 'email', e.target.value)}
                maxLength={120}
                autoComplete="off"
              />
            </label>
          </div>
        </div>
      ))}

      {/* Sugestões, não lista fechada: qualquer cargo pode ser digitado. */}
      <datalist id="funcoes-responsavel">
        {FUNCOES_RESPONSAVEL.map((f) => (
          <option key={f} value={f} />
        ))}
      </datalist>

      <div>
        <button
          type="button"
          className="botao botao--discreto botao--compacto"
          onClick={() => aoMudar([...lista, novaLinhaResponsavel()])}
          disabled={lista.length >= 10}
        >
          + Adicionar responsável
        </button>
      </div>
    </section>
  );
}

export type TipoTelefone = TelefoneFicha['tipo'];
export type TipoEmail = EmailFicha['tipo'];

/** `residencial` é o fixo; `opcional` ("Outro") é o telefone alternativo. */
export const TIPOS_TELEFONE: [TipoTelefone, string][] = [
  ['celular', 'Celular'],
  ['whatsapp', 'WhatsApp'],
  ['residencial', 'Fixo'],
  ['comercial', 'Comercial'],
  ['recado', 'Recado'],
  ['opcional', 'Outro'],
];

export const TIPOS_EMAIL: [TipoEmail, string][] = [
  ['pessoal', 'Pessoal'],
  ['comercial', 'Comercial'],
  ['financeiro', 'Financeiro'],
  ['outro', 'Outro'],
];

export interface LinhaTelefone {
  chave: string;
  tipo: TipoTelefone;
  numero: string;
  observacao: string;
}

export interface LinhaEmail {
  chave: string;
  tipo: TipoEmail;
  endereco: string;
  observacao: string;
}

const novaChave = (): string => `c${Date.now()}${Math.random().toString(36).slice(2, 6)}`;

export const novaLinhaTelefone = (tipo: TipoTelefone = 'celular', numero = ''): LinhaTelefone => ({
  chave: novaChave(),
  tipo,
  numero,
  observacao: '',
});

export const novaLinhaEmail = (tipo: TipoEmail = 'pessoal', endereco = ''): LinhaEmail => ({
  chave: novaChave(),
  tipo,
  endereco,
  observacao: '',
});

export function telefonesDaFicha(lista: TelefoneFicha[] | undefined): LinhaTelefone[] {
  return (Array.isArray(lista) ? lista : []).map((t) => ({
    chave: novaChave(),
    tipo: t.tipo,
    numero: t.numero,
    observacao: t.observacao ?? '',
  }));
}

export function emailsDaFicha(lista: EmailFicha[] | undefined): LinhaEmail[] {
  return (Array.isArray(lista) ? lista : []).map((e) => ({
    chave: novaChave(),
    tipo: e.tipo,
    endereco: e.endereco,
    observacao: e.observacao ?? '',
  }));
}

export function telefonesParaEnviar(
  lista: LinhaTelefone[],
): { tipo: TipoTelefone; numero: string; observacao?: string }[] {
  return lista
    .filter((t) => t.numero.trim())
    .map((t) => ({
      tipo: t.tipo,
      numero: t.numero.trim(),
      ...(t.observacao.trim() ? { observacao: t.observacao.trim() } : {}),
    }));
}

export function emailsParaEnviar(
  lista: LinhaEmail[],
): { tipo: TipoEmail; endereco: string; observacao?: string }[] {
  return lista
    .filter((e) => e.endereco.trim())
    .map((e) => ({
      tipo: e.tipo,
      endereco: e.endereco.trim(),
      ...(e.observacao.trim() ? { observacao: e.observacao.trim() } : {}),
    }));
}

/** Leva o item para o topo da lista — o primeiro é o principal. */
function paraOTopo<T extends { chave: string }>(lista: T[], chave: string): T[] {
  const item = lista.find((x) => x.chave === chave);
  return item ? [item, ...lista.filter((x) => x.chave !== chave)] : lista;
}

/** O primeiro de cada lista é o principal: é ele que aparece na listagem e na fila de renovação. */
export function EditorContatos({
  telefones,
  emails,
  aoMudarTelefones,
  aoMudarEmails,
  titulo,
  descricao,
}: {
  telefones: LinhaTelefone[];
  emails: LinhaEmail[];
  aoMudarTelefones: (lista: LinhaTelefone[]) => void;
  aoMudarEmails: (lista: LinhaEmail[]) => void;
  titulo: string;
  descricao?: string;
}): React.JSX.Element {
  const mudarTelefone = (chave: string, campo: 'tipo' | 'numero' | 'observacao', valor: string): void =>
    aoMudarTelefones(telefones.map((t) => (t.chave === chave ? { ...t, [campo]: valor } : t)));
  const mudarEmail = (chave: string, campo: 'tipo' | 'endereco' | 'observacao', valor: string): void =>
    aoMudarEmails(emails.map((e) => (e.chave === chave ? { ...e, [campo]: valor } : e)));

  return (
    <section className="bloco">
      <header className="bloco__cabecalho">
        <div>
          <h4>{titulo}</h4>
          <p className="texto-discreto">
            {descricao ?? 'Quantos forem precisos.'} O primeiro de cada lista é o principal.
          </p>
        </div>
      </header>

      <div className="contatos">
        <span className="contatos__titulo">Telefones</span>
        {telefones.length === 0 && <p className="texto-discreto">Nenhum telefone.</p>}
        {telefones.map((t, i) => (
          <div key={t.chave} className="contato-linha">
            <select
              value={t.tipo}
              onChange={(e) => mudarTelefone(t.chave, 'tipo', e.target.value)}
              aria-label="Tipo do telefone"
            >
              {TIPOS_TELEFONE.map(([valor, rotulo]) => (
                <option key={valor} value={valor}>
                  {rotulo}
                </option>
              ))}
            </select>
            <input
              type="tel"
              value={t.numero}
              onChange={(e) => mudarTelefone(t.chave, 'numero', e.target.value)}
              placeholder="(41) 99999-9999"
              maxLength={20}
              inputMode="tel"
              autoComplete="off"
              aria-label="Número"
            />
            <input
              value={t.observacao}
              onChange={(e) => mudarTelefone(t.chave, 'observacao', e.target.value)}
              placeholder="Anotação (opcional)"
              maxLength={80}
              autoComplete="off"
              aria-label="Anotação do telefone"
            />
            <div className="contato-linha__acoes">
              {i === 0 ? (
                <span className="contato-linha__principal">Principal</span>
              ) : (
                <button
                  type="button"
                  className="botao botao--discreto botao--compacto"
                  onClick={() => aoMudarTelefones(paraOTopo(telefones, t.chave))}
                  title="Tornar este o telefone principal"
                >
                  Tornar principal
                </button>
              )}
              <button
                type="button"
                className="botao botao--discreto botao--compacto"
                onClick={() => aoMudarTelefones(telefones.filter((x) => x.chave !== t.chave))}
                aria-label={`Remover ${t.numero || 'telefone'}`}
                title="Remover"
              >
                ×
              </button>
            </div>
          </div>
        ))}
        <div>
          <button
            type="button"
            className="botao botao--discreto botao--compacto"
            onClick={() =>
              aoMudarTelefones([
                ...telefones,
                novaLinhaTelefone(telefones.length === 0 ? 'celular' : 'residencial'),
              ])
            }
            disabled={telefones.length >= 10}
          >
            + Adicionar telefone
          </button>
        </div>
      </div>

      <div className="contatos">
        <span className="contatos__titulo">E-mails</span>
        {emails.length === 0 && <p className="texto-discreto">Nenhum e-mail.</p>}
        {emails.map((m, i) => (
          <div key={m.chave} className="contato-linha">
            <select
              value={m.tipo}
              onChange={(e) => mudarEmail(m.chave, 'tipo', e.target.value)}
              aria-label="Tipo do e-mail"
            >
              {TIPOS_EMAIL.map(([valor, rotulo]) => (
                <option key={valor} value={valor}>
                  {rotulo}
                </option>
              ))}
            </select>
            <input
              type="email"
              value={m.endereco}
              onChange={(e) => mudarEmail(m.chave, 'endereco', e.target.value)}
              placeholder="nome@exemplo.com"
              maxLength={120}
              autoComplete="off"
              aria-label="E-mail"
            />
            <input
              value={m.observacao}
              onChange={(e) => mudarEmail(m.chave, 'observacao', e.target.value)}
              placeholder="Anotação (opcional)"
              maxLength={80}
              autoComplete="off"
              aria-label="Anotação do e-mail"
            />
            <div className="contato-linha__acoes">
              {i === 0 ? (
                <span className="contato-linha__principal">Principal</span>
              ) : (
                <button
                  type="button"
                  className="botao botao--discreto botao--compacto"
                  onClick={() => aoMudarEmails(paraOTopo(emails, m.chave))}
                  title="Tornar este o e-mail principal"
                >
                  Tornar principal
                </button>
              )}
              <button
                type="button"
                className="botao botao--discreto botao--compacto"
                onClick={() => aoMudarEmails(emails.filter((x) => x.chave !== m.chave))}
                aria-label={`Remover ${m.endereco || 'e-mail'}`}
                title="Remover"
              >
                ×
              </button>
            </div>
          </div>
        ))}
        <div>
          <button
            type="button"
            className="botao botao--discreto botao--compacto"
            onClick={() =>
              aoMudarEmails([...emails, novaLinhaEmail(emails.length === 0 ? 'pessoal' : 'comercial')])
            }
            disabled={emails.length >= 5}
          >
            + Adicionar e-mail
          </button>
        </div>
      </div>
    </section>
  );
}

export interface CamposEndereco {
  logradouro: string;
  numero: string;
  complemento: string;
  bairro: string;
  cidade: string;
  uf: string;
  cep: string;
}

export const UFS = [
  'AC', 'AL', 'AM', 'AP', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MG', 'MS', 'MT',
  'PA', 'PB', 'PE', 'PI', 'PR', 'RJ', 'RN', 'RO', 'RR', 'RS', 'SC', 'SE', 'SP', 'TO',
];

/** O endereço inteiro — é gravado inteiro, nunca campo a campo. */
export function EditorEndereco({
  endereco,
  aoMudar,
}: {
  endereco: CamposEndereco;
  aoMudar: (campo: keyof CamposEndereco, valor: string) => void;
}): React.JSX.Element {
  const consulta = useConsultaCep(aoMudar);

  return (
    <section className="bloco">
      <header className="bloco__cabecalho">
        <div>
          <h4>Endereço</h4>
          <p className="texto-discreto">
            Gravado inteiro: trocar a rua e manter o número antigo produziria um
            endereço que não existe.
          </p>
        </div>
      </header>

      <div className="formulario__linha formulario__linha--cep">
        <label className="campo-form">
          <span>CEP</span>
          <input
            value={endereco.cep}
            onChange={(e) => {
              aoMudar('cep', e.target.value);
              consulta.aoDigitar(e.target.value);
            }}
            inputMode="numeric"
            maxLength={9}
            placeholder="00000-000"
            autoComplete="off"
            aria-describedby="cep-situacao"
          />
        </label>
        <p
          id="cep-situacao"
          className={`cep-situacao cep-situacao--${consulta.estado.tipo}`}
          aria-live="polite"
        >
          {consulta.estado.tipo === 'ocioso' && 'Digite o CEP para preencher rua, bairro e cidade.'}
          {consulta.estado.tipo === 'buscando' && 'Buscando o endereço…'}
          {consulta.estado.tipo === 'preenchido' &&
            'Preenchido pelo CEP. Confira e informe o número.'}
          {consulta.estado.tipo === 'falha' && consulta.estado.mensagem}
        </p>
      </div>

      <div className="formulario__linha formulario__linha--endereco">
        <label className="campo-form">
          <span>Logradouro</span>
          <input
            value={endereco.logradouro}
            onChange={(e) => aoMudar('logradouro', e.target.value)}
            maxLength={150}
            placeholder="Rua, avenida…"
            autoComplete="off"
          />
        </label>
        <label className="campo-form">
          <span>Número</span>
          <input
            value={endereco.numero}
            onChange={(e) => aoMudar('numero', e.target.value)}
            maxLength={10}
            autoComplete="off"
          />
        </label>
      </div>

      <div className="formulario__linha">
        <label className="campo-form">
          <span>Complemento</span>
          <input
            value={endereco.complemento}
            onChange={(e) => aoMudar('complemento', e.target.value)}
            maxLength={60}
            autoComplete="off"
          />
        </label>
        <label className="campo-form">
          <span>Bairro</span>
          <input
            value={endereco.bairro}
            onChange={(e) => aoMudar('bairro', e.target.value)}
            maxLength={60}
            autoComplete="off"
          />
        </label>
      </div>

      <div className="formulario__linha formulario__linha--cidade">
        <label className="campo-form">
          <span>Cidade</span>
          <input
            value={endereco.cidade}
            onChange={(e) => aoMudar('cidade', e.target.value)}
            maxLength={80}
            autoComplete="off"
          />
        </label>
        <label className="campo-form">
          <span>UF</span>
          <select value={endereco.uf} onChange={(e) => aoMudar('uf', e.target.value)}>
            <option value="">—</option>
            {UFS.map((u) => (
              <option key={u} value={u}>
                {u}
              </option>
            ))}
          </select>
        </label>
      </div>

      {endereco.cidade.trim() && !endereco.uf && (
        <p className="alerta alerta--aviso">
          Informe a UF junto da cidade — sem ela o município não é identificado.
        </p>
      )}
    </section>
  );
}

type EstadoCep =
  | { tipo: 'ocioso' }
  | { tipo: 'buscando' }
  | { tipo: 'preenchido' }
  | { tipo: 'falha'; mensagem: string };

/**
 * Dispara pelo `onChange`, não por efeito sobre o valor: abrir um cliente que
 * já tem CEP não pode reescrever a rua que alguém acertou à mão.
 */
function useConsultaCep(aoMudar: (campo: keyof CamposEndereco, valor: string) => void): {
  estado: EstadoCep;
  aoDigitar: (valor: string) => void;
} {
  const [estado, setEstado] = useState<EstadoCep>({ tipo: 'ocioso' });
  // Resposta de um CEP anterior que chegue atrasada é descartada.
  const pedido = useRef<string | null>(null);

  function aoDigitar(valor: string): void {
    const digitos = valor.replace(/\D/g, '');
    if (digitos.length !== 8) {
      pedido.current = null;
      setEstado({ tipo: 'ocioso' });
      return;
    }
    if (digitos === pedido.current) return;

    pedido.current = digitos;
    setEstado({ tipo: 'buscando' });

    clientesApi
      .consultarCep(digitos)
      .then(({ endereco }) => {
        if (pedido.current !== digitos) return;
        aoMudar('cep', endereco.cep);
        if (endereco.logradouro) aoMudar('logradouro', endereco.logradouro);
        if (endereco.bairro) aoMudar('bairro', endereco.bairro);
        if (endereco.cidade) aoMudar('cidade', endereco.cidade);
        if (endereco.uf) aoMudar('uf', endereco.uf);
        setEstado({ tipo: 'preenchido' });
      })
      .catch((erro: unknown) => {
        if (pedido.current !== digitos) return;
        const mensagem =
          erro instanceof ApiError
            ? erro.status === 404
              ? 'CEP não encontrado. Confira o número ou preencha o endereço à mão.'
              : erro.message
            : 'A consulta de CEP não respondeu. Preencha o endereço à mão.';
        setEstado({ tipo: 'falha', mensagem });
      });
  }

  return { estado, aoDigitar };
}

export type EstadoCnpj =
  | { tipo: 'ocioso' }
  | { tipo: 'buscando' }
  | { tipo: 'encontrado'; empresa: EmpresaDoCnpj }
  | { tipo: 'falha'; mensagem: string };

/** Mesmo desenho do CEP: dispara pelo `onChange` e descarta resposta de número já trocado. */
export function useConsultaCnpj(aoEncontrar: (empresa: EmpresaDoCnpj) => void): {
  estado: EstadoCnpj;
  aoDigitar: (digitos: string, valido: boolean) => void;
  limpar: () => void;
} {
  const [estado, setEstado] = useState<EstadoCnpj>({ tipo: 'ocioso' });
  const pedido = useRef<string | null>(null);

  function limpar(): void {
    pedido.current = null;
    setEstado({ tipo: 'ocioso' });
  }

  function aoDigitar(digitos: string, valido: boolean): void {
    if (digitos.length !== 14 || !valido) {
      limpar();
      return;
    }
    if (digitos === pedido.current) return;

    pedido.current = digitos;
    setEstado({ tipo: 'buscando' });

    clientesApi
      .consultarCnpj(digitos)
      .then(({ empresa }) => {
        if (pedido.current !== digitos) return;
        aoEncontrar(empresa);
        setEstado({ tipo: 'encontrado', empresa });
      })
      .catch((erro: unknown) => {
        if (pedido.current !== digitos) return;
        setEstado({
          tipo: 'falha',
          mensagem:
            erro instanceof ApiError
              ? erro.message
              : 'A consulta de CNPJ não respondeu. Preencha os dados à mão.',
        });
      });
  }

  return { estado, aoDigitar, limpar };
}

/** Sugestão, nunca inclusão automática: sócio não é necessariamente com quem a corretora fala. */
export function SociosDaReceita({
  socios,
  jaIncluidos,
  aoIncluir,
}: {
  socios: SocioDoCnpj[];
  jaIncluidos: string[];
  aoIncluir: (socio: SocioDoCnpj) => void;
}): React.JSX.Element | null {
  const pessoas = socios.filter((s) => !s.pessoaJuridica);
  if (pessoas.length === 0) return null;

  const incluidos = new Set(jaIncluidos.map((n) => n.trim().toUpperCase()));

  return (
    <section className="bloco">
      <header className="bloco__cabecalho">
        <div>
          <h4>Sócios na Receita</h4>
          <p className="texto-discreto">
            Entram como responsável sem telefone nem e-mail — a Receita não informa. Complete
            antes de salvar.
          </p>
        </div>
      </header>

      <ul className="socios-receita">
        {pessoas.map((s) => {
          const jaEsta = incluidos.has(s.nome.toUpperCase());
          return (
            <li key={s.nome}>
              <span>
                <strong>{s.nome}</strong>
                {s.qualificacao && <span className="texto-discreto"> · {s.qualificacao}</span>}
              </span>
              <button
                type="button"
                className="botao botao--discreto botao--compacto"
                onClick={() => aoIncluir(s)}
                disabled={jaEsta}
              >
                {jaEsta ? 'Incluído' : 'Incluir'}
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
