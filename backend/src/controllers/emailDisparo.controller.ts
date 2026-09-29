import type { Request, RequestHandler } from 'express';

import { env, smtpConfigurado } from '../config/env.js';
import { idDoUsuarioDaRequisicao, usuarioDaRequisicao } from '../middlewares/autenticacao.js';
import * as auditoriaRepo from '../repositories/auditoria.repository.js';
import * as caixaRepo from '../repositories/caixaEmail.repository.js';
import * as modeloRepo from '../repositories/modeloEmail.repository.js';
import type {
  CaixaInput,
  ModeloInput,
  PreviaModeloInput,
  TesteCaixaInput,
} from '../schemas/emailDisparo.schema.js';
import * as email from '../services/email.service.js';
import {
  exemplos,
  FINALIDADES,
  FINALIDADES_POR_CHAVE,
  obrigatoriasAusentes,
  renderizar,
  variaveisDesconhecidas,
  type Finalidade,
} from '../services/emailFinalidades.js';
import { AppError } from '../utils/AppError.js';
import { cifrar, decifrar, dica } from '../utils/cifra.js';
import { ipDaRequisicao, userAgentDaRequisicao } from '../utils/rede.js';

// Caixas de saída e layouts de e-mail. A senha entra e nunca sai: só `temSenha` e a dica.

/** DATETIME sem o "Z": o pool lê hora de Brasília como UTC, e com o "Z" a tela mostraria 3 h a menos. */
function horaLocal(d: Date | null): string | null {
  return d ? d.toISOString().slice(0, 19) : null;
}

function uuidDoParam(req: Request): string {
  return String(req.params.id);
}

async function auditar(req: Request, acao: string, entidadeId: string, detalhes: Record<string, unknown>): Promise<void> {
  await auditoriaRepo.registrar({
    usuarioId: await idDoUsuarioDaRequisicao(req),
    acao,
    entidade: acao.startsWith('email.caixa') ? 'caixas_email' : 'modelos_email',
    entidadeId,
    detalhes: { ...detalhes, por: usuarioDaRequisicao(req).email },
    ip: ipDaRequisicao(req),
    userAgent: userAgentDaRequisicao(req),
  });
}

function caixaPublica(c: caixaRepo.CaixaEmail): Record<string, unknown> {
  return {
    id: c.uuid,
    nome: c.nome,
    ativo: c.ativo,
    padrao: c.padrao,
    host: c.host,
    porta: c.porta,
    seguranca: c.seguranca,
    usuario: c.usuario,
    temSenha: c.senhaCifrada !== null,
    senhaDica: c.senhaDica,
    remetenteNome: c.remetenteNome,
    remetenteEmail: c.remetenteEmail,
    responderPara: c.responderPara,
    ultimoTeste: c.ultimoTesteEm
      ? { em: horaLocal(c.ultimoTesteEm), ok: c.ultimoTesteOk === true, erro: c.ultimoTesteErro }
      : null,
    atualizadoEm: horaLocal(c.atualizadoEm),
    atualizadoPor: c.atualizadoPor,
    modelos: c.modelos,
  };
}

export const listarCaixas: RequestHandler = async (_req, res, next) => {
  try {
    res.json({
      caixas: (await caixaRepo.listar()).map(caixaPublica),
      // Por onde o sistema envia quando nenhuma caixa da tela está ativa — sem
      // expor nada do .env além de "existe" e do host.
      envAlternativo: smtpConfigurado ? { host: env.SMTP_HOST } : null,
    });
  } catch (erro) {
    next(erro);
  }
};

