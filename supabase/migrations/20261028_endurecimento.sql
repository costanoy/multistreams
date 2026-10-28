-- Multistreams: endurecimento de 28/10/2026 (worker e push).
--
-- Como rodar: no painel do Supabase, abra SQL Editor, clique em New query, cole este arquivo inteiro
-- e clique em Run. Pode rodar mais de uma vez: só cria o que falta.
--
-- O worker novo funciona antes e depois desta migração. Sem ela, ele avisa uma vez no log e:
--   - o prazo dos canais (channels.wanted_at) recomeça a cada reinício, como antes;
--   - o estado que ele guarda em kv (a cota do YouTube gasta no dia) zera a cada reinício.
-- Sem o teto do item 6, uma conta grava quantos follows quiser: o worker usa até 3.000 de cada uma, mas lê todos.
-- O app novo chama claim_push_token; sem a função, ele cai no upsert antigo em push_tokens.
-- Depois de rodar, confira as chaves fora do formato e as contas acima do teto com os comandos do fim deste arquivo.

-- 1. Prazo dos canais: o último pedido de algum app (ou presença em follows). O worker grava em lote,
--    mais ou menos de hora em hora, e apaga o que ninguém pede há 2 dias. As linhas que já existem
--    começam com a hora desta migração.
alter table public.channels add column if not exists wanted_at timestamptz not null default now();
create index if not exists channels_wanted_at on public.channels (wanted_at);

-- 2. Estado pequeno do worker. Só o worker (service role) lê e escreve: RLS ligada e sem política.
create table if not exists public.kv (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);
alter table public.kv enable row level security;

-- 3. O worker lê os follows novos a cada 2 min (uma importação entra logo no polling).
create index if not exists follows_created_at on public.follows (created_at);

-- 4. Formato da chave em cada plataforma, o mesmo que o worker aceita. "not valid": vale para as
--    linhas novas e alteradas; as antigas ficam até você conferir e validar (fim do arquivo).
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

-- 5. Token de push na conta de quem está logado. Se o aparelho era de outra conta, o token passa para
--    esta (o upsert direto falharia na RLS, porque a linha é da conta anterior).
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

-- 6. Teto de 3.000 follows por conta, o mesmo do worker (FOLLOWS_PER_ACCOUNT): uma conta só não enche o polling.
--    A linha nova além do teto é ignorada em silêncio (o upsert em lote dos apps segue sem erro) e a atualização
--    de uma linha que já existe (notify trocado) sempre passa. Roda com a permissão de quem grava (a RLS vale).
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

-- ---- Chaves fora do formato: rode à mão, um passo de cada vez ----
--
-- O worker já ignora essas chaves (não consulta nem avisa). Elas só ficam no banco.
--
-- a) Liste as de follows e confira se são lixo mesmo:
--
--   select user_id, channel_key, platform, channel_id, name, created_at
--   from public.follows
--   where not (
--     channel_key = platform || ':' || channel_id
--     and ((platform = 'twitch' and channel_id ~ '^[0-9]{1,20}$')
--       or (platform = 'youtube' and channel_id ~ '^UC[A-Za-z0-9_-]{22}$')
--       or (platform = 'kick' and channel_id ~ '^[a-z0-9_-]{1,25}$'))
--   )
--   order by created_at;
--
-- b) Apague pelo mesmo padrão (nunca por uma lista de chaves coladas) e valide a restrição:
--
--   delete from public.follows
--   where not (
--     channel_key = platform || ':' || channel_id
--     and ((platform = 'twitch' and channel_id ~ '^[0-9]{1,20}$')
--       or (platform = 'youtube' and channel_id ~ '^UC[A-Za-z0-9_-]{22}$')
--       or (platform = 'kick' and channel_id ~ '^[a-z0-9_-]{1,25}$'))
--   );
--   alter table public.follows validate constraint follows_channel_key_format;
--
-- c) Em channels, as linhas fora do formato nunca entram no polling e o prazo de 2 dias as apaga
--    sozinho. Para ver ou apagar já:
--
--   select key from public.channels
--   where key !~ '^(twitch:[0-9]{1,20}|youtube:UC[A-Za-z0-9_-]{22}|kick:[a-z0-9_-]{1,25})$';
--
--   delete from public.channels
--   where key !~ '^(twitch:[0-9]{1,20}|youtube:UC[A-Za-z0-9_-]{22}|kick:[a-z0-9_-]{1,25})$';
--
-- ---- Contas acima do teto de follows ----
--
-- O gatilho do item 6 só barra as linhas novas: as gravadas antes dele ficam. O worker já usa até 3.000 de
-- cada conta, mas lê todas. Para ver quem passa do teto:
--
--   select user_id, count(*) from public.follows group by user_id having count(*) > 3000 order by 2 desc;
