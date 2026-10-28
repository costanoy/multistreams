-- Multistreams: rode no SQL Editor do Supabase. Pode rodar de novo: só cria o que falta.
-- Num banco que já existe, as mudanças de 28/10/2026 também estão em migrations/20261028_endurecimento.sql.

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
-- o worker lê os follows novos a cada 2 min (uma importação entra logo no polling)
create index if not exists follows_created_at on public.follows (created_at);

-- Formato da chave em cada plataforma, o mesmo que o worker aceita. "not valid": vale para as linhas
-- novas e alteradas; as antigas se conferem e validam com os comandos do fim da migração 20261028.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'follows_channel_key_format' and conrelid = 'public.follows'::regclass) then
    alter table public.follows add constraint follows_channel_key_format check (
      channel_key = platform || ':' || channel_id
      and ((platform = 'twitch' and channel_id ~ '^[0-9]{1,20}$')
        or (platform = 'youtube' and channel_id ~ '^UC[A-Za-z0-9_-]{22}$')
        or (platform = 'kick' and channel_id ~ '^[a-z0-9_-]{1,25}$'))
    ) not valid;
  end if;
end $$;

-- Teto de 3.000 follows por conta, o mesmo do worker (FOLLOWS_PER_ACCOUNT): uma conta só não enche o polling.
-- A linha nova além do teto é ignorada em silêncio (o upsert em lote dos apps segue sem erro) e a atualização
-- de uma linha que já existe (notify trocado) sempre passa. Roda com a permissão de quem grava (a RLS vale).
create or replace function public.follows_cap()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if exists (select 1 from public.follows where user_id = new.user_id and channel_key = new.channel_key) then
    return new;
  end if;
  if (select count(*) from (select 1 from public.follows where user_id = new.user_id limit 3000) as f) >= 3000 then
    return null;
  end if;
  return new;
exception when others then
  -- nunca derruba o lote: na dúvida, a linha passa
  return new;
end;
$$;
drop trigger if exists follows_cap on public.follows;
create trigger follows_cap before insert on public.follows
  for each row execute function public.follows_cap();

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
  updated_at timestamptz not null default now(),
  -- último pedido de algum app (ou presença em follows): sem pedido há 2 dias, o canal sai do polling
  wanted_at timestamptz not null default now()
);
alter table public.channels add column if not exists wanted_at timestamptz not null default now();
create index if not exists channels_wanted_at on public.channels (wanted_at);

-- Estado pequeno do worker (como a cota do YouTube gasta no dia), para não zerar a cada reinício. Só o worker.
create table if not exists public.kv (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.profiles enable row level security;
alter table public.follows enable row level security;
alter table public.push_tokens enable row level security;
alter table public.channels enable row level security;
alter table public.kv enable row level security;

drop policy if exists "own profile" on public.profiles;
create policy "own profile" on public.profiles for all using (auth.uid() = id) with check (auth.uid() = id);
drop policy if exists "own follows" on public.follows;
create policy "own follows" on public.follows for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "own tokens" on public.push_tokens;
create policy "own tokens" on public.push_tokens for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Grava o token de push do aparelho na conta de quem está logado. Se o aparelho era de outra conta,
-- o token passa para esta (o upsert direto falharia na RLS, porque a linha é da conta anterior).
create or replace function public.claim_push_token(p_token text, p_platform text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'precisa entrar na conta' using errcode = '42501';
  end if;
  if p_token is null or length(p_token) not between 10 and 300 then
    raise exception 'token inválido' using errcode = '22023';
  end if;
  insert into public.push_tokens (token, user_id, platform, updated_at)
  values (p_token, auth.uid(), left(coalesce(p_platform, ''), 20), now())
  on conflict (token) do update
    set user_id = auth.uid(), platform = excluded.platform, updated_at = now();
end;
$$;
revoke all on function public.claim_push_token(text, text) from public, anon;
grant execute on function public.claim_push_token(text, text) to authenticated;