async function gravarCaixa(req: Request, atual: caixaRepo.CaixaEmail | null): Promise<string> {
  const corpo = req.body as CaixaInput;
  if (await caixaRepo.nomeEmUso(corpo.nome, atual?.id)) {
    throw AppError.conflict(`Já existe uma caixa chamada "${corpo.nome}".`);
  }

  const senhaNova = corpo.senha?.trim() ? corpo.senha.trim() : undefined;
  const senha = corpo.removerSenha
    ? null
    : senhaNova !== undefined
      ? { cifrada: cifrar(senhaNova), dica: dica(senhaNova) }
      : undefined;

  // Ligar exige usuário com senha, ou nenhum dos dois (relay por IP).
  const vaiTerSenha = senha === undefined ? atual?.senhaCifrada != null : senha !== null;
  if (corpo.ativo && corpo.usuario && !vaiTerSenha) {
    throw AppError.unprocessable('Informe a senha de app da conta para ativar a caixa.');
  }

  const dados: caixaRepo.DadosCaixa = {
    nome: corpo.nome,
    ativo: corpo.ativo,
    padrao: corpo.padrao,
    host: corpo.host,
    porta: corpo.porta,
    seguranca: corpo.seguranca,
    usuario: corpo.usuario ?? null,
    remetenteNome: corpo.remetenteNome ?? null,
    remetenteEmail: corpo.remetenteEmail,
    responderPara: corpo.responderPara ?? null,
    senha,
    usuarioId: await idDoUsuarioDaRequisicao(req),
  };

  let uuid: string;
  if (atual) {
    await caixaRepo.atualizar(atual.id, dados);
    uuid = atual.uuid;
  } else {
    uuid = await caixaRepo.criar(dados);
  }
  email.invalidarConfiguracao();

  // Nunca a senha: só se ela mudou.
  await auditar(req, atual ? 'email.caixa_alterada' : 'email.caixa_criada', uuid, {
    nome: corpo.nome,
    ativo: corpo.ativo,
    padrao: corpo.padrao,
    host: corpo.host,
    remetente: corpo.remetenteEmail,
    senhaTrocada: senha !== undefined,
  });
  return uuid;
}

export const criarCaixa: RequestHandler = async (req, res, next) => {
  try {
    const uuid = await gravarCaixa(req, null);
    res.status(201).json({ caixa: caixaPublica((await caixaRepo.buscarPorUuid(uuid))!) });
  } catch (erro) {
    next(erro);
  }
};

export const atualizarCaixa: RequestHandler = async (req, res, next) => {
  try {
    const atual = await caixaRepo.buscarPorUuid(uuidDoParam(req));
    if (!atual) throw AppError.notFound('Caixa não encontrada.');
    await gravarCaixa(req, atual);
    res.json({ caixa: caixaPublica((await caixaRepo.buscarPorUuid(atual.uuid))!) });
  } catch (erro) {
    next(erro);
  }
};

export const excluirCaixa: RequestHandler = async (req, res, next) => {
  try {
    const atual = await caixaRepo.buscarPorUuid(uuidDoParam(req));
    if (!atual) throw AppError.notFound('Caixa não encontrada.');
    // Apagar a padrão deixaria o sistema sem caixa sem ninguém perceber:
    // escolha outra padrão antes.
    if (atual.padrao) {
      throw AppError.unprocessable('Esta é a caixa padrão. Marque outra como padrão antes de excluir.');
    }
    await caixaRepo.excluir(atual.id);
    email.invalidarConfiguracao();
    await auditar(req, 'email.caixa_excluida', atual.uuid, { nome: atual.nome, modelosQueVoltamParaAPadrao: atual.modelos });
    res.status(204).end();
  } catch (erro) {
    next(erro);
  }
};

export const testarCaixa: RequestHandler = async (req, res, next) => {
  try {
    const corpo = req.body as TesteCaixaInput;
    const gravada = corpo.id ? await caixaRepo.buscarPorUuid(corpo.id) : null;

    // Senha em branco no formulário = a gravada, como no salvar.
    let senha: string | null = corpo.senha?.trim() || null;
    if (!senha && gravada?.senhaCifrada) {
      senha = decifrar(gravada.senhaCifrada);
      if (senha === null) {
        throw AppError.unprocessable('A senha gravada não pôde ser lida (a chave de cifragem mudou). Cole a senha de app de novo.');
      }
    }
    if (corpo.usuario && !senha) {
      throw AppError.unprocessable('Informe a senha de app para testar.');
    }

    const para = corpo.para ?? usuarioDaRequisicao(req).email;
    const resultado = await email.testar(
      {
        host: corpo.host,
        porta: corpo.porta,
        tlsDireto: corpo.seguranca === 'tls',
        usuario: corpo.usuario ?? null,
        senha,
        remetenteNome: corpo.remetenteNome ?? null,
        remetenteEmail: corpo.remetenteEmail,
        responderPara: corpo.responderPara ?? null,
      },
      para,
    );

    // Só registra para a caixa GRAVADA com o mesmo servidor e usuário: rascunho não pinta a salva de verde.
    if (gravada && gravada.host === corpo.host && gravada.usuario === (corpo.usuario ?? null)) {
      await caixaRepo.registrarTeste(gravada.id, resultado.ok, resultado.ok ? null : resultado.erro);
    }

    res.json({ ...resultado, para });
  } catch (erro) {
    next(erro);
  }
};

