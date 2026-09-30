-- Multistreams: rode no SQL Editor do Supabase.

create table if not exists public.profiles (
  id uuid primary key references auth.users on delete cascade,
  langs text[] not null default '{}',
  skin text not null default 'prata',
  notify_all boolean not null default true,
  updated_at timestamptz not null default now()
);

create table if not exists public.follows (
  user_id uuid not null references auth.users on delete cascade,
  channel_key text not null,            -- `${platform}:${channel_id}`
  platform text not null check (platform in ('twitch', 'youtube', 'kick')),
  channel_id text not null,
  login text not null default '',
  name text not null,
  avatar text,
  lang text not null,
  notify boolean not null default true,
  created_at timestamptz not null default now(),
  primary key (user_id, channel_key)
);
create index if not exists follows_channel_key on public.follows (channel_key) where notify;

create table if not exists public.push_tokens (
  token text primary key,
  user_id uuid not null references auth.users on delete cascade,
  platform text not null,
  updated_at timestamptz not null default now()
);
create index if not exists push_tokens_user on public.push_tokens (user_id);

-- Status ao vivo por canal. Só o worker (service role) lê e escreve.
create table if not exists public.channels (
  key text primary key,
  live boolean not null default false,
  status jsonb,
  updated_at timestamptz not null default now()
);

alter table public.profiles enable row level security;
alter table public.follows enable row level security;
alter table public.push_tokens enable row level security;
alter table public.channels enable row level security;

create policy "own profile" on public.profiles for all using (auth.uid() = id) with check (auth.uid() = id);
create policy "own follows" on public.follows for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own tokens" on public.push_tokens for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
