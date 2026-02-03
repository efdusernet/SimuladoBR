-- Commerce schema for marketing + checkout + licensing

create extension if not exists pgcrypto;
create extension if not exists citext;

-- Configurable plans
create table if not exists plans (
  id text primary key,
  name text not null,
  description text not null,
  price_cents integer not null,
  currency text not null default 'BRL',
  access_duration_days integer null, -- null = lifetime
  is_free boolean not null default false,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists buyers (
  id uuid primary key default gen_random_uuid(),
  first_name text not null,
  last_name text not null,
  email citext not null unique,
  cpf_cnpj text null,
  created_at timestamptz not null default now()
);

alter table buyers add column if not exists cpf_cnpj text null;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'payment_method') then
    create type payment_method as enum ('pix', 'credit_card', 'boleto', 'free');
  end if;
end
$$;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'order_status') then
    create type order_status as enum (
      'created',
      'pending_payment',
      'paid',
      'canceled',
      'refunded',
      'expired'
    );
  end if;
end
$$;

create table if not exists orders (
  id uuid primary key default gen_random_uuid(),
  buyer_id uuid not null references buyers(id),
  plan_id text not null references plans(id),
  payment_method payment_method not null,
  status order_status not null default 'created',
  amount_cents integer not null,
  currency text not null default 'BRL',

  -- Payment provider tracking
  payment_provider text null, -- 'asaas'
  payment_reference text null, -- payment.id OR paymentLink.id
  payment_object_type text null, -- 'payment' | 'paymentLink'
  payment_url text null,
  payment_metadata jsonb null,

  -- For boleto control
  due_date date null,
  expires_at timestamptz null,
  paid_at timestamptz null,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists orders_created_at_idx on orders (created_at desc);
create index if not exists orders_payment_ref_idx on orders (payment_reference);
create index if not exists orders_status_idx on orders (status);
create index if not exists orders_paid_at_idx on orders (paid_at desc);
create index if not exists buyers_email_idx on buyers (email);

do $$
begin
  if not exists (select 1 from pg_type where typname = 'entitlement_status') then
    create type entitlement_status as enum ('active', 'expired', 'revoked', 'refunded');
  end if;
end
$$;

create table if not exists entitlements (
  id uuid primary key default gen_random_uuid(),
  buyer_id uuid not null references buyers(id),
  plan_id text not null references plans(id),
  order_id uuid null references orders(id),
  status entitlement_status not null default 'active',
  starts_at timestamptz not null default now(),
  ends_at timestamptz null,
  created_at timestamptz not null default now(),

  unique (order_id)
);

create index if not exists entitlements_buyer_idx on entitlements (buyer_id, status);
create index if not exists entitlements_ends_at_idx on entitlements (ends_at);

do $$
begin
  if not exists (select 1 from pg_type where typname = 'refund_status') then
    create type refund_status as enum ('requested', 'approved', 'rejected', 'processed');
  end if;
end
$$;

create table if not exists refund_requests (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders(id),
  buyer_id uuid not null references buyers(id),
  reason text null,
  status refund_status not null default 'requested',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Webhook timeline (V2): store each received payment event (e.g., Asaas webhooks)
create table if not exists payment_events (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),

  provider text not null, -- 'asaas'
  event_type text not null, -- e.g. PAYMENT_CONFIRMED

  payment_reference text null, -- payment.id OR paymentLink.id (what we store in orders.payment_reference)
  payment_id text null,
  payment_link_id text null,
  external_reference text null, -- Asaas payment.externalReference (order id)
  order_id uuid null references orders(id),

  payload jsonb not null,
  payload_hash text not null,
  headers jsonb null,

  unique (provider, payload_hash)
);

create index if not exists payment_events_created_at_idx on payment_events (created_at desc);
create index if not exists payment_events_payment_ref_idx on payment_events (payment_reference);
create index if not exists payment_events_order_id_idx on payment_events (order_id);

-- Admin audit log (V2): track operational actions triggered via admin UI
create table if not exists admin_audit_log (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  actor text null,
  ip text null,
  action text not null,
  target text null,
  payload jsonb null
);

create index if not exists admin_audit_log_created_at_idx on admin_audit_log (created_at desc);

-- Admin auth (V3): admin users + login sessions
create table if not exists admin_users (
  id uuid primary key default gen_random_uuid(),
  email citext not null unique,
  password_hash text not null,
  role text not null default 'admin',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  last_login_at timestamptz null
);

create index if not exists admin_users_created_at_idx on admin_users (created_at desc);

create table if not exists admin_sessions (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz null,

  user_id uuid not null references admin_users(id) on delete cascade,
  token_hash text not null unique,

  ip text null,
  user_agent text null
);

create index if not exists admin_sessions_user_id_idx on admin_sessions (user_id, created_at desc);
create index if not exists admin_sessions_expires_at_idx on admin_sessions (expires_at);

-- Seed plans (idempotent)
-- NOTE: prices are placeholders; adjust as needed in production.
insert into plans (id, name, description, price_cents, access_duration_days, is_free)
values
  ('start', 'PLANO START', 'Gratuito. Acesso vitalício.', 0, null, true),
  ('essencial_pmp', 'PLANO ESSENCIAL PMP', 'Acesso por 90 dias.', 9900, 90, false),
  ('aprovacao_pmp', 'PLANO APROVAÇÃO PMP', 'Acesso por 6 meses.', 14900, 180, false)
on conflict (id) do update set
  name = excluded.name,
  description = excluded.description,
  price_cents = excluded.price_cents,
  access_duration_days = excluded.access_duration_days,
  is_free = excluded.is_free,
  is_active = true;
