import { config as loadDotenv } from 'dotenv';
import { isAbsolute } from 'node:path';
import { z } from 'zod';

loadDotenv();

/** Booleano do ambiente; `CHAVE=` (string vazia) conta como ausente, senão o enum reprova. */
function booleanoDoAmbiente(padrao?: boolean) {
  const base = z.enum(['true', 'false']);

  return z
    .preprocess(
      (valor) => (valor === '' || valor === undefined ? undefined : valor),
      padrao === undefined ? base.optional() : base.default(padrao ? 'true' : 'false'),
    )
    .transform((valor) => (valor === undefined ? undefined : valor === 'true'));
}

/** Texto opcional do ambiente; `CHAVE=` (string vazia) conta como ausente. */
function textoOpcionalDoAmbiente(maximo?: number) {
  const base = maximo === undefined ? z.string().min(1) : z.string().min(1).max(maximo);

  return z.preprocess(
    (valor) => (valor === '' || valor === undefined ? undefined : valor),
    base.optional(),
  );
}

/** Validado uma vez na subida: configuração inválida impede o processo de subir. */
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),

  PORT: z.coerce.number().int().min(1).max(65535).default(3333),

  // Endereços separados por vírgula, com `{cep}`; tentados em ordem, o primeiro que responder vence.
  CEP_API_URLS: z
    .string()
    .default('https://viacep.com.br/ws/{cep}/json/')
    .transform((v) => v.split(',').map((u) => u.trim()).filter(Boolean))
    .refine((lista) => lista.length > 0 && lista.every((u) => u.includes('{cep}')), {
      message: 'CEP_API_URLS: cada endereço precisa ter {cep} no lugar do número.',
    }),
  CEP_TIMEOUT_MS: z.coerce.number().int().positive().max(15_000).default(4_000),

  // Aviso por e-mail além do sino; chave própria para que configurar SMTP não dispare avisos sozinho.
  NOTIFICAR_POR_EMAIL: booleanoDoAmbiente(false),

  // Ligue em UMA instância só: a subida solta as travas das tarefas "executando".
  TAREFAS_AGENDADAS: booleanoDoAmbiente(true),

  // Mesmo molde do CEP, com `{cnpj}`.
  CNPJ_API_URLS: z
    .string()
    .default('https://brasilapi.com.br/api/cnpj/v1/{cnpj},https://publica.cnpj.ws/cnpj/{cnpj}')
    .transform((v) => v.split(',').map((u) => u.trim()).filter(Boolean))
    .refine((lista) => lista.length > 0 && lista.every((u) => u.includes('{cnpj}')), {
      message: 'CNPJ_API_URLS: cada endereço precisa ter {cnpj} no lugar do número.',
    }),
  CNPJ_TIMEOUT_MS: z.coerce.number().int().positive().max(20_000).default(8_000),
  HOST: z.string().min(1).default('0.0.0.0'),
  API_PREFIX: z.string().startsWith('/').default('/api'),
  // Proxies confiáveis à frente da API; 0 ignora X-Forwarded-* enviados pelo cliente.
  TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(3).default(0),

  // Origens separadas por vírgula. Nunca "*" junto de credenciais.
  CORS_ORIGINS: z
    .string()
    .default('http://localhost:5173')
    .transform((value) =>
      value
        .split(',')
        .map((origin) => origin.trim())
        .filter(Boolean),
    ),

  LOG_LEVEL: z
    .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
    .default('info'),

  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60_000),
  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(120),

  DB_HOST: z.string().min(1),
  DB_PORT: z.coerce.number().int().min(1).max(65535).default(3306),
  DB_USER: z.string().min(1),
  DB_PASSWORD: z.string().min(1),
  DB_NAME: z.string().min(1),
  DB_CONNECTION_LIMIT: z.coerce.number().int().positive().max(100).default(10),
  // Credencial de DDL, só para as migrations; a API usa DB_USER (só DML).
  DB_MIGRATOR_USER: textoOpcionalDoAmbiente(128),
  DB_MIGRATOR_PASSWORD: textoOpcionalDoAmbiente(512),
  // TLS com o banco; desligue só com o MySQL na mesma máquina.
  DB_SSL: booleanoDoAmbiente(false),
  // false aceita certificado autoassinado; com CA própria, prefira apontar o CA.
  DB_SSL_REJECT_UNAUTHORIZED: booleanoDoAmbiente(true),

  // Mínimo de 32 (bloco do HMAC-SHA256). Gere com: openssl rand -base64 48
  JWT_SECRET: z.string().min(32, 'JWT_SECRET precisa ter no mínimo 32 caracteres.'),

  // Chave das credenciais de integração; separada do JWT_SECRET para girá-lo sem perdê-las.
  SEGREDOS_KEY: z
    .string()
    .min(32, 'SEGREDOS_KEY precisa ter no mínimo 32 caracteres.')
    .optional(),
  JWT_ISSUER: z.string().min(1).default('minhacorretora-bi'),
  JWT_AUDIENCE: z.string().min(1).default('minhacorretora-bi-web'),
  ACCESS_TOKEN_TTL_MIN: z.coerce.number().int().positive().max(60).default(15),

  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().max(90).default(7),
  REFRESH_COOKIE_NAME: z.string().min(1).default('ssbi_rt'),
  // Vazio = cookie só no host atual (mais restrito).
  COOKIE_DOMAIN: z.string().optional(),
  // Sem padrão: acompanha o ambiente (ver `cookieSecure`).
  COOKIE_SECURE: booleanoDoAmbiente(),

  SENHA_TAMANHO_MINIMO: z.coerce.number().int().min(8).max(128).default(12),
  LOGIN_MAX_TENTATIVAS: z.coerce.number().int().positive().default(5),
  LOGIN_BLOQUEIO_MINUTOS: z.coerce.number().int().positive().default(15),
  LOGIN_RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(900_000),
  LOGIN_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(10),

  // Cópias auditáveis das importações; fora da pasta do código para sobreviver ao deploy.
  ARQUIVOS_DIR: z.string().min(1).default('./armazenamento'),
  // AES-256 dos arquivos de auditoria (32 bytes em base64); não reutilize o JWT_SECRET.
  ARQUIVOS_ENCRYPTION_KEY: textoOpcionalDoAmbiente(200).refine(
    (valor) => valor === undefined || Buffer.from(valor, 'base64').length === 32,
    'ARQUIVOS_ENCRYPTION_KEY precisa representar exatamente 32 bytes em base64.',
  ),

  // Validade curta do link de redefinição: e-mail lido por outro vale como credencial.
  RESET_SENHA_TTL_MIN: z.coerce.number().int().positive().max(1440).default(30),
  // Teto por CONTA (o limite por IP não cobre ataque distribuído a um alvo só).
  RESET_SENHA_MAX_POR_HORA: z.coerce.number().int().positive().default(3),

  // Endereço absoluto da aplicação web, usado no link do e-mail.
  APP_URL: z.string().url('APP_URL precisa ser uma URL completa.').default('http://localhost:5173'),

  // SMTP opcional: sem ele, o link de redefinição vai para o log.
  SMTP_HOST: textoOpcionalDoAmbiente(),
  SMTP_PORT: z.coerce.number().int().min(1).max(65535).default(587),
  // true = TLS direto (465); false = STARTTLS (587).
  SMTP_SECURE: booleanoDoAmbiente(false),
  SMTP_USER: textoOpcionalDoAmbiente(),
  SMTP_PASS: textoOpcionalDoAmbiente(),
  // "Nome <endereco@dominio>" ou só o endereço.
  SMTP_FROM: textoOpcionalDoAmbiente(),
  SMTP_TIMEOUT_MS: z.coerce.number().int().positive().default(15_000),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  const issues = parsed.error.issues
    .map((issue) => `  - ${issue.path.join('.') || '(raiz)'}: ${issue.message}`)
    .join('\n');

  // console direto: o logger ainda não existe neste ponto do boot.
  console.error(`\n[config] Variáveis de ambiente inválidas:\n${issues}\n`);
  console.error('Copie backend/.env.example para backend/.env e preencha os valores.\n');
  process.exit(1);
}

