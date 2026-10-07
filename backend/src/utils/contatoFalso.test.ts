import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { emailFalso, telefoneFalso } from './contatoFalso.js';

describe('contato de preenchimento não é contato de cliente', () => {
  it('e-mail "não tem" e variações', () => {
    for (const e of ['naotem@naotem.com.br', 'NATM@NAOTEM.COM.BR', 'NAOTEM@NAOTE.COM.BR', 'NAOTEMJ@GMAIL.COM', 'NAOTEM@ITAU.COM.BR', 'naotem@gmail.com', 'nt@nt.com.br', 'não@informado.com.br']) {
      assert.equal(emailFalso(e), true, e);
    }
  });

  it('e-mail da corretora', () => {
    assert.equal(emailFalso('CONTATO@MINHACORRETORA.COM.BR'), true);
    assert.equal(emailFalso('renovacao@minhacorretora.com.br'), true);
  });

  it('e-mail de verdade passa (inclusive quem se chama Natan ou Antonio)', () => {
    for (const e of ['natanael.tem@exemplo.com.br', 'antonio.temberg@exemplo.com.br', 'maria.ficticia97@exemplo.com.br', 'naotemos@empresa.com.br']) {
      assert.equal(emailFalso(e), false, e);
    }
  });

  it('telefone da corretora e números repetidos', () => {
    assert.equal(telefoneFalso('41 33330000'), true);
    assert.equal(telefoneFalso('(41) 4444-0000'), true);
    assert.equal(telefoneFalso('41 999999999'), true);
    assert.equal(telefoneFalso('41 991234567'), false);
  });
});

describe('e-mail de empresa que não é a corretora', () => {
  it('e-mail corporativo de cliente passa', () => {
    assert.equal(emailFalso('FULANO.DE.TAL@EXEMPLO.COM.BR'), false);
  });
});

describe('zero de discagem', () => {
  it('o da corretora com zeros na frente continua falso', () => {
    assert.equal(telefoneFalso('004133330000'), true);
  });
});
