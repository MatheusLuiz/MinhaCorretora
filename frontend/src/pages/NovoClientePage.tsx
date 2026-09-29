import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';

import {
  AbasCadastro,
  EditorContatos,
  EditorEndereco,
  EditorResponsaveis,
  emailsParaEnviar,
  novaLinhaEmail,
  novaLinhaResponsavel,
  novaLinhaTelefone,
  responsaveisParaEnviar,
  telefonesParaEnviar,
  SociosDaReceita,
  useConsultaCnpj,
  type AbaCadastro,
  type CamposEndereco,
  type LinhaEmail,
  type LinhaResponsavel,
  type LinhaTelefone,
} from '@/components/cliente/CamposCadastro';
import { CabecalhoPainel } from '@/components/Painel';
import { useAuth } from '@/hooks/useAuth';
import { useCliente } from '@/hooks/useCliente';
import { ApiError } from '@/lib/api';
import { SeletorTiposSeguro } from '@/components/cliente/SeletorTiposSeguro';
import { clientesApi, type Corretor, type EmpresaDoCnpj, type FiltrosDisponiveis } from '@/lib/clientes';
import { documentoValido } from '@/lib/documento';
import { tiposSeguroApi, type TipoSeguro } from '@/lib/tiposSeguro';

/**
 * Cadastro manual de cliente. O documento é validado no dígito porque é a chave
 * natural: um CPF errado cria um cadastro paralelo da mesma pessoa.
 */
