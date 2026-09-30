import type { Rotina } from '../rotina.js';

/** Rotina genérica: confere a configuração da integração sem chamar a API. */
export const rotina: Rotina = {
  nome: 'Verificar integração',
  descricao: 'Confere se a integração de API da seguradora está cadastrada, ativa e com credenciais.',
  async executar({ seguradora, log }) {
    if (!seguradora) throw new Error('A tarefa não tem seguradora.');
    log(`Conferindo a integração da ${seguradora.nome}…`);

    const i = seguradora.integracao;
    // Sem integração, o resto é consequência: uma falta só.
    const faltas =
      !i || i.tipo === 'nenhuma'
        ? ['integração não cadastrada']
        : [
            !i.ativa ? 'integração inativa' : null,
            !i.baseUrl ? 'sem endereço da API' : null,
            !i.temSegredo && i.credenciais.length === 0 ? 'sem credencial' : null,
          ].filter((x): x is string => x !== null);

    for (const f of faltas) log(f, 'aviso');
    if (faltas.length > 0) throw new Error(`${seguradora.nome}: ${faltas.join(', ')}.`);

    log(`Tipo ${i!.tipo}, ambiente ${i!.ambiente}, ${i!.credenciais.length} credencial(is).`);
    return {
      mensagem: `${seguradora.nome}: integração pronta (${i!.tipo}, ${i!.ambiente}).`,
      detalhes: { tipo: i!.tipo, ambiente: i!.ambiente, credenciais: i!.credenciais.length },
    };
  },
};
