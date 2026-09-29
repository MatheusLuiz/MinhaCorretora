import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  FINALIDADES_POR_CHAVE,
  obrigatoriasAusentes,
  renderizar,
  variaveisDesconhecidas,
} from './emailFinalidades.js';

const redefinicao = FINALIDADES_POR_CHAVE.get('redefinicao_senha')!;

describe('layouts de e-mail', () => {
  it('acusa variável que a finalidade não oferece (erro de digitação)', () => {
    assert.deepEqual(variaveisDesconhecidas(redefinicao, 'Oi {{primeiro_nome}}', '<p>{{link}} {{telefone}}</p>'), ['telefone']);
  });

  it('redefinição de senha sem {{link}} não serve', () => {
    assert.deepEqual(obrigatoriasAusentes(redefinicao, '<p>Olá {{nome}}</p>', null), ['link']);
    assert.deepEqual(obrigatoriasAusentes(redefinicao, '<p><a href="{{ link }}">x</a></p>', null), []);
  });

  it('valor com HTML entra ESCAPADO no corpo, cru no assunto e no texto', () => {
    const m = renderizar(
      { assunto: 'Oi {{nome}}', corpoHtml: '<p>{{nome}}</p>', corpoTexto: null, usarMoldura: false },
      { nome: '<script>alert(1)</script>' },
      'a@b.c',
    );
    assert.equal(m.html, '<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>');
    assert.equal(m.assunto, 'Oi <script>alert(1)</script>');
    assert.ok(m.texto.startsWith('<script>'));
  });

  it('quebra de linha no valor não vira cabeçalho novo no assunto', () => {
    const m = renderizar(
      { assunto: 'Oi {{nome}}', corpoHtml: '<p>x</p>', corpoTexto: null, usarMoldura: false },
      { nome: 'Maria\r\nBcc: alguem@x.com' },
      'a@b.c',
    );
    assert.ok(!/[\r\n]/.test(m.assunto));
  });

  it('com moldura, o corpo vai dentro do HTML da MinhaCorretora; sem texto, deriva do HTML', () => {
    const m = renderizar(
      { assunto: 'x', corpoHtml: '<p>Olá, {{primeiro_nome}}.</p><p><a href="{{link}}">Trocar</a></p>', corpoTexto: null, usarMoldura: true },
      { primeiro_nome: 'Maria', link: 'https://exemplo/r' },
      'a@b.c',
    );
    assert.ok(m.html.startsWith('<!doctype html>'));
    assert.ok(m.html.includes('MinhaCorretora'));
    assert.ok(m.texto.includes('Olá, Maria.'));
    assert.ok(m.texto.includes('https://exemplo/r'));
  });
});
