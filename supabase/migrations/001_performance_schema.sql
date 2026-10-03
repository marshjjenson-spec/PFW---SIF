-- PFW-SIF performance database.
-- Public visitors can read only fund_profile and monthly_returns.
-- Everything else (trades, prices, secrets, job logs) is private to the service role,
-- which only the scheduled data job and the Supabase dashboard use.

create extension if not exists pgcrypto with schema extensions;

-- One-row fund settings shown on the public page.
create table if not exists public.fund_profile (
  id int primary key default 1 check (id = 1),
  fund_name text not null default 'Purdue Fort Wayne Student Investment Fund',
  portfolio_name text not null default 'PFW-SIF Main Portfolio',
  benchmark_name text not null default 'S&P 500 Total Return',
  benchmark_ticker text not null default 'SPY',
  performance_type text not null default 'simulated'
    check (performance_type in ('simulated', 'backtest', 'live', 'actual')),
  risk_free_rate numeric not null default 0,          -- annual, as a decimal: 0.04 = 4%
  risk_free_source text not null default 'Not yet configured',
  inception_date date,                                 -- filled from the first ledger entry
  data_through date,                                   -- last priced trading day
  last_updated timestamptz,
  last_status text,
  last_message text
);
insert into public.fund_profile (id) values (1) on conflict (id) do nothing;

-- The trade ledger: the only table you edit by hand.
create table if not exists public.trades (
  id bigint generated always as identity primary key,
  trade_date date not null,
  type text not null check (type in ('DEPOSIT', 'WITHDRAWAL', 'BUY', 'SELL', 'FEE')),
  ticker text,
  shares numeric,
  price numeric,
  amount numeric,
  fees numeric not null default 0,
  note text,
  created_at timestamptz not null default now(),
  constraint trade_fields check (
    (type in ('BUY', 'SELL') and ticker is not null and shares > 0 and price > 0)
    or (type in ('DEPOSIT', 'WITHDRAWAL', 'FEE') and amount > 0)
  )
);
create index if not exists trades_date_idx on public.trades (trade_date);

-- Daily end-of-day prices pulled from Tiingo.
create table if not exists public.prices (
  ticker text not null,
  date date not null,
  close numeric not null,
  adj_close numeric not null,
  div_cash numeric not null default 0,
  split_factor numeric not null default 1,
  primary key (ticker, date)
);

-- Calculated by the data job; never edited by hand.
create table if not exists public.daily_values (
  date date primary key,
  value numeric not null,
  cash numeric not null,
  invested numeric not null,
  net_flow numeric not null default 0
);

create table if not exists public.monthly_returns (
  month text primary key,              -- YYYY-MM
  period_start date not null,
  period_end date not null,
  bmv numeric not null,
  emv numeric not null,
  net_flow numeric not null,
  portfolio_return numeric,
  benchmark_return numeric,
  is_partial boolean not null default false,
  trading_days int not null
);

create table if not exists public.app_secrets (
  key text primary key,
  value text not null default ''
);
insert into public.app_secrets (key, value) values
  ('job_secret', encode(extensions.gen_random_bytes(24), 'hex')),
  ('tiingo_api_key', '')
on conflict (key) do nothing;

create table if not exists public.job_runs (
  id bigint generated always as identity primary key,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status text not null default 'running',
  message text
);

-- Row level security: public read on two tables, nothing else.
alter table public.fund_profile enable row level security;
alter table public.trades enable row level security;
alter table public.prices enable row level security;
alter table public.daily_values enable row level security;
alter table public.monthly_returns enable row level security;
alter table public.app_secrets enable row level security;
alter table public.job_runs enable row level security;

drop policy if exists "Public can read fund profile" on public.fund_profile;
create policy "Public can read fund profile" on public.fund_profile for select to anon, authenticated using (true);
drop policy if exists "Public can read monthly returns" on public.monthly_returns;
create policy "Public can read monthly returns" on public.monthly_returns for select to anon, authenticated using (true);

revoke all on public.trades, public.prices, public.daily_values, public.app_secrets, public.job_runs from anon, authenticated;
revoke insert, update, delete on public.fund_profile, public.monthly_returns from anon, authenticated;
grant select on public.fund_profile, public.monthly_returns to anon, authenticated;

-- Calculated tables are refreshed by the update-data edge function (upsert, then remove stale rows).
