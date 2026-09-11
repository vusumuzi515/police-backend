create table if not exists public.distress_sessions (
  id text primary key,
  status text not null default 'active',
  started_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  payload jsonb not null default '{}'::jsonb
);

-- Apply this separately when the table already existed before updated_at was added.
alter table public.distress_sessions
  add column if not exists updated_at timestamptz not null default now();

create index if not exists distress_sessions_status_started_idx
  on public.distress_sessions (status, started_at desc);

-- Keep Get Help ahead of ordinary reports in the operational queue.
create index if not exists distress_sessions_dispatch_priority_idx
  on public.distress_sessions ((coalesce((payload->>'dispatchPriority')::integer, 100)), started_at desc);

alter table public.distress_sessions enable row level security;

-- Durable compatibility store for the current API model. The service role is
-- used only by Render; clients never receive access to this table.
create table if not exists public.police_app_state (
  id text primary key,
  state jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.police_app_state enable row level security;