import { logger } from '../config/logger.js';
import * as modeloRepo from '../repositories/modeloEmail.repository.js';
import { enviar, escaparHtml, type Mensagem } from './email.service.js';

// Finalidades são CÓDIGO (quem dispara é o código); o texto é dado (`modelos_email`).
// `{{variavel}}` entra ESCAPADA no HTML e crua no assunto e no texto.

export interface Variavel {
  nome: string;
  descricao: string;
  /** Valor usado na pré-visualização e no e-mail de teste. */
  exemplo: string;
}

export interface Finalidade {
  chave: string;
  rotulo: string;
  descricao: string;
  variaveis: Variavel[];
  /** Sem estas, o e-mail não cumpre o papel (redefinição sem link). */
  obrigatorias: string[];
}

const PESSOA: Variavel[] = [
  { nome: 'nome', descricao: 'Nome completo de quem recebe', exemplo: 'Maria Aparecida Souza' },
  { nome: 'primeiro_nome', descricao: 'Só o primeiro nome', exemplo: 'Maria' },
  { nome: 'email', descricao: 'E-mail de quem recebe', exemplo: 'maria@minhacorretora.com.br' },
];

export const FINALIDADES: Finalidade[] = [
  {
    chave: 'redefinicao_senha',
    rotulo: 'Redefinição de senha',
    descricao: 'Quando alguém pede "Esqueci minha senha" na tela de login.',
    variaveis: [
      ...PESSOA,
      { nome: 'link', descricao: 'Endereço para escolher a nova senha', exemplo: 'https://bi.minhacorretora.com.br/redefinir-senha?token=exemplo' },
      { nome: 'validade_minutos', descricao: 'Por quantos minutos o link vale', exemplo: '30' },
    ],
    obrigatorias: ['link'],
  },
  {
    chave: 'senha_alterada',
    rotulo: 'Senha alterada',
    descricao: 'Aviso de segurança depois que a senha é trocada pelo link.',
    variaveis: [...PESSOA, { nome: 'quando', descricao: 'Data e hora da troca', exemplo: '29/09/2026 14:30' }],
    obrigatorias: [],
  },
  {
    chave: 'primeiro_atraso',
    rotulo: 'Aviso de primeiro atraso',
    descricao: 'Ao corretor, quando um cliente dele entra no primeiro atraso (só com NOTIFICAR_POR_EMAIL=true).',
    variaveis: [
      ...PESSOA,
      { nome: 'titulo', descricao: 'Título do aviso', exemplo: 'Cliente em primeiro atraso' },
      { nome: 'mensagem', descricao: 'Texto do aviso (cliente, apólice, parcela)', exemplo: 'JOSE DA SILVA está com a parcela 3/10 da apólice 123456 em atraso.' },
    ],
    obrigatorias: ['mensagem'],
  },
  {
    chave: 'livre',
    rotulo: 'Livre (uso manual)',
    descricao: 'Layout guardado para envio manual. O sistema não o dispara sozinho.',
    variaveis: PESSOA,
    obrigatorias: [],
  },
];

export const FINALIDADES_POR_CHAVE = new Map(FINALIDADES.map((f) => [f.chave, f]));

const VARIAVEL = /\{\{\s*([a-z_]+)\s*\}\}/g;

/** Variáveis usadas no texto que a finalidade NÃO oferece — erro de digitação, quase sempre. */
export function variaveisDesconhecidas(finalidade: Finalidade, ...textos: (string | null | undefined)[]): string[] {
  const validas = new Set(finalidade.variaveis.map((v) => v.nome));
  const usadas = new Set<string>();
  for (const t of textos) for (const m of (t ?? '').matchAll(VARIAVEL)) usadas.add(m[1]!);
  return [...usadas].filter((v) => !validas.has(v));
}

/** Obrigatórias que não aparecem no corpo (HTML ou texto). */
export function obrigatoriasAusentes(finalidade: Finalidade, html: string, texto: string | null): string[] {
  const corpo = `${html}\n${texto ?? ''}`;
  return finalidade.obrigatorias.filter((v) => !new RegExp(`\\{\\{\\s*${v}\\s*\\}\\}`).test(corpo));
}

