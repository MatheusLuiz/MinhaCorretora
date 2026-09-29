import { useEffect, useState } from 'react';

import {
  AbasCadastro,
  EditorContatos,
  EditorEndereco,
  EditorResponsaveis,
  emailsDaFicha,
  emailsParaEnviar,
  responsaveisParaEnviar,
  telefonesDaFicha,
  telefonesParaEnviar,
  type AbaCadastro,
  type CamposEndereco,
  type LinhaEmail,
  type LinhaResponsavel,
  type LinhaTelefone,
} from '@/components/cliente/CamposCadastro';
import { ApiError } from '@/lib/api';
import { clientesApi, type ClienteCompleto, type EdicaoDeCliente } from '@/lib/clientes';
import { gruposClienteApi, type GrupoCliente } from '@/lib/gruposCliente';

/*
 * Manda só o DELTA: enviar tudo poderia apagar um campo que ficou vazio na
 * tela por outro motivo. Endereço e listas vão inteiros quando mudam.
 * CPF/CNPJ não se edita: é a chave que liga a apólice ao dono.
 */

type Campos = Pick<EdicaoDeCliente, 'nome' | 'dataNascimento' | 'sexo' | 'grupoCliente'>;

function valoresIniciais(c: ClienteCompleto): Campos {
  return {
    nome: c.nome ?? '',
    dataNascimento: c.dataNascimento ?? '',
    sexo: c.sexo === 'M' || c.sexo === 'F' ? c.sexo : undefined,
    grupoCliente: c.grupoCliente?.chave,
  };
}

function enderecoInicial(c: ClienteCompleto): CamposEndereco {
  const e = c.enderecos.find((x) => x.tipo === 'principal') ?? c.enderecos[0];
  return {
    logradouro: e?.logradouro ?? '',
    numero: e?.numero ?? '',
    complemento: e?.complemento ?? '',
    bairro: e?.bairro ?? '',
    cidade: e?.cidade ?? '',
    uf: e?.uf ?? '',
    cep: e?.cep ?? '',
  };
}

