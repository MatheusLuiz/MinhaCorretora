import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

/** Regras do CLAUDE.md que já quebraram sem erro de tipo, conferidas no código. */

const DIR = join(import.meta.dirname, '.');
const repositorios = readdirSync(DIR)
  .filter((f) => f.endsWith('.repository.ts'))
  .map((f) => ({ arquivo: f, texto: readFileSync(join(DIR, f), 'utf8') }));

describe('regras dos repositórios', () => {
  it('encontrou os repositórios', () => {
    assert.ok(repositorios.length > 20);
  });

  it('origem_lote nunca é sobrescrito no UPDATE (o desfazer apagaria linhas de outra carga)', () => {
    const violacoes = repositorios.flatMap(({ arquivo, texto }) =>
      [...texto.matchAll(/origem_lote`?\s*=\s*VALUES\s*\(/g)].map(() => arquivo),
    );
    // Monta a lista de colunas do UPDATE por código (como a carteira fazia):
    const porCodigo = repositorios.filter(({ texto }) => /c === 'origem_lote'\s*\|\|/.test(texto)).map((r) => r.arquivo);
    assert.deepEqual([...violacoes, ...porCodigo], []);
  });

  it('itens de comissão regravados (DELETE + INSERT) conservam o lote de quem os criou', () => {
    // Regravar com o lote da carga atual equivale a sobrescrevê-lo no UPDATE.
    const financeiro = repositorios.find((r) => r.arquivo === 'financeiro.repository.ts')!.texto;
    assert.ok(!/tipoDescricao,\s*(dados\.)?origemLote,\s*agora/.test(financeiro));
    assert.equal((financeiro.match(/tipoDescricao, loteDasLinhas, agora/g) ?? []).length, 2);
  });

  it("BIN_TO_UUID e UUID_TO_BIN sempre com a flag 1 (sem ela o uuid PARECE válido)", () => {
    const sem = repositorios.flatMap(({ arquivo, texto }) =>
      [...texto.matchAll(/(BIN_TO_UUID|UUID_TO_BIN)\(([^()]|\([^()]*\))*\)/g)]
        .filter((m) => !/,\s*1\s*\)$/.test(m[0]))
        .map((m) => `${arquivo}: ${m[0]}`),
    );
    assert.deepEqual(sem, []);
  });
});
