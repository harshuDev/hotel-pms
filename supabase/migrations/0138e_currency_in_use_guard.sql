-- 0138, part e: a currency a rate plan is priced in cannot be removed from
-- Settings -> Currencies. A trigger rather than a change to
-- delete_currency_profile(), so every way of removing one is covered.

create or replace function public.currency_profiles_in_use_guard()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_plan text;
begin
  select rp.name into v_plan from public.rate_plans rp
  where rp.property_id = old.property_id and btrim(rp.currency) = btrim(old.currency)
  order by rp.name limit 1;
  if v_plan is not null then
    raise exception '% is priced in %, so that currency cannot be removed', v_plan, btrim(old.currency);
  end if;
  return old;
end;
$$;

create trigger currency_profiles_in_use_guard
  before delete on public.currency_profiles
  for each row execute function public.currency_profiles_in_use_guard();
