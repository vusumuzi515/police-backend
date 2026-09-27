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

alter table public.distress_sessions
  add column if not exists payload jsonb not null default '{}'::jsonb;

create index if not exists distress_sessions_status_started_idx
  on public.distress_sessions (status, started_at desc);

-- Keep Get Help ahead of ordinary reports in the operational queue.
create index if not exists distress_sessions_dispatch_priority_idx
  on public.distress_sessions ((coalesce((payload->>'dispatchPriority')::integer, 100)), started_at desc);

alter table public.distress_sessions enable row level security;

-- Durable compatibility store for the API model. The service role is used only
-- by backend deployments; clients never receive access to this table.
create table if not exists public.police_app_state (
  id text primary key,
  state jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.police_app_state
  add column if not exists lock_owner text,
  add column if not exists lock_expires_at timestamptz;

alter table public.police_app_state enable row level security;

create or replace function public.police_app_state_acquire_lock(p_owner text, p_ttl_seconds integer)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  updated_rows integer;
begin
  insert into public.police_app_state (id, state)
  values ('main', '{}'::jsonb)
  on conflict (id) do nothing;

  update public.police_app_state
  set lock_owner = p_owner,
      lock_expires_at = now() + make_interval(secs => greatest(10, least(p_ttl_seconds, 120)))
  where id = 'main'
    and (lock_owner is null or lock_expires_at < now() or lock_owner = p_owner);

  get diagnostics updated_rows = row_count;
  return updated_rows = 1;
end;
$$;

create or replace function public.police_app_state_release_lock(p_owner text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.police_app_state
  set lock_owner = null, lock_expires_at = null
  where id = 'main' and lock_owner = p_owner;
  return found;
end;
$$;

revoke all on function public.police_app_state_acquire_lock(text, integer) from public, anon, authenticated;
revoke all on function public.police_app_state_release_lock(text) from public, anon, authenticated;
grant execute on function public.police_app_state_acquire_lock(text, integer) to service_role;
grant execute on function public.police_app_state_release_lock(text) to service_role;

notify pgrst, 'reload schema';