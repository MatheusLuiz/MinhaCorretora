import { escaparHtml, type Mensagem } from './email.service.js';

// E-mails embutidos. Sempre texto + HTML (cliente corporativo bloqueia HTML); HTML em
// tabela e estilo inline porque o Outlook ignora flex, grid e `<style>`.

const COR_MARCA = '#0b2a52';
const COR_TEXTO = '#1f2933';
const COR_DISCRETO = '#6b7280';

interface DadosRedefinicao {
  nome: string;
  email: string;
  link: string;
  validadeMinutos: number;
}

export function emailRedefinicaoSenha(dados: DadosRedefinicao): Mensagem {
  const primeiroNome = dados.nome.split(' ')[0] ?? dados.nome;

  const texto = [
    `Olá, ${primeiroNome}.`,
    '',
    'Recebemos um pedido para redefinir a senha da sua conta no MinhaCorretora BI.',
    '',
    'Abra o endereço abaixo para escolher uma nova senha:',
    dados.link,
    '',
    `O link vale por ${dados.validadeMinutos} minutos e só pode ser usado uma vez.`,
    '',
    'Se não foi você quem pediu, ignore esta mensagem: sua senha atual continua',
    'valendo e nada foi alterado. Se isso se repetir, avise o administrador do',
    'sistema.',
    '',
    '— MinhaCorretora BI',
    'Mensagem automática. Não responda a este e-mail.',
  ].join('\n');

  // Link como botão e por extenso: cliente que reescreve âncora ainda deixa copiar.
  const linkEscapado = escaparHtml(dados.link);

  const html = `<!doctype html>
<html lang="pt-BR">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Redefinição de senha</title>
  </head>
  <body style="margin:0;padding:0;background:#f3f4f6;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f3f4f6;">
      <tr>
        <td align="center" style="padding:32px 16px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
                 style="max-width:520px;background:#ffffff;border-radius:12px;border:1px solid #e5e7eb;">
            <tr>
              <td style="padding:28px 32px 8px;font-family:Arial,Helvetica,sans-serif;">
                <p style="margin:0 0 4px;font-size:13px;letter-spacing:0.08em;text-transform:uppercase;color:${COR_DISCRETO};">
                  MinhaCorretora
                </p>
                <h1 style="margin:0;font-size:22px;line-height:1.3;color:${COR_MARCA};">
                  Redefinição de senha
                </h1>
              </td>
            </tr>
            <tr>
              <td style="padding:16px 32px 0;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.6;color:${COR_TEXTO};">
                <p style="margin:0 0 16px;">Olá, ${escaparHtml(primeiroNome)}.</p>
                <p style="margin:0 0 16px;">
                  Recebemos um pedido para redefinir a senha da sua conta no
                  MinhaCorretora BI.
                </p>
              </td>
            </tr>
            <tr>
              <td align="center" style="padding:8px 32px 8px;">
                <a href="${linkEscapado}"
                   style="display:inline-block;padding:13px 26px;border-radius:8px;background:${COR_MARCA};
                          color:#ffffff;font-family:Arial,Helvetica,sans-serif;font-size:15px;
                          font-weight:bold;text-decoration:none;">
                  Escolher nova senha
                </a>
              </td>
            </tr>
            <tr>
              <td style="padding:8px 32px 0;font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:1.6;color:${COR_DISCRETO};">
                <p style="margin:0 0 12px;">
                  Se o botão não funcionar, copie e cole este endereço no navegador:
                </p>
                <p style="margin:0 0 20px;word-break:break-all;">
                  <a href="${linkEscapado}" style="color:${COR_MARCA};">${linkEscapado}</a>
                </p>
                <p style="margin:0 0 12px;">
                  O link vale por <strong>${dados.validadeMinutos} minutos</strong> e só pode ser usado uma vez.
                </p>
              </td>
            </tr>
            <tr>
              <td style="padding:12px 32px 28px;">
                <div style="padding-top:16px;border-top:1px solid #e5e7eb;
                            font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:1.6;color:${COR_DISCRETO};">
                  <p style="margin:0 0 12px;">
                    Se não foi você quem pediu, ignore esta mensagem: sua senha
                    atual continua valendo e nada foi alterado. Se isso se
                    repetir, avise o administrador do sistema.
                  </p>
                  <p style="margin:0;">Mensagem automática. Não responda a este e-mail.</p>
                </div>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;

  return {
    para: dados.email,
    assunto: 'Redefinição de senha — MinhaCorretora BI',
    texto,
    html,
  };
}

interface DadosConfirmacao {
  nome: string;
  email: string;
  quandoFormatado: string;
}

/** Sai sempre, mesmo na troca legítima: é o único aviso ao dono se a conta for tomada. */
export function emailSenhaAlterada(dados: DadosConfirmacao): Mensagem {
  const primeiroNome = dados.nome.split(' ')[0] ?? dados.nome;

  const texto = [
    `Olá, ${primeiroNome}.`,
    '',
    `A senha da sua conta no MinhaCorretora BI foi alterada em ${dados.quandoFormatado}.`,
    'Todas as sessões abertas foram encerradas.',
    '',
    'Se foi você, não é preciso fazer nada.',
    '',
    'Se NÃO foi você, procure o administrador do sistema imediatamente: alguém',
    'com acesso à sua caixa de e-mail redefiniu a senha da sua conta.',
    '',
    '— MinhaCorretora BI',
    'Mensagem automática. Não responda a este e-mail.',
  ].join('\n');

  const html = `<!doctype html>
<html lang="pt-BR">
  <head><meta charset="utf-8" /><title>Senha alterada</title></head>
  <body style="margin:0;padding:0;background:#f3f4f6;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f3f4f6;">
      <tr>
        <td align="center" style="padding:32px 16px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
                 style="max-width:520px;background:#ffffff;border-radius:12px;border:1px solid #e5e7eb;">
            <tr>
              <td style="padding:28px 32px 8px;font-family:Arial,Helvetica,sans-serif;">
                <p style="margin:0 0 4px;font-size:13px;letter-spacing:0.08em;text-transform:uppercase;color:${COR_DISCRETO};">
                  MinhaCorretora
                </p>
                <h1 style="margin:0;font-size:22px;line-height:1.3;color:${COR_MARCA};">
                  Sua senha foi alterada
                </h1>
              </td>
            </tr>
            <tr>
              <td style="padding:16px 32px 0;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.6;color:${COR_TEXTO};">
                <p style="margin:0 0 16px;">Olá, ${escaparHtml(primeiroNome)}.</p>
                <p style="margin:0 0 16px;">
                  A senha da sua conta no MinhaCorretora BI foi alterada em
                  <strong>${escaparHtml(dados.quandoFormatado)}</strong>.
                  Todas as sessões abertas foram encerradas.
                </p>
                <p style="margin:0 0 16px;">Se foi você, não é preciso fazer nada.</p>
              </td>
            </tr>
            <tr>
              <td style="padding:0 32px 8px;">
                <div style="padding:14px 16px;border-radius:8px;background:#fef2f2;border:1px solid #fecaca;
                            font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.6;color:#991b1b;">
                  <strong>Se não foi você</strong>, procure o administrador do
                  sistema imediatamente: alguém com acesso à sua caixa de e-mail
                  redefiniu a senha da sua conta.
                </div>
              </td>
            </tr>
            <tr>
              <td style="padding:16px 32px 28px;">
                <div style="padding-top:16px;border-top:1px solid #e5e7eb;
                            font-family:Arial,Helvetica,sans-serif;font-size:13px;color:${COR_DISCRETO};">
                  Mensagem automática. Não responda a este e-mail.
                </div>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;

  return {
    para: dados.email,
    assunto: 'Sua senha do MinhaCorretora BI foi alterada',
    texto,
    html,
  };
}
