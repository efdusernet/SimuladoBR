# SimuladosPMPBR (site)

Site de apresentação e checkout para comercialização do **Simulados Brasil**.

## Stack

- Node.js (Express)
- EJS (templates)
- PostgreSQL (persistência de leads/pedidos)
- Asaas (pagamentos)

## Como rodar (dev)

1) Instale dependências:

```bash
npm install
```

2) Configure variáveis de ambiente:

```bash
copy .env.example .env
```

Obs: se a senha do Postgres tiver caracteres especiais (ex.: `@`), use URL-encoding no `DATABASE_URL` (ex.: `@` → `%40`).

3) Suba o Postgres e inicialize o schema:

- Recomendado: use um banco separado só para o checkout, por exemplo `simbr_checkout` (ou ajuste `DATABASE_URL`).
	- Assim você não mistura as tabelas de checkout/licenças com as tabelas do app principal.
- Rode:

```bash
npm run db:check
npm run db:init
```

4) Rode o servidor:

```bash
npm run dev
```

Acesse `http://localhost:3000`.

Healthcheck: `GET /healthz`.

## Próximos passos

## Asaas

- Configure `ASAAS_ENV` (`sandbox` ou `production`) e `ASAAS_API_KEY` no `.env`.
- O checkout cria um cliente e uma cobrança PIX e redireciona para a fatura (invoice) no Asaas.
- **Obs:** o Asaas exige **CPF/CNPJ** do cliente para criar cobranças (PIX/BOLETO/CARTÃO), então o checkout coleta esse dado para planos pagos.
- Webhook (para atualização automática do status): `POST /webhooks/asaas`
	- Se você definir um token de webhook no painel do Asaas, coloque o mesmo valor em `ASAAS_WEBHOOK_TOKEN`.

## Smoke tests

```bash
npm run smoke
npm run smoke:asaas
```

## Próximos passos

- Enviar e-mail automático após `orders.status=paid` e provisionar licença.
- Adicionar checkout com cartão/boleto (além de PIX) e telas de status.