export function NovoClientePage(): React.JSX.Element {
  const { temPermissao } = useAuth();
  const { abrir } = useCliente();
  const navegar = useNavigate();

  const podeGerenciar = temPermissao('clientes.gerenciar');

  const [aba, setAba] = useState<AbaCadastro>('dados');
  const [filtros, setFiltros] = useState<FiltrosDisponiveis | null>(null);
  // Perfil que vê a base inteira escolhe o corretor; o comum vê o próprio nome.
  const [corretores, setCorretores] = useState<{
    atual: Corretor;
    podeEscolher: boolean;
    corretores: Corretor[];
  } | null>(null);
  const [tiposSeguro, setTiposSeguro] = useState<TipoSeguro[]>([]);
  const [enviando, setEnviando] = useState(false);
  const [erros, setErros] = useState<string[]>([]);
  const [criado, setCriado] = useState<{ id: string; nome: string; situacao: string | null } | null>(
    null,
  );

  const [form, setForm] = useState(vazio);
  const [endereco, setEndereco] = useState<CamposEndereco>(enderecoVazio);
  const [responsaveis, setResponsaveis] = useState<LinhaResponsavel[]>([]);
  const [telefones, setTelefones] = useState<LinhaTelefone[]>(() => [novaLinhaTelefone('celular')]);
  const [emails, setEmails] = useState<LinhaEmail[]>(() => [novaLinhaEmail('pessoal')]);

  const definir = <C extends keyof typeof form>(campo: C, valor: (typeof form)[C]): void =>
    setForm((f) => ({ ...f, [campo]: valor }));

  // O que a última consulta de CNPJ escreveu: a Receita só sobrescreve campo vazio
  // ou o valor que ela mesma pôs — nunca o que a pessoa digitou.
  const preenchidoPelaReceita = useRef<Record<string, string>>({});

  function preencherPelaReceita(e: EmpresaDoCnpj): void {
    const anterior = preenchidoPelaReceita.current;
    const trocavel = (chave: string, atual: string): boolean =>
      !atual.trim() || atual === anterior[chave];

    const cep = e.endereco.cep?.replace(/\D/g, '') ?? '';

    const dados: Record<string, string> = {
      nome: e.razaoSocial,
      dataNascimento: e.dataAbertura ?? '',
    };
    const local: Record<string, string> = {
      logradouro: e.endereco.logradouro ?? '',
      numero: e.endereco.numero ?? '',
      complemento: e.endereco.complemento ?? '',
      bairro: e.endereco.bairro ?? '',
      cidade: e.endereco.cidade ?? '',
      uf: e.endereco.uf ?? '',
      cep: cep.length === 8 ? `${cep.slice(0, 5)}-${cep.slice(5)}` : '',
    };

    setForm((f) => {
      const novo: Record<string, unknown> = { ...f };
      for (const [k, v] of Object.entries(dados)) {
        if (trocavel(k, String(novo[k] ?? ''))) novo[k] = v;
      }
      return novo as typeof f;
    });
    setEndereco((atual) => {
      const novo = { ...atual };
      for (const [k, v] of Object.entries(local) as [keyof CamposEndereco, string][]) {
        if (trocavel(k, novo[k])) novo[k] = v;
      }
      return novo;
    });

    // Mesma regra para as listas: só troca se vazia ou igual à da consulta anterior.
    const telefonesReceita = e.telefones.map((t) =>
      novaLinhaTelefone(ehCelular(t) ? 'celular' : 'comercial', formatarTelefone(t)),
    );
    const emailsReceita = e.email ? [novaLinhaEmail('comercial', e.email)] : [];
    const assinatura = (lista: { tipo: string; numero?: string; endereco?: string }[]): string =>
      JSON.stringify(lista.map((x) => [x.tipo, x.numero ?? x.endereco]));

    setTelefones((atual) => {
      const agora = telefonesParaEnviar(atual);
      if (agora.length > 0 && assinatura(agora) !== anterior.telefones) return atual;
      return telefonesReceita.length > 0 ? telefonesReceita : [novaLinhaTelefone('celular')];
    });
    setEmails((atual) => {
      const agora = emailsParaEnviar(atual);
      if (agora.length > 0 && assinatura(agora) !== anterior.emails) return atual;
      return emailsReceita.length > 0 ? emailsReceita : [novaLinhaEmail('comercial')];
    });

    preenchidoPelaReceita.current = {
      ...dados,
      ...local,
      telefones: assinatura(telefonesParaEnviar(telefonesReceita)),
      emails: assinatura(emailsParaEnviar(emailsReceita)),
    };
  }

  const consultaCnpj = useConsultaCnpj(preencherPelaReceita);
  const empresaReceita =
    consultaCnpj.estado.tipo === 'encontrado' ? consultaCnpj.estado.empresa : null;

  useEffect(() => {
    document.title = 'Novo cliente — MinhaCorretora';
  }, []);

  useEffect(() => {
    void clientesApi.filtros().then(setFiltros).catch(() => {
    });
  }, []);

  useEffect(() => {
    void clientesApi.corretores().then(setCorretores).catch(() => setCorretores(null));
    void tiposSeguroApi
      .listar()
      .then((r) => setTiposSeguro(r.tipos.filter((t) => t.ativo)))
      .catch(() => setTiposSeguro([]));
  }, []);

  const documentoLimpo = form.cpfCnpj.replace(/\D/g, '');
  const documentoOk = documentoValido(documentoLimpo);
  const empresa = documentoLimpo.length === 14;

  // Documento já cadastrado bloqueia logo; o servidor e a chave única conferem de novo.
  const [jaCadastrado, setJaCadastrado] = useState<{ documento: string; nome: string; id: string | null } | null>(null);
  useEffect(() => {
    if (!documentoOk) return;
    let atual = true;
    void clientesApi
      .verificarDocumento(documentoLimpo)
      .then((r) => {
        if (atual) setJaCadastrado(r.existe ? { documento: documentoLimpo, nome: r.nome, id: r.id } : null);
      })
      .catch(() => undefined);
    return () => {
      atual = false;
    };
  }, [documentoOk, documentoLimpo]);
  const duplicado = jaCadastrado && jaCadastrado.documento === documentoLimpo ? jaCadastrado : null;

  const podeEnviar = documentoOk && !duplicado && form.nome.trim().length >= 2 && !enviando;

  function limparTudo(manter?: Partial<typeof vazio>): void {
    setForm({ ...vazio, ...manter });
    setEndereco(enderecoVazio);
    setResponsaveis([]);
    setTelefones([novaLinhaTelefone('celular')]);
    setEmails([novaLinhaEmail('pessoal')]);
    setAba('dados');
    preenchidoPelaReceita.current = {};
    consultaCnpj.limpar();
  }

  async function enviar(evento: FormEvent): Promise<void> {
    evento.preventDefault();
    // O Enter submete o formulário sem passar pelo botão desabilitado.
    if (!podeEnviar) return;
    setErros([]);
    setEnviando(true);

    // Campo vazio não vai: string vazia reprovaria a validação de e-mail no schema.
    const corpo: Record<string, unknown> = {
      cpfCnpj: form.cpfCnpj,
      nome: form.nome.trim(),
      situacao: form.situacao,
      autorizaContato: form.autorizaContato,
      vip: form.vip,
    };

    const simples = empresa
      ? (['dataNascimento', 'origemCliente'] as const)
      : (['dataNascimento', 'sexo', 'profissao', 'origemCliente'] as const);

    for (const chave of simples) {
      const valor = String(form[chave]).trim();
      if (valor) corpo[chave] = valor;
    }

    if (form.corretor) corpo.corretor = form.corretor;
    if (form.tiposSeguro.length > 0) corpo.tiposSeguro = form.tiposSeguro;

    const listaTelefones = telefonesParaEnviar(telefones);
    const listaEmails = emailsParaEnviar(emails);
    if (listaTelefones.length > 0) corpo.telefones = listaTelefones;
    if (listaEmails.length > 0) corpo.emails = listaEmails;

    for (const [chave, valor] of Object.entries(endereco)) {
      if (valor.trim()) corpo[chave] = chave === 'uf' ? valor.trim().toUpperCase() : valor.trim();
    }

    if (empresa) {
      const lista = responsaveisParaEnviar(responsaveis);
      if (lista.length > 0) corpo.responsaveis = lista;
    }

    try {
      const resposta = await clientesApi.criar(corpo);
      setCriado(resposta.cliente);
    } catch (falha) {
      if (falha instanceof ApiError) {
        const detalhes = falha.mensagensDeValidacao;
        setErros(detalhes.length > 0 ? detalhes : [falha.message]);
      } else {
        setErros(['Não foi possível cadastrar. Verifique sua conexão.']);
      }
    } finally {
      setEnviando(false);
    }
  }

  if (!podeGerenciar) {
    return (
      <div className="painel">
        <CabecalhoPainel titulo="Novo cliente" />
        <p className="alerta alerta--aviso">
          Seu perfil pode consultar clientes, mas não cadastrar. Peça a permissão{' '}
          <code>clientes.gerenciar</code> ao administrador.
        </p>
      </div>
    );
  }

  if (criado) {
    return (
      <div className="painel">
        <CabecalhoPainel titulo="Cliente cadastrado" />

        <section className="cartao cartao--inteiro">
          <div className="cartao__corpo">
            <p className="alerta alerta--ok">
              <strong>{criado.nome}</strong> foi cadastrado
              {criado.situacao ? ` como ${criado.situacao.toLowerCase()}` : ''}.
            </p>

            <div className="barra-filtros">
              <button
                type="button"
                className="botao botao--principal botao--compacto"
                onClick={() => abrir(criado.id)}
              >
                Abrir a ficha
              </button>

              <button
                type="button"
                className="botao botao--discreto botao--compacto"
                onClick={() => {
                  setCriado(null);
                  limparTudo({
                    situacao: form.situacao,
                    corretor: form.corretor,
                    origemCliente: form.origemCliente,
                  });
                }}
              >
                Cadastrar outro
              </button>

              <button
                type="button"
                className="botao botao--discreto botao--compacto"
                onClick={() => navegar('/clientes')}
              >
                Ir para a lista
              </button>
            </div>
          </div>
        </section>
      </div>
    );
  }

  return (
    <div className="painel">
      <CabecalhoPainel
        titulo={empresa ? 'Nova empresa' : 'Novo cliente'}
        descricao="Para poucos cadastros. Em volume, use Importar arquivos."
      />

      <form onSubmit={(e) => void enviar(e)} noValidate>
        {erros.length > 0 && (
          <div className="alerta alerta--erro" role="alert" aria-live="assertive">
            {erros.map((m) => (
              <p key={m}>{m}</p>
            ))}
          </div>
        )}

        <section className="cartao cartao--inteiro">
          <div className="cartao__corpo cadastro-abas">
            <AbasCadastro aba={aba} aoTrocar={setAba} empresa={empresa} seguros={form.tiposSeguro.length} />

            <div className="formulario">
              {aba === 'dados' && (
                <>
                  <section className="bloco">
                    <header className="bloco__cabecalho">
                      <div>
                        <h4>{empresa ? 'Dados da empresa' : 'Dados do cliente'}</h4>
                        <p className="texto-discreto">
                          CPF ou CNPJ e nome são obrigatórios. Com CNPJ, o cadastro vira de
                          empresa.
                        </p>
                      </div>
                    </header>

                    <div className="formulario__linha">
                      <label className="campo-form">
                        <span>
                          CPF ou CNPJ <em>obrigatório</em>
                        </span>
                        <input
                          value={form.cpfCnpj}
                          onChange={(e) => {
                            definir('cpfCnpj', e.target.value);
                            const digitos = e.target.value.replace(/\D/g, '');
                            consultaCnpj.aoDigitar(digitos, documentoValido(digitos));
                          }}
                          placeholder="000.000.000-00"
                          inputMode="numeric"
                          autoComplete="off"
                          autoFocus
                          aria-invalid={documentoLimpo.length > 0 && !documentoOk}
                        />
                        {/* Só reclama com tamanho de documento: "inválido" no terceiro dígito é ruído. */}
                        {documentoLimpo.length >= 11 && !documentoOk && (
                          <small className="campo__erro">
                            Dígito verificador não confere. Confira o número.
                          </small>
                        )}
                        {documentoOk && !duplicado && (
                          <small className="campo__ok">
                            {empresa ? 'CNPJ válido — pessoa jurídica' : 'CPF válido — pessoa física'}
                          </small>
                        )}
                        {empresa && consultaCnpj.estado.tipo === 'buscando' && (
                          <small className="texto-discreto">Buscando a empresa na Receita…</small>
                        )}
                        {empresa && consultaCnpj.estado.tipo === 'falha' && (
                          <small className="campo__erro">{consultaCnpj.estado.mensagem}</small>
                        )}
                        {duplicado && (
                          <small className="campo__erro" role="alert">
                            {empresa ? 'CNPJ' : 'CPF'} já cadastrado para <strong>{duplicado.nome}</strong>
                            {duplicado.id ? (
                              <>
                                {' — '}
                                <button
                                  type="button"
                                  className="botao botao--discreto botao--compacto"
                                  onClick={() => abrir(duplicado.id!)}
                                >
                                  Abrir ficha
                                </button>
                              </>
                            ) : (
                              ' (em outra carteira).'
                            )}{' '}
                            Não é possível cadastrar de novo.
                          </small>
                        )}
                      </label>

                      <label className="campo-form">
                        <span>Situação</span>
                        <select
                          value={form.situacao}
                          onChange={(e) => definir('situacao', e.target.value)}
                        >
                          {(filtros?.situacoes ?? [{ chave: 'prospecto', nome: 'Prospecto' }]).map((s) => (
                            <option key={s.chave} value={s.chave}>
                              {s.nome}
                            </option>
                          ))}
                        </select>
                      </label>
                    </div>

                    {empresa && empresaReceita && (
                      <p
                        className={
                          empresaReceita.situacao && empresaReceita.situacao !== 'ATIVA'
                            ? 'alerta alerta--aviso'
                            : 'alerta alerta--ok'
                        }
                      >
                        {empresaReceita.situacao && empresaReceita.situacao !== 'ATIVA' ? (
                          <>
                            <strong>Situação na Receita: {empresaReceita.situacao}.</strong> Confira
                            antes de cadastrar.{' '}
                          </>
                        ) : (
                          <>Dados preenchidos pela Receita — confira. </>
                        )}
                        <span className="texto-discreto">
                          {[
                            empresaReceita.nomeFantasia,
                            empresaReceita.matriz === null
                              ? null
                              : empresaReceita.matriz
                                ? 'Matriz'
                                : 'Filial',
                            empresaReceita.atividade,
                          ]
                            .filter(Boolean)
                            .join(' · ')}
                        </span>
                      </p>
                    )}

                    <label className="campo-form">
                      <span>
                        {empresa ? 'Razão social' : 'Nome completo'} <em>obrigatório</em>
                      </span>
                      <input
                        value={form.nome}
                        onChange={(e) => definir('nome', e.target.value)}
                        maxLength={150}
                        autoComplete="off"
                      />
                    </label>

                    <div className="formulario__linha">
                      <label className="campo-form">
                        <span>{empresa ? 'Data de abertura' : 'Nascimento'}</span>
                        <input
                          type="date"
                          value={form.dataNascimento}
                          onChange={(e) => definir('dataNascimento', e.target.value)}
                        />
                      </label>

                      {!empresa && (
                        <label className="campo-form">
                          <span>Sexo</span>
                          <select value={form.sexo} onChange={(e) => definir('sexo', e.target.value)}>
                            <option value="">Não informado</option>
                            <option value="F">Feminino</option>
                            <option value="M">Masculino</option>
                          </select>
                        </label>
                      )}
                    </div>

                    {!empresa && (
                      <label className="campo-form">
                        <span>Profissão</span>
                        <input
                          value={form.profissao}
                          onChange={(e) => definir('profissao', e.target.value)}
                          maxLength={120}
                        />
                      </label>
                    )}
                  </section>

                  <section className="bloco">
                    <header className="bloco__cabecalho">
                      <h4>Atendimento</h4>
                    </header>

                    <div className="formulario__linha">
                      <label className="campo-form">
                        <span>Corretor</span>
                        {corretores?.podeEscolher ? (
                          <select value={form.corretor} onChange={(e) => definir('corretor', e.target.value)}>
                            <option value="">{corretores.atual.nome} (você)</option>
                            {corretores.corretores
                              .filter((c) => c.id !== corretores.atual.id)
                              .map((c) => (
                                <option key={c.id} value={c.id}>
                                  {c.nome}
                                </option>
                              ))}
                          </select>
                        ) : (
                          <input value={corretores?.atual.nome ?? 'Você'} readOnly disabled />
                        )}
                        <small className="texto-discreto">O cliente entra na carteira deste corretor.</small>
                      </label>

                      <label className="campo-form">
                        <span>Como chegou</span>
                        <input
                          value={form.origemCliente}
                          onChange={(e) => definir('origemCliente', e.target.value)}
                          placeholder="Indicação, visita, campanha…"
                          maxLength={60}
                        />
                      </label>
                    </div>
                  </section>
                </>
              )}

              {aba === 'contato' && (
                <>
                  <EditorContatos
                    titulo={empresa ? 'Contato da empresa' : 'Contato'}
                    descricao={
                      empresa
                        ? 'Telefones e e-mails gerais da empresa; as pessoas ficam em Responsáveis, abaixo.'
                        : undefined
                    }
                    telefones={telefones}
                    emails={emails}
                    aoMudarTelefones={setTelefones}
                    aoMudarEmails={setEmails}
                  />

                  <section className="bloco">
                    <header className="bloco__cabecalho">
                      <h4>Autorizações</h4>
                    </header>

                    <label className="campo-check">
                      <input
                        type="checkbox"
                        checked={form.autorizaContato}
                        onChange={(e) => definir('autorizaContato', e.target.checked)}
                      />
                      <span>
                        {empresa ? 'A empresa autorizou' : 'O cliente autorizou'} contato para
                        campanhas e ofertas.
                        <br />
                        <span className="texto-discreto">
                          Sem esta autorização, não entra em disparo nenhum.
                        </span>
                      </span>
                    </label>

                    <label className="campo-check">
                      <input
                        type="checkbox"
                        checked={form.vip}
                        onChange={(e) => definir('vip', e.target.checked)}
                      />
                      <span>Cliente VIP</span>
                    </label>
                  </section>

                  {empresa && <EditorResponsaveis lista={responsaveis} aoMudar={setResponsaveis} />}

                  {empresa && empresaReceita && (
                    <SociosDaReceita
                      socios={empresaReceita.socios}
                      jaIncluidos={responsaveis.map((r) => r.nome)}
                      aoIncluir={(s) =>
                        setResponsaveis((lista) => [
                          ...lista,
                          {
                            ...novaLinhaResponsavel(),
                            nome: s.nome,
                            cargo: s.qualificacao?.toUpperCase() ?? '',
                          },
                        ])
                      }
                    />
                  )}
                </>
              )}

              {aba === 'seguros' && (
                <section className="bloco">
                  <header className="bloco__cabecalho">
                    <div>
                      <h4>Tipos de seguro de interesse</h4>
                      <p className="texto-discreto">
                        O que o cliente tem ou quer contratar. Marque quantos quiser; aparecem na ficha,
                        na aba Comercial.
                      </p>
                    </div>
                  </header>
                  <SeletorTiposSeguro
                    tipos={tiposSeguro}
                    selecionados={form.tiposSeguro}
                    aoMudar={(ids) => definir('tiposSeguro', ids)}
                    legenda="Tipos"
                  />
                </section>
              )}

              {aba === 'endereco' && (
                <EditorEndereco
                  endereco={endereco}
                  aoMudar={(campo, valor) => setEndereco((antes) => ({ ...antes, [campo]: valor }))}
                />
              )}

              <div className="formulario__acoes">
                <button
                  type="button"
                  className="botao botao--discreto botao--compacto"
                  onClick={() => limparTudo()}
                  disabled={enviando}
                >
                  Limpar
                </button>
                <button
                  type="submit"
                  className="botao botao--principal botao--compacto"
                  disabled={!podeEnviar}
                  title={
                    duplicado
                      ? 'Este CPF/CNPJ já está cadastrado'
                      : !podeEnviar && !enviando
                        ? 'Preencha CPF/CNPJ válido e nome na primeira aba'
                        : undefined
                  }
                >
                  {enviando ? 'Cadastrando…' : empresa ? 'Cadastrar empresa' : 'Cadastrar cliente'}
                </button>
              </div>
            </div>
          </div>
        </section>
      </form>
    </div>
  );
}

const vazio = {
  cpfCnpj: '', nome: '', situacao: 'prospecto', dataNascimento: '', sexo: '',
  profissao: '',
  corretor: '', origemCliente: '', autorizaContato: false, vip: false,
  tiposSeguro: [] as number[],
};

const enderecoVazio: CamposEndereco = {
  logradouro: '', numero: '', complemento: '', bairro: '', cidade: '', uf: '', cep: '',
};

/** Celular: 11 dígitos com o 9 depois do DDD. O resto é fixo. */
const ehCelular = (digitos: string): boolean => digitos.length === 11 && digitos[2] === '9';

/** `4133334444` → `(41) 3333-4444`. Só para exibir; o servidor grava dígitos. */
function formatarTelefone(digitos: string): string {
  const ddd = digitos.slice(0, 2);
  const resto = digitos.slice(2);
  const corte = resto.length - 4;
  return `(${ddd}) ${resto.slice(0, corte)}-${resto.slice(corte)}`;
}
