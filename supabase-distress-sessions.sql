create table if not exists public.distress_sessions (
  id text primary key,
  status text not null default 'active',
  started_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  payload jsonb not null default '{}'::jsonb
);

create index if not exists distress_sessions_status_started_idx
  on public.distress_sessions (status, started_at desc);

alter table public.distress_sessions enable row level security;