function modeloPublico(m: modeloRepo.ModeloEmail): Record<string, unknown> {
  return {
    id: m.uuid,
    nome: m.nome,
    finalidade: m.finalidade,
    caixa: m.caixaUuid,
    caixaNome: m.caixaNome,
    assunto: m.assunto,
    corpoHtml: m.corpoHtml,
    corpoTexto: m.corpoTexto,
    usarMoldura: m.usarMoldura,
    ativo: m.ativo,
    atualizadoEm: horaLocal(m.atualizadoEm),
    atualizadoPor: m.atualizadoPor,
  };
}

function finalidade(chave: string): Finalidade {
  const f = FINALIDADES_POR_CHAVE.get(chave);
  if (!f) throw AppError.unprocessable(`Finalidade desconhecida: ${chave}.`);
  return f;
}

/** Variável que a finalidade não tem é erro de digitação; obrigatória ausente, e-mail inútil. */
function conferirVariaveis(f: Finalidade, assunto: string, html: string, texto: string | null): void {
  const desconhecidas = variaveisDesconhecidas(f, assunto, html, texto);
  if (desconhecidas.length > 0) {
    throw AppError.unprocessable(
      `Variável que "${f.rotulo}" não oferece: ${desconhecidas.map((v) => `{{${v}}}`).join(', ')}. ` +
        `Disponíveis: ${f.variaveis.map((v) => `{{${v.nome}}}`).join(', ')}.`,
    );
  }
  const ausentes = obrigatoriasAusentes(f, html, texto);
  if (ausentes.length > 0) {
    throw AppError.unprocessable(
      `O corpo precisa ter ${ausentes.map((v) => `{{${v}}}`).join(', ')} — sem isso o e-mail de "${f.rotulo}" não serve.`,
    );
  }
}

async function caixaIdDoUuid(uuid: string | null | undefined): Promise<number | null> {
  if (!uuid) return null;
  const c = await caixaRepo.buscarPorUuid(uuid);
  if (!c) throw AppError.unprocessable('A caixa escolhida não existe mais.');
  return c.id;
}

export const listarModelos: RequestHandler = async (_req, res, next) => {
  try {
    res.json({
      modelos: (await modeloRepo.listar()).map(modeloPublico),
      finalidades: FINALIDADES,
    });
  } catch (erro) {
    next(erro);
  }
};

async function gravarModelo(req: Request, atual: modeloRepo.ModeloEmail | null): Promise<string> {
  const corpo = req.body as ModeloInput;
  const f = finalidade(corpo.finalidade);
  conferirVariaveis(f, corpo.assunto, corpo.corpoHtml, corpo.corpoTexto ?? null);

  // Um ativo por finalidade do sistema: diz qual está no caminho, em vez do
  // erro de índice único do banco.
  if (corpo.ativo && f.chave !== 'livre') {
    const outro = await modeloRepo.outroAtivo(f.chave, atual?.id ?? 0);
    if (outro) {
      throw AppError.conflict(`O layout "${outro}" já está ativo para "${f.rotulo}". Desative-o antes.`);
    }
  }

  const dados: modeloRepo.DadosModelo = {
    nome: corpo.nome,
    finalidade: f.chave,
    caixaId: await caixaIdDoUuid(corpo.caixa),
    assunto: corpo.assunto,
    corpoHtml: corpo.corpoHtml,
    corpoTexto: corpo.corpoTexto ?? null,
    usarMoldura: corpo.usarMoldura,
    ativo: corpo.ativo,
    usuarioId: await idDoUsuarioDaRequisicao(req),
  };

  let uuid: string;
  if (atual) {
    await modeloRepo.atualizar(atual.id, dados);
    uuid = atual.uuid;
  } else {
    uuid = await modeloRepo.criar(dados);
  }
  await auditar(req, atual ? 'email.modelo_alterado' : 'email.modelo_criado', uuid, {
    nome: corpo.nome,
    finalidade: f.chave,
    ativo: corpo.ativo,
  });
  return uuid;
}

