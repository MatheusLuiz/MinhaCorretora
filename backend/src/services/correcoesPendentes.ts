import { randomUUID } from 'node:crypto';

import type { Correcao } from './importacaoCarteira.service.js';

// Correções da conferência, guardadas em memória por bilhete: o corpo da requisição já é o
// arquivo cru. Reiniciar o servidor perde o bilhete, e a confirmação FALHA (nunca grava sem elas).

interface Deposito {
  correcoes: Correcao[];
  expiraEm: number;
  usuario: string;
}

const MINUTOS = 30;
const depositos = new Map<string, Deposito>();

function limpar(): void {
  const agora = Date.now();
  for (const [bilhete, d] of depositos) {
    if (d.expiraEm <= agora) depositos.delete(bilhete);
  }
}

export function guardarCorrecoes(correcoes: Correcao[], usuario: string): string {
  limpar();

  const bilhete = randomUUID();
  depositos.set(bilhete, {
    correcoes,
    usuario,
    expiraEm: Date.now() + MINUTOS * 60_000,
  });

  return bilhete;
}

/** Uso único (duplo clique não roda a carga duas vezes); confere o dono, pois o bilhete vai na query string. */
export function resgatarCorrecoes(bilhete: string, usuario: string): Correcao[] {
  limpar();

  const deposito = depositos.get(bilhete);

  if (!deposito) {
    throw new Error(
      'As correções desta conferência expiraram ou já foram usadas. ' +
        'Envie o arquivo de novo e refaça o preenchimento.',
    );
  }

  if (deposito.usuario !== usuario) {
    throw new Error('Estas correções foram preenchidas por outra pessoa.');
  }

  depositos.delete(bilhete);
  return deposito.correcoes;
}