export function exemplos(finalidade: Finalidade): Record<string, string> {
  return Object.fromEntries(finalidade.variaveis.map((v) => [v.nome, v.exemplo]));
}

function preencher(texto: string, valores: Record<string, string>, escapar: boolean): string {
  return texto.replace(VARIAVEL, (_m, nome: string) => {
    const v = valores[nome] ?? '';
    return escapar ? escaparHtml(v) : v;
  });
}

/** Versão texto derivada do HTML: cliente corporativo que bloqueia HTML mostraria em branco. */
function htmlParaTexto(html: string): string {
  return html
    .replace(/<\s*(br|\/p|\/div|\/h[1-6]|\/li|\/tr)\s*\/?>/gi, '\n')
    .replace(/<a\s[^>]*href="([^"]*)"[^>]*>(.*?)<\/a>/gi, (_m, href: string, rotulo: string) =>
      rotulo.includes(href) ? rotulo : `${rotulo} (${href})`,
    )
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

const COR_DISCRETO = '#6b7280';

/** Moldura dos e-mails: tabela e estilo inline, porque o Outlook ignora flex/grid. */
export function moldura(titulo: string, conteudo: string): string {
  return `<!doctype html>
<html lang="pt-BR">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escaparHtml(titulo)}</title>
  </head>
  <body style="margin:0;padding:0;background:#f3f4f6;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f3f4f6;">
      <tr>
        <td align="center" style="padding:32px 16px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
                 style="max-width:560px;background:#ffffff;border-radius:12px;border:1px solid #e5e7eb;">
            <tr>
              <td style="padding:28px 32px 8px;font-family:Arial,Helvetica,sans-serif;">
                <p style="margin:0;font-size:13px;letter-spacing:0.08em;text-transform:uppercase;color:${COR_DISCRETO};">
                  MinhaCorretora
                </p>
              </td>
            </tr>
            <tr>
              <td style="padding:12px 32px 8px;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.6;color:#1f2933;">
                ${conteudo}
              </td>
            </tr>
            <tr>
              <td style="padding:12px 32px 28px;">
                <div style="padding-top:16px;border-top:1px solid #e5e7eb;font-family:Arial,Helvetica,sans-serif;
                            font-size:12px;line-height:1.6;color:${COR_DISCRETO};">
                  Mensagem automática do MinhaCorretora BI.
                </div>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

export interface Layout {
  assunto: string;
  corpoHtml: string;
  corpoTexto: string | null;
  usarMoldura: boolean;
}

/** O layout com os valores de um envio → a mensagem pronta. */
export function renderizar(layout: Layout, valores: Record<string, string>, para: string): Mensagem {
  const assunto = preencher(layout.assunto, valores, false).replace(/[\r\n]+/g, ' ').trim();
  const corpo = preencher(layout.corpoHtml, valores, true);
  const html = layout.usarMoldura ? moldura(assunto, corpo) : corpo;
  const texto = layout.corpoTexto
    ? preencher(layout.corpoTexto, valores, false)
    : `${htmlParaTexto(corpo)}\n\n— MinhaCorretora BI`;

  return { para, assunto, texto, html };
}

/** Usa o layout ativo da finalidade; sem ele (ou se a leitura falhar), o embutido. Nunca lança. */
export async function enviarPorFinalidade(
  chave: string,
  para: string,
  valores: Record<string, string>,
  padrao: () => Mensagem,
): Promise<void> {
  let modelo: modeloRepo.ModeloEmail | null = null;
  try {
    modelo = await modeloRepo.ativoDaFinalidade(chave);
  } catch (erro) {
    logger.warn({ err: erro, finalidade: chave }, 'Layout de e-mail indisponível; usando o modelo embutido');
  }

  if (!modelo) {
    await enviar(padrao());
    return;
  }
  await enviar(renderizar(modelo, valores, para), modelo.caixaId ?? undefined);
}

/** `nome` → os derivados que toda finalidade oferece. */
export function valoresDaPessoa(nome: string, email: string): Record<string, string> {
  return { nome, primeiro_nome: nome.trim().split(/\s+/)[0] ?? nome, email };
}
