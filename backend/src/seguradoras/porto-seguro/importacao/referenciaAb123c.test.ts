import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { mesmoSegurado } from './referenciaAb123c.js';

describe('AB123C: o nome limpo preenche a máscara', () => {
  it('aceita o nome que preenche começo, fim e quantidade de letras', () => {
    assert.equal(mesmoSegurado('Fulano Aparecido Rodrigues', 'Fulano Aparecido XXXXXXXes'), true);
    assert.equal(mesmoSegurado('Beltrana Ficticiali', 'Beltrana XXXXXXXXli'), true);
    assert.equal(mesmoSegurado('Fulgencio José da Silva', 'Fulgencio Jose da XXXva'), true);
  });

  it('recusa outro sobrenome, mesmo parecido', () => {
    assert.equal(mesmoSegurado('Fulano Aparecido Rodrigo', 'Fulano Aparecido XXXXXXXes'), false);
    assert.equal(mesmoSegurado('Beltrana Ficticiani', 'Beltrana XXXXXXXXli'), false);
    assert.equal(mesmoSegurado('Maria Ficticiali', 'Beltrana XXXXXXXXli'), false);
  });

  it('sem máscara, só o mesmo nome (acento e caixa não importam)', () => {
    assert.equal(mesmoSegurado('JOÃO DA SILVA', 'Joao da Silva'), true);
    assert.equal(mesmoSegurado('João da Silva', 'João Silva Neto'), false);
  });
});
