import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { agoraEmBrasilia, descreverDias, lerHorario, proximaExecucao } from './agenda.js';

/** Relógio de parede de Brasília nos campos UTC (a convenção do módulo). */
const em = (iso: string): Date => new Date(`${iso}Z`);

const SEG_A_SEX = 62;

describe('agenda das tarefas (hora de Brasília)', () => {
  it('hoje, se o horário ainda não passou', () => {
    // 30/09/2026 é quarta-feira.
    assert.deepEqual(proximaExecucao(SEG_A_SEX, '08:00', em('2026-09-30T07:59:00')), em('2026-09-30T08:00:00'));
  });

  it('no horário exato já conta como passado: vai para o próximo dia marcado', () => {
    assert.deepEqual(proximaExecucao(SEG_A_SEX, '08:00', em('2026-09-30T08:00:00')), em('2026-10-01T08:00:00'));
  });

  it('sexta depois do horário pula o fim de semana', () => {
    // 02/10/2026 é sexta; a próxima de seg a sex é segunda, 05/10.
    assert.deepEqual(proximaExecucao(SEG_A_SEX, '06:30', em('2026-10-02T09:00:00')), em('2026-10-05T06:30:00'));
  });

  it('só um dia da semana: a mesma quarta da semana que vem', () => {
    const quarta = 1 << 3;
    assert.deepEqual(proximaExecucao(quarta, '08:00', em('2026-09-30T10:00:00')), em('2026-10-07T08:00:00'));
  });

  it('vira o mês e o ano', () => {
    assert.deepEqual(proximaExecucao(127, '00:15', em('2026-12-31T23:00:00')), em('2027-01-01T00:15:00'));
  });

  it('sem dia marcado ou horário inválido: não agenda', () => {
    assert.equal(proximaExecucao(0, '08:00', em('2026-09-30T07:00:00')), null);
    assert.equal(proximaExecucao(SEG_A_SEX, '25:00', em('2026-09-30T07:00:00')), null);
  });

  it('lê horário com e sem segundos (o TIME do MySQL chega "08:30:00")', () => {
    assert.deepEqual(lerHorario('08:30'), [8, 30]);
    assert.deepEqual(lerHorario('08:30:00'), [8, 30]);
    assert.equal(lerHorario('8:30'), null);
  });

  it('converte o instante para Brasília (UTC−3)', () => {
    assert.deepEqual(agoraEmBrasilia(new Date('2026-09-30T15:00:00Z')), em('2026-09-30T12:00:00'));
  });

  it('descreve os dias', () => {
    assert.equal(descreverDias(62), 'seg a sex');
    assert.equal(descreverDias(127), 'todo dia');
    assert.equal(descreverDias(2 | 8 | 32), 'seg, qua, sex');
  });
});
