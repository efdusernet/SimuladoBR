import 'dotenv/config';

export const config = {
  nodeEnv: process.env.NODE_ENV ?? 'development',
  port: Number(process.env.PORT ?? 3000),
  baseUrl: process.env.BASE_URL ?? `http://localhost:${process.env.PORT ?? 3000}`,

  databaseUrl: process.env.DATABASE_URL ?? null,

  csrfCookieName: process.env.CSRF_COOKIE_NAME ?? 'csrfToken',

  productName: process.env.PRODUCT_NAME ?? 'SimuladosBrasil',
  supportEmail: process.env.SUPPORT_EMAIL ?? 'suporte@exemplo.com',

  asaasEnv: process.env.ASAAS_ENV ?? 'sandbox',
  asaasBaseUrl: process.env.ASAAS_BASE_URL ?? null,
  asaasApiKey: process.env.ASAAS_API_KEY ?? null,
  asaasWebhookToken: process.env.ASAAS_WEBHOOK_TOKEN ?? null,

  accessApiKey: process.env.ACCESS_API_KEY ?? null
};

if (!config.databaseUrl) {
  // eslint-disable-next-line no-console
  console.warn('[site] DATABASE_URL not set; checkout will fail until DB is configured.');
}
