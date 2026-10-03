-- PFW-SIF holdings page.
-- Adds trade notes and research links, company details, benchmark sector weights,
-- investment policy limits, and one public snapshot table the Holdings page reads.

-- Trade notes: shown when a visitor opens a transaction.
alter table public.trades add column if not exists rationale text;       -- why we bought / sold (full note)
alter table public.trades add column if not exists team text;            -- e.g. "Information Technology team"
alter table public.trades add column if not exists approved_date date;   -- investment committee approval
alter table public.trades add column if not exists report_title text;    -- e.g. "Equity research: Apple initiation"
alter table public.trades add column if not exists report_url text;      -- link to the research report

-- One row per company the fund has owned. Private; published through the snapshot.
create table if not exists public.securities (
  ticker text primary key,
  name text not null,
  sector text not null default 'Unclassified',   -- GICS sector
  industry text,
  thesis text,                                   -- one or two sentences shown in the holdings table
  thesis_url text                                -- link to the current research report
);

-- S&P 500 sector weights for the allocation comparison. Private; published through the snapshot.
create table if not exists public.benchmark_sectors (
  sector text primary key,
  weight numeric not null check (weight >= 0 and weight <= 1),   -- decimal: 0.315 = 31.5%
  as_of date not null,
  source text not null
);

-- Investment policy limits (decimals). Edit these in fund_profile.
alter table public.fund_profile add column if not exists policy jsonb not null
  default '{"max_position": 0.10, "max_sector_active": 0.10, "cash_min": 0.02, "cash_max": 0.10, "min_positions": 20}'::jsonb;

-- Calculated by the data job; the Holdings page reads the 'holdings' row.
create table if not exists public.public_snapshots (
  id text primary key,
  data jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.securities enable row level security;
alter table public.benchmark_sectors enable row level security;
alter table public.public_snapshots enable row level security;

drop policy if exists "Public can read snapshots" on public.public_snapshots;
create policy "Public can read snapshots" on public.public_snapshots for select to anon, authenticated using (true);

revoke all on public.securities, public.benchmark_sectors from anon, authenticated;
revoke insert, update, delete, truncate on public.public_snapshots from anon, authenticated;
grant select on public.public_snapshots to anon, authenticated;
