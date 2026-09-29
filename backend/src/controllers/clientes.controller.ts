import type { RequestHandler } from 'express';

import type {
  CriarClienteInput,
  EditarClienteInput,
  IdClienteInput,
  ListarClientesInput,
} from '../schemas/clientes.schema.js';
import type { NovaApoliceInput } from '../schemas/novaApolice.schema.js';
import type { DocumentoParamInput } from '../schemas/clientes.schema.js';
import * as clientesRepo from '../repositories/cliente.repository.js';
import * as cepService from '../services/cep.service.js';
import * as cnpjService from '../services/cnpj.service.js';
import * as corretorService from '../services/corretor.service.js';
import * as clientesService from '../services/clientes.service.js';
import { escopoDaRequisicao, escopoDeConsulta } from '../services/escopo.js';
import * as edicaoCliente from '../services/edicaoCliente.js';
import * as novaApolice from '../services/novaApolice.service.js';
import { usuarioDaRequisicao } from '../middlewares/autenticacao.js';
import { AppError } from '../utils/AppError.js';

export const listar: RequestHandler = async (req, res, next) => {
  try {
    const filtro = req.query as unknown as ListarClientesInput;

    res.json(
      await clientesService.listar({
        busca: filtro.busca,
        situacao: filtro.situacao,
        uf: filtro.uf,
        seguradora: filtro.seguradora,
        produtor: filtro.produtor,
        origemSistema: filtro.origem,
        pagina: filtro.pagina,
        limite: filtro.limite,
        // Recorte de CONSULTA: com `clientes.consultar`, a busca alcança a base inteira.
        escopo: await escopoDeConsulta(req),
      }),
    );
  } catch (erro) {
    next(erro);
  }
};

export const filtros: RequestHandler = async (_req, res, next) => {
  try {
    res.json(await clientesService.opcoesDeFiltro());
  } catch (erro) {
    next(erro);
  }
};

/** Endereço de um CEP, para preencher o formulário. 404 quando não existe. */
export const consultarCep: RequestHandler = async (req, res, next) => {
  try {
    const endereco = await cepService.consultarCep(String(req.params.cep ?? ''));
    if (!endereco) throw AppError.notFound('CEP não encontrado. Confira o número.');
    res.json({ endereco });
  } catch (erro) {
    next(erro);
  }
};

/** Dados de uma empresa na Receita, para preencher o cadastro. 404 quando não existe. */
export const consultarCnpj: RequestHandler = async (req, res, next) => {
  try {
    const empresa = await cnpjService.consultarCnpj(String(req.params.cnpj ?? ''));
    if (!empresa) throw AppError.notFound('CNPJ não encontrado na Receita. Confira o número.');
    res.json({ empresa });
  } catch (erro) {
    next(erro);
  }
};

/** O CPF/CNPJ já tem cadastro? A tela de novo cliente bloqueia antes de salvar. */
export const verificarDocumento: RequestHandler = async (req, res, next) => {
  try {
    const { documento } = req.params as unknown as DocumentoParamInput;
    res.json(await clientesService.verificarDocumento(documento, await escopoDeConsulta(req)));
  } catch (erro) {
    next(erro);
  }
};

export const detalhar: RequestHandler = async (req, res, next) => {
  try {
    const { id } = req.params as unknown as IdClienteInput;
    const cliente = await clientesService.detalhar(id, await escopoDeConsulta(req));

    // Fora da própria carteira a ficha é só leitura (o PATCH usa o recorte da carteira).
    const estrito = await escopoDaRequisicao(req);
    const naCarteira =
      estrito.produtorIds === null || (await clientesService.estaNoEscopo(id, estrito));

    res.json({ cliente: { ...cliente, somenteConsulta: !naCarteira } });
  } catch (erro) {
    next(erro);
  }
};

/** Números do painel de clientes; `disponivel` diz quais análises têm origem hoje. */
export const resumoPainel: RequestHandler = async (req, res, next) => {
  try {
    const escopo = await escopoDaRequisicao(req);

    const [carteira, movimento, distribuicoes] = await Promise.all([
      clientesRepo.resumoCarteira(escopo),
      clientesRepo.movimentoMensal(24, escopo),
      clientesRepo.distribuicoes(escopo),
    ]);

    res.json({
      carteira,
      movimento,
      distribuicoes,
      disponivel: {
        carteira: true,
        movimentoEntradas: true,
        // Saídas só existem quando alguém for marcado como inativo com data.
        movimentoSaidas: carteira.perdidosNoAno > 0 || carteira.inativos > 0,
        // Dependem de apólices, que ainda não foram importadas.
        frequenciaContratacao: false,
        crossSell: false,
      },
      // Para o corretor não ler os próprios números como os da empresa.
      recorte: {
        carteiraPropria: escopo.produtorIds !== null,
        semCarteira: escopo.produtorIds !== null && escopo.produtorIds.length === 0,
      },
    });
  } catch (erro) {
    next(erro);
  }
};

export const situacoes: RequestHandler = async (_req, res, next) => {
  try {
    res.json({ situacoes: await clientesRepo.listarSituacoes() });
  } catch (erro) {
    next(erro);
  }
};

export const criar: RequestHandler = async (req, res, next) => {
  try {
    const dados = req.body as CriarClienteInput;
    // O corretor é quem cadastra; perfil com `clientes.todos` pode escolher.
    const corretor = await corretorService.resolver(usuarioDaRequisicao(req), dados.corretor);
    const cliente = await clientesService.criar(dados, { produtorId: corretor.produtorId });

    res.status(201).json({
      cliente,
      mensagem: `${cliente.nome} cadastrado como ${cliente.situacao ?? 'cliente'}.`,
    });
  } catch (erro) {
    next(erro);
  }
};

/** PATCH é delta: campo ausente = não mexa. */
export const editar: RequestHandler = async (req, res, next) => {
  try {
    const { id } = req.params as unknown as IdClienteInput;
    const dados = req.body as EditarClienteInput;

    const r = await edicaoCliente.editar(id, dados, await escopoDaRequisicao(req));

    res.json({
      cliente: await clientesService.detalhar(id, await escopoDaRequisicao(req)),
      mensagem:
        r.camposAlterados.length === 0
          ? 'Nada mudou.'
          : `${r.nome}: ${r.camposAlterados.length} campo(s) atualizado(s).`,
    });
  } catch (erro) {
    next(erro);
  }
};

/** Nova apólice digitada na ficha; devolve a ficha inteira, como a edição. */
export const criarApolice: RequestHandler = async (req, res, next) => {
  try {
    const { id } = req.params as unknown as IdClienteInput;
    const dados = req.body as NovaApoliceInput;
    const escopo = await escopoDaRequisicao(req);

    await novaApolice.criar(id, dados, escopo);

    res.status(201).json({
      cliente: await clientesService.detalhar(id, escopo),
      mensagem: `Apólice ${dados.numero} cadastrada.`,
    });
  } catch (erro) {
    next(erro);
  }
};

/** Corretores possíveis de um cadastro novo; sem `clientes.todos`, só o próprio. */
export const corretores: RequestHandler = async (req, res, next) => {
  try {
    const usuario = usuarioDaRequisicao(req);
    const podeEscolher = usuario.permissoes.includes('clientes.todos');
    res.json({
      atual: { id: usuario.id, nome: usuario.nome },
      podeEscolher,
      corretores: podeEscolher ? await corretorService.listar() : [],
    });
  } catch (erro) {
    next(erro);
  }
};
