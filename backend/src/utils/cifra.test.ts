import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { cifrar, decifrar, dica } from './cifra.js';

describe('cifra (senhas de caixa de e-mail e credenciais de integração)', () => {
  it('decifra o que cifrou', () => {
    assert.equal(decifrar(cifrar('abcd efgh ijkl mnop')), 'abcd efgh ijkl mnop');
  });

  it('o pacote não contém o texto em claro, e muda a cada cifragem (nonce novo)', () => {
    const a = cifrar('senha-de-app');
    const b = cifrar('senha-de-app');
    assert.ok(!a.toString('latin1').includes('senha-de-app'));
    assert.notDeepEqual(a, b);
  });

  it('pacote adulterado devolve null em vez de lixo (GCM autentica)', () => {
    const pacote = cifrar('segredo');
    pacote[pacote.length - 1] = pacote[pacote.length - 1]! ^ 0xff;
    assert.equal(decifrar(pacote), null);
  });

  it('a dica mostra só os últimos 4 caracteres', () => {
    assert.equal(dica('abcdefghijklmnop'), '…mnop');
    assert.equal(dica('abc'), null);
  });
});
