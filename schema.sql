-- ─────────────────────────────────────────────────────────────
-- Cherrys Beauty Lounge — Supabase schema
-- Run this once in Supabase → SQL Editor → New Query → Run
-- ─────────────────────────────────────────────────────────────

create table if not exists records (
  id text primary key,
  entity text not null,
  data jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists records_entity_idx on records (entity);

-- Enable Row Level Security
alter table records enable row level security;

-- Allow the app (using the public anon key) to read and write.
-- This keeps the table usable by your team without a login screen.
-- Remember: anyone with your site URL can reach this data unless you
-- add Supabase Auth later — see SETUP-GUIDE.md, "About security".
create policy "Allow all access to anon" on records
  for all
  using (true)
  with check (true);

-- Enable realtime updates so all devices stay in sync live
alter publication supabase_realtime add table records;
