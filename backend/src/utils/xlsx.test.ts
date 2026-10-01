import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { codigoEhData, serialParaData } from './xlsx.js';

// Os leitores de .xlsx e .xls usam estas regras para a data sair igual nos formatos.
describe('datas de planilha', () => {
  it('número de série do Excel vira DD/MM/AAAA', () => {
    assert.equal(serialParaData(46259), '25/08/2026');
    assert.equal(serialParaData(45980), '19/11/2025');
  });

  it('máscara de data é reconhecida', () => {
    assert.equal(codigoEhData('dd/mm/yyyy'), true);
    assert.equal(codigoEhData('d/m/yy h:mm'), true);
  });

  it('máscara de dinheiro e de número NÃO é data', () => {
    assert.equal(codigoEhData('#,##0.00'), false);
    assert.equal(codigoEhData('"R$" #,##0.00'), false);
    assert.equal(codigoEhData('[Red]0.00'), false);
  });
});
