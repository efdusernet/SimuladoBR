import 'dotenv/config';

export const config = {
  nodeEnv: process.env.NODE_ENV ?? 'development',
  port: Number(process.env.PORT ?? 3000),
  baseUrl: process.env.BASE_URL ?? `http://localhost:${process.env.PORT ?? 3000}`,

  // SimuladosBR (app) backend base URL used for server-to-server sync (e.g., premium grants)
  simuladosBrBaseUrl: process.env.SIMULADOS_BR_BASE_URL ?? null,

  databaseUrl: process.env.DATABASE_URL ?? null,

  csrfCookieName: process.env.CSRF_COOKIE_NAME ?? 'csrfToken',

  productName: process.env.PRODUCT_NAME ?? 'SimuladosBrasil',
  supportEmail: process.env.SUPPORT_EMAIL ?? 'suporte@exemplo.com',

  asaasEnv: process.env.ASAAS_ENV ?? 'sandbox',
  asaasBaseUrl: process.env.ASAAS_BASE_URL ?? null,
  asaasApiKey: process.env.ASAAS_API_KEY ?? null,
  asaasWebhookToken: process.env.ASAAS_WEBHOOK_TOKEN ?? null,

  accessApiKey: process.env.ACCESS_API_KEY ?? null,

  // Admin (Finance UI)
  // Prefer ADMIN_BASIC_AUTH="user:pass"; alternatively set ADMIN_USER + ADMIN_PASSWORD.
  adminBasicAuth: process.env.ADMIN_BASIC_AUTH ?? null,
  adminUser: process.env.ADMIN_USER ?? 'admin',
  adminPassword: process.env.ADMIN_PASSWORD ?? null
};

if (!config.databaseUrl) {
  // eslint-disable-next-line no-console
  console.warn('[site] DATABASE_URL not set; checkout will fail until DB is configured.');
}
