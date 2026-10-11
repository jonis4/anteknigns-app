-- Räknar AI-anrop per användare och dygn, så att Edge Function "ai" kan sätta en gräns.
-- Körs en gång i Supabase: SQL Editor → klistra in → Run.

create table if not exists ai_usage (
  user_id uuid    not null,
  day     date    not null default current_date,
  count   integer not null default 0,
  primary key (user_id, day)
);

-- Inga policies: bara serverfunktionen (service role) kommer åt tabellen.
alter table ai_usage enable row level security;

-- Räknar upp dagens anrop och svarar om användaren är inom gränserna.
create or replace function count_ai_call(p_user uuid, p_user_limit integer, p_total_limit integer)
returns boolean
language plpgsql
set search_path = public
as $$
declare
  user_count integer;
  total_count integer;
begin
  insert into ai_usage (user_id, day, count)
  values (p_user, current_date, 1)
  on conflict (user_id, day) do update set count = ai_usage.count + 1
  returning count into user_count;

  select coalesce(sum(count), 0) into total_count from ai_usage where day = current_date;

  return user_count <= p_user_limit and total_count <= p_total_limit;
end;
$$;

revoke execute on function count_ai_call(uuid, integer, integer) from public, anon, authenticated;
grant execute on function count_ai_call(uuid, integer, integer) to service_role;