export function EdicaoCliente({
  cliente,
  aoSalvar,
  aoCancelar,
}: {
  cliente: ClienteCompleto;
  aoSalvar: (atualizado: ClienteCompleto) => void;
  aoCancelar: () => void;
}): React.JSX.Element {
  const empresa = cliente.tipoPessoa === 'Jurídica';

  const [aba, setAba] = useState<AbaCadastro>('dados');
  const [inicial] = useState<Campos>(() => valoresIniciais(cliente));
  const [campos, setCampos] = useState<Campos>(inicial);
  const [enderecoOriginal] = useState<CamposEndereco>(() => enderecoInicial(cliente));
  const [endereco, setEndereco] = useState<CamposEndereco>(enderecoOriginal);
  const [responsaveisOriginais] = useState<LinhaResponsavel[]>(() =>
    (Array.isArray(cliente.responsaveis) ? cliente.responsaveis : []).map((r, i) => ({
      chave: `r${i}`,
      nome: r.nome,
      cargo: r.cargo ?? '',
      telefone: r.telefone ?? '',
      email: r.email ?? '',
    })),
  );
  const [responsaveis, setResponsaveis] = useState<LinhaResponsavel[]>(responsaveisOriginais);
  // As listas completas: ler só o principal faria o salvar apagar o resto.
  const [telefonesOriginais] = useState<LinhaTelefone[]>(() => telefonesDaFicha(cliente.telefones));
  const [telefones, setTelefones] = useState<LinhaTelefone[]>(telefonesOriginais);
  const [emailsOriginais] = useState<LinhaEmail[]>(() => emailsDaFicha(cliente.emails));
  const [emails, setEmails] = useState<LinhaEmail[]>(emailsOriginais);
  const [salvando, setSalvando] = useState(false);
  const [erros, setErros] = useState<string[]>([]);
  // Só os ativos, mais o do cliente mesmo inativo (para o campo mostrá-lo).
  const [grupos, setGrupos] = useState<GrupoCliente[]>([]);

  useEffect(() => {
    // Backend anterior não manda o grupo: o campo nem aparece.
    if (!cliente.grupoCliente) return;
    let vivo = true;
    gruposClienteApi
      .listar()
      .then(({ grupos: lista }) => {
        if (vivo) setGrupos(lista.filter((g) => g.ativo || g.chave === cliente.grupoCliente?.chave));
      })
      .catch(() => {
        // Sem a lista, só o grupo deixa de ser editável.
      });
    return () => {
      vivo = false;
    };
  }, [cliente.grupoCliente]);

  const mudar = (campo: keyof Campos, valor: string): void => {
    setCampos((atual) => ({ ...atual, [campo]: valor }));
  };

  const delta = (): Campos => {
    const saida: Record<string, unknown> = {};
    for (const chave of Object.keys(campos) as (keyof Campos)[]) {
      if (campos[chave] !== inicial[chave]) saida[chave] = campos[chave];
    }
    return saida as Campos;
  };

  const mudouEndereco = JSON.stringify(endereco) !== JSON.stringify(enderecoOriginal);
  const mudouResponsaveis =
    empresa &&
    JSON.stringify(responsaveisParaEnviar(responsaveis)) !==
      JSON.stringify(responsaveisParaEnviar(responsaveisOriginais));

  const mudouTelefones =
    JSON.stringify(telefonesParaEnviar(telefones)) !==
    JSON.stringify(telefonesParaEnviar(telefonesOriginais));
  const mudouEmails =
    JSON.stringify(emailsParaEnviar(emails)) !== JSON.stringify(emailsParaEnviar(emailsOriginais));

  const mudou =
    Object.keys(delta()).length > 0 ||
    mudouEndereco ||
    mudouResponsaveis ||
    mudouTelefones ||
    mudouEmails;

  async function enviar(evento: React.FormEvent): Promise<void> {
    evento.preventDefault();
    if (!mudou || salvando) return;

    setSalvando(true);
    setErros([]);

    try {
      const { cliente: atualizado } = await clientesApi.editar(cliente.id, {
        ...delta(),
        ...(mudouEndereco ? { ...endereco, uf: endereco.uf.toUpperCase() } : {}),
        ...(mudouResponsaveis ? { responsaveis: responsaveisParaEnviar(responsaveis) } : {}),
        ...(mudouTelefones ? { telefones: telefonesParaEnviar(telefones) } : {}),
        ...(mudouEmails ? { emails: emailsParaEnviar(emails) } : {}),
      });
      aoSalvar(atualizado);
    } catch (erro) {
      const api = erro instanceof ApiError ? erro : null;
      setErros(
        api?.mensagensDeValidacao.length
          ? api.mensagensDeValidacao
          : [api?.message ?? 'Não foi possível salvar. Tente de novo.'],
      );
    } finally {
      setSalvando(false);
    }
  }

  return (
    <>
      <header className="ficha-cliente__topo">
        <div>
          <span className="ficha-cliente__tipo">Corrigindo cadastro</span>
          <h2>{cliente.nome}</h2>
          <p>{cliente.cpfCnpj}</p>
        </div>

        <button
          type="button"
          className="ficha-cliente__fechar"
          onClick={aoCancelar}
          disabled={salvando}
          aria-label="Cancelar a correção"
          title="Cancelar a correção"
        >
          ×
        </button>
      </header>

      <AbasCadastro aba={aba} aoTrocar={setAba} empresa={empresa} />

      <div className="ficha-cliente__corpo">
        <form className="formulario" onSubmit={(e) => void enviar(e)}>
          {erros.length > 0 && (
            <div className="alerta alerta--erro" role="alert">
              {erros.map((e) => (
                <p key={e}>{e}</p>
              ))}
            </div>
          )}

          {aba === 'dados' && (
            <section className="bloco">
              <header className="bloco__cabecalho">
                <h4>{empresa ? 'Dados da empresa' : 'Dados do cliente'}</h4>
              </header>

              <label className="campo-form">
                <span>{empresa ? 'Razão social' : 'Nome'}</span>
                <input
                  type="text"
                  value={campos.nome ?? ''}
                  onChange={(e) => mudar('nome', e.target.value)}
                  maxLength={150}
                  required
                  autoFocus
                />
              </label>

              <div className="formulario__linha">
                <label className="campo-form">
                  <span>
                    {empresa ? 'CNPJ' : 'CPF'} <em>não se edita</em>
                  </span>
                  <input type="text" value={cliente.cpfCnpj} readOnly disabled />
                </label>

                <label className="campo-form">
                  <span>{empresa ? 'Data de abertura' : 'Nascimento'}</span>
                  <input
                    type="date"
                    value={campos.dataNascimento ?? ''}
                    onChange={(e) => mudar('dataNascimento', e.target.value)}
                  />
                </label>
              </div>

              <div className="formulario__linha">
                {!empresa && (
                  <label className="campo-form">
                    <span>Sexo</span>
                    <select value={campos.sexo ?? ''} onChange={(e) => mudar('sexo', e.target.value)}>
                      <option value="">—</option>
                      <option value="F">Feminino</option>
                      <option value="M">Masculino</option>
                    </select>
                  </label>
                )}

                {grupos.length > 0 && (
                  <label className="campo-form">
                    <span>Grupo de cliente</span>
                    <select
                      value={campos.grupoCliente ?? ''}
                      onChange={(e) => mudar('grupoCliente', e.target.value)}
                      title="De onde o cliente veio: Corretora, Seguradora…"
                    >
                      {grupos.map((g) => (
                        <option key={g.chave} value={g.chave}>
                          {g.nome}
                          {!g.ativo && ' (inativo)'}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
              </div>
            </section>
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

              {empresa && <EditorResponsaveis lista={responsaveis} aoMudar={setResponsaveis} />}
            </>
          )}

          {aba === 'endereco' && (
            <EditorEndereco
              endereco={endereco}
              aoMudar={(campo, valor) => setEndereco((antes) => ({ ...antes, [campo]: valor }))}
            />
          )}

          <p className="texto-discreto">
            Deixar um campo em branco <strong>apaga</strong> o valor. Salvar grava as três
            abas juntas.
          </p>

          <div className="formulario__acoes">
            <button
              type="button"
              className="botao botao--discreto botao--compacto"
              onClick={aoCancelar}
              disabled={salvando}
            >
              Cancelar
            </button>
            <button
              type="submit"
              className="botao botao--principal botao--compacto"
              disabled={!mudou || salvando}
            >
              {salvando ? 'Salvando…' : 'Salvar'}
            </button>
          </div>
        </form>
      </div>
    </>
  );
}