export const env = parsed.data;

export const isProduction = env.NODE_ENV === 'production';
export const isDevelopment = env.NODE_ENV === 'development';
export const isTest = env.NODE_ENV === 'test';

if (Boolean(env.DB_MIGRATOR_USER) !== Boolean(env.DB_MIGRATOR_PASSWORD)) {
  console.error('\n[config] DB_MIGRATOR_USER e DB_MIGRATOR_PASSWORD devem ser informados juntos.\n');
  process.exit(1);
}

// Só aviso: o fallback é seguro, mas girar o JWT_SECRET inutilizaria as credenciais.
if (!env.SEGREDOS_KEY) {
  console.warn(
    '\n[config] SEGREDOS_KEY não definida: as credenciais de integração usam ' +
      'uma chave derivada do JWT_SECRET.\n' +
      '         Girar o JWT_SECRET vai inutilizá-las. Defina SEGREDOS_KEY ' +
      '(openssl rand -base64 48) para separar os dois.\n',
  );
}

/** `Secure` obrigatório em produção; em dev sobre http:// o navegador descartaria o cookie. */
export const cookieSecure = env.COOKIE_SECURE ?? isProduction;

if (isProduction && !cookieSecure) {
  console.error('\n[config] COOKIE_SECURE=false não é permitido em produção.\n');
  process.exit(1);
}

if (isProduction && !env.DB_SSL) {
  console.error('\n[config] DB_SSL=true é obrigatório em produção.\n');
  process.exit(1);
}

if (isProduction && !isAbsolute(env.ARQUIVOS_DIR)) {
  console.error('\n[config] ARQUIVOS_DIR precisa ser um caminho absoluto fora da aplicação em produção.\n');
  process.exit(1);
}

if (isProduction && !env.ARQUIVOS_ENCRYPTION_KEY) {
  console.error('\n[config] ARQUIVOS_ENCRYPTION_KEY é obrigatório em produção.\n');
  process.exit(1);
}

/** Host e remetente bastam: relay interno autenticado por IP dispensa usuário e senha. */
export const smtpConfigurado = Boolean(env.SMTP_HOST) && Boolean(env.SMTP_FROM);

// Só aviso: a caixa de saída pode vir do banco (Configurações › E-mail de disparo).
if (isProduction && !smtpConfigurado) {
  console.warn(
    '\n[config] SMTP_HOST/SMTP_FROM vazios: o envio depende de Configurações › E-mail de disparo.\n',
  );
}

// O link de redefinição vale como credencial: em http:// trafega em claro.
if (isProduction && env.APP_URL.startsWith('http://')) {
  console.error(
    '\n[config] APP_URL precisa usar HTTPS em produção: o link de redefinição\n' +
      'de senha vale como credencial temporária da conta.\n',
  );
  process.exit(1);
}

export type Env = typeof env;
