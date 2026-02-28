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

## Ponte de acesso premium (sync com SimuladosBR)

Quando o Asaas confirma ou revoga um pagamento, o checkout mantém o estado de acesso consistente no app principal (SimuladosBR) atualizando:

- `usuario.PremiumExpiresAt` (data fim do acesso)
- `usuario.BloqueioAtivado` (legado: premium quando `false`)

Como funciona:

- O webhook `POST /webhooks/asaas` atualiza `orders.status` com base no `payload.event`.
- Em `paid` (`PAYMENT_CONFIRMED`/`PAYMENT_RECEIVED`), o sistema concede entitlement e sincroniza premium no SimuladosBR.
- Em `refunded/canceled/expired` (ex.: `PAYMENT_REFUNDED`, `PAYMENT_CHARGEBACK`, `PAYMENT_DELETED`, `PAYMENT_OVERDUE`), ele revoga/expira o entitlement do pedido e re-sincroniza premium no SimuladosBR.

A sincronização é **idempotente** e baseada no estado atual de entitlement:

- Se existe entitlement ativo para o e-mail → `active=true` e `expiresAt=ends_at` (ou `null` para lifetime)
- Se não existe → `active=false` (remove premium)

Variáveis de ambiente necessárias no checkout:

- `SIMULADOS_BR_BASE_URL` (base URL do backend do app principal, ex.: `https://app.seudominio.com`)
- `ACCESS_API_KEY` (mesmo valor usado no SimuladosBR; enviado no header `x-access-api-key`)

## Smoke tests

```bash
npm run smoke
npm run smoke:asaas
```

## Próximos passos

- Enviar e-mail automático após `orders.status=paid` e provisionar licença.
- Adicionar checkout com cartão/boleto (além de PIX) e telas de status.
