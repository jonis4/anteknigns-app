-- Molnkopian av anteckningarna. Enheten (IndexedDB) är sanningen, det här är en kopia som synkas.
-- Körs en gång i Supabase: SQL Editor → klistra in → Run.

create table if not exists notes (
  id                uuid primary key,
  user_id           uuid not null default auth.uid() references auth.users on delete cascade,
  versions          jsonb not null,
  title             text not null default '',
  category          text not null default '',
  private           boolean not null default false,
  created_at        bigint not null,
  updated_at        bigint not null,
  deleted           boolean not null default false,
  titled_at         bigint,
  -- Serverns klocka, inte enhetens. Appen hämtar "allt som ändrats sedan sist" utifrån den,
  -- så att en ändring som gjordes offline för länge sedan ändå kommer med.
  server_updated_at timestamptz not null default clock_timestamp()
);

create index if not exists notes_user_server_updated_at on notes (user_id, server_updated_at);

alter table notes enable row level security;

grant select, insert, update on notes to authenticated;

-- Var och en ser och ändrar bara sina egna rader.
drop policy if exists "egna anteckningar" on notes;
create policy "egna anteckningar" on notes
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- Anonyma konton (de som bara finns för AI-funktionen) får inte röra tabellen alls.
-- Restriktiv = gäller alltid, utöver policyn ovan.
drop policy if exists "bara konton med mejl" on notes;
create policy "bara konton med mejl" on notes
  as restrictive for all to authenticated
  using ((select (auth.jwt() ->> 'is_anonymous')::boolean) is false)
  with check ((select (auth.jwt() ->> 'is_anonymous')::boolean) is false);

-- Last-write-wins avgörs här, så att två enheter som skickar samtidigt inte kan skriva över en nyare rad.
create or replace function notes_before_write()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'UPDATE' then
    if new.updated_at <= old.updated_at then
      return null; -- raden på servern är lika ny eller nyare: behåll den
    end if;
    new.user_id := old.user_id;
  end if;
  new.server_updated_at := clock_timestamp();
  return new;
end;
$$;

drop trigger if exists notes_before_write on notes;
create trigger notes_before_write
  before insert or update on notes
  for each row execute function notes_before_write();
