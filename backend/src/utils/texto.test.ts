import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { desenhoDaMascara, nomeEmCaixaAlta, repararMojibake, semAcentoMaiusculo } from './texto.js';

describe('nomeEmCaixaAlta', () => {
  it('põe o nome em caixa alta', () => {
    assert.equal(nomeEmCaixaAlta('Maria da Conceição'), 'MARIA DA CONCEIÇÃO');
  });

  it('deixa o nome MASCARADO como veio — em caixa alta ele sairia da detecção', () => {
    assert.equal(nomeEmCaixaAlta('Fulano XXgo'), 'Fulano XXgo');
    assert.equal(nomeEmCaixaAlta('Pedro Henrique da Silva XXXto'), 'Pedro Henrique da Silva XXXto');
  });

  it('não confunde X no fim de palavra com máscara (FICTIXX VEICULOS)', () => {
    assert.equal(nomeEmCaixaAlta('Fictixx Veiculos Ltda'), 'FICTIXX VEICULOS LTDA');
  });
});

describe('desenhoDaMascara', () => {
  it('só o nome que preenche o molde casa — com o número exato de letras escondidas', () => {
    const re = desenhoDaMascara('Pedro Henrique da Silva XXXto')!;
    assert.ok(re.test(semAcentoMaiusculo('PEDRO HENRIQUE DA SILVA BRITO')));
    assert.ok(!re.test(semAcentoMaiusculo('PEDRO HENRIQUE DA SILVA NETO')));
    assert.ok(!re.test(semAcentoMaiusculo('PEDRO HENRIQUE DA SILVA SANTOS')));
  });

  it('nome sem máscara não vira molde', () => {
    assert.equal(desenhoDaMascara('MARIA DA SILVA'), null);
  });
});

describe('repararMojibake', () => {
  it('desfaz o UTF-8 lido como windows-1252 do analítico da Porto', () => {
    assert.equal(repararMojibake('FULANA JOSÃ‰ DA SILVA'), 'FULANA JOSÉ DA SILVA');
  });
});
