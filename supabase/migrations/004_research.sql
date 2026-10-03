-- PFW-SIF research page.
-- Research reports and the pitch pipeline are entered by hand (or by Claude on request).
-- Both tables are private; the nightly job publishes them, with returns since each pitch,
-- to public_snapshots (id = 'research').

create table if not exists public.research_reports (
  id bigint generated always as identity primary key,
  title text not null,
  report_type text not null default 'Initiation'
    check (report_type in ('Initiation', 'Update', 'Exit memo', 'Sector review', 'Macro outlook')),
  ticker text,                          -- empty for sector and macro pieces
  company text,
  sector text,                          -- GICS sector, or 'Macro'
  published_date date not null,
  team text,                            -- e.g. 'Information Technology team'
  authors text,                         -- optional, e.g. 'J. Smith, A. Lee'
  summary text,                         -- two or three sentences shown on the page
  recommendation text check (recommendation in ('Buy', 'Hold', 'Sell')),
  decision text check (decision in ('Approved', 'Not approved', 'Pending')),
  decision_date date,
  price_at_pitch numeric check (price_at_pitch > 0),   -- left empty, the closing price on published_date is used
  target_price numeric check (target_price > 0),
  report_url text,                      -- link to the PDF or document
  featured boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists research_reports_date_idx on public.research_reports (published_date desc);

create table if not exists public.research_pipeline (
  id bigint generated always as identity primary key,
  ticker text not null,
  company text not null,
  team text,
  stage text not null default 'Researching' check (stage in ('Researching', 'Pitch scheduled', 'Committee vote')),
  pitch_date date,
  idea text,
  created_at timestamptz not null default now()
);

alter table public.research_reports enable row level security;
alter table public.research_pipeline enable row level security;
revoke all on public.research_reports, public.research_pipeline from anon, authenticated;