export const criarModelo: RequestHandler = async (req, res, next) => {
  try {
    const uuid = await gravarModelo(req, null);
    res.status(201).json({ modelo: modeloPublico((await modeloRepo.buscarPorUuid(uuid))!) });
  } catch (erro) {
    next(erro);
  }
};

export const atualizarModelo: RequestHandler = async (req, res, next) => {
  try {
    const atual = await modeloRepo.buscarPorUuid(uuidDoParam(req));
    if (!atual) throw AppError.notFound('Layout não encontrado.');
    await gravarModelo(req, atual);
    res.json({ modelo: modeloPublico((await modeloRepo.buscarPorUuid(atual.uuid))!) });
  } catch (erro) {
    next(erro);
  }
};

export const excluirModelo: RequestHandler = async (req, res, next) => {
  try {
    const atual = await modeloRepo.buscarPorUuid(uuidDoParam(req));
    if (!atual) throw AppError.notFound('Layout não encontrado.');
    await modeloRepo.excluir(atual.id);
    await auditar(req, 'email.modelo_excluido', atual.uuid, { nome: atual.nome, finalidade: atual.finalidade });
    res.status(204).end();
  } catch (erro) {
    next(erro);
  }
};

/** O layout do formulário, preenchido com os exemplos da finalidade. */
function montarExemplo(corpo: PreviaModeloInput, para: string): ReturnType<typeof renderizar> {
  const f = finalidade(corpo.finalidade);
  conferirVariaveis(f, corpo.assunto, corpo.corpoHtml, corpo.corpoTexto ?? null);
  return renderizar(
    {
      assunto: corpo.assunto,
      corpoHtml: corpo.corpoHtml,
      corpoTexto: corpo.corpoTexto ?? null,
      usarMoldura: corpo.usarMoldura,
    },
    { ...exemplos(f), email: para },
    para,
  );
}

/**
 * Pré-visualização renderizada NO SERVIDOR: o mesmo código que envia, então o
 * que a tela mostra é o que sai — inclusive o escape das variáveis.
 */
export const previaModelo: RequestHandler = async (req, res, next) => {
  try {
    const corpo = req.body as PreviaModeloInput;
    const m = montarExemplo(corpo, corpo.para ?? usuarioDaRequisicao(req).email);
    res.json({ assunto: m.assunto, html: m.html, texto: m.texto });
  } catch (erro) {
    next(erro);
  }
};

/** Envia o layout do formulário, com os exemplos, pela caixa dele (ou a padrão). */
export const testarModelo: RequestHandler = async (req, res, next) => {
  try {
    const corpo = req.body as PreviaModeloInput;
    const para = corpo.para ?? usuarioDaRequisicao(req).email;
    const m = montarExemplo(corpo, para);

    let parametros: email.ParametrosSmtp | null;
    if (corpo.caixa) {
      const c = await caixaRepo.buscarPorUuid(corpo.caixa);
      if (!c) throw AppError.unprocessable('A caixa escolhida não existe mais.');
      parametros = email.parametrosDaCaixa(c);
      if (!parametros) throw AppError.unprocessable(`A senha da caixa "${c.nome}" não pôde ser lida. Cole-a de novo.`);
    } else {
      parametros = await email.parametrosDaPadrao();
      if (!parametros) {
        throw AppError.unprocessable('Nenhuma caixa de saída ativa: cadastre e ative uma caixa antes de testar o layout.');
      }
    }

    const resultado = await email.testar(parametros, para, { assunto: `[TESTE] ${m.assunto}`, texto: m.texto, html: m.html });
    res.json({ ...resultado, para });
  } catch (erro) {
    next(erro);
  }
};
