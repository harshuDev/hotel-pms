-- 0138, part b: the live rates (see 0138a for the whole change).


-- Reference data shared by every hotel, so it carries no property_id: one
-- row per currency, how many of it one euro buys, in millionths.
create table public.exchange_rates (
  currency char(3) primary key check (currency ~ '^[A-Z]{3}$'),
  per_eur_micros bigint not null check (per_eur_micros > 0),
  source text not null check (source in ('peg', 'feed')),
  rate_date date,
  fetched_at timestamptz not null default now()
);

alter table public.exchange_rates enable row level security;

-- Read-only to staff; written only by refresh_exchange_rates(), as owner.
create policy exchange_rates_select_staff on public.exchange_rates
  for select to authenticated using (true);

revoke all on public.exchange_rates from anon;
grant select on public.exchange_rates to authenticated;

insert into public.exchange_rates (currency, per_eur_micros, source) values
  ('EUR', 1000000, 'peg'),
  ('XOF', 655957000, 'peg'),
  ('XAF', 655957000, 'peg')
on conflict (currency) do nothing;

-- Fetches today's rates against the euro and stores them. Two free sources
-- that need no key, the second tried only when the first fails; a failure of
-- both keeps yesterday's rates, which is the right thing for a booking to use
-- rather than none. Pegged currencies are never overwritten.
create or replace function public.refresh_exchange_rates()
returns integer
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_urls text[] := array[
    'https://open.er-api.com/v6/latest/EUR',
    'https://api.frankfurter.dev/v1/latest'
  ];
  v_url text;
  v_resp extensions.http_response;
  v_body jsonb;
  v_rates jsonb;
  v_date date;
  v_count integer := 0;
begin
  foreach v_url in array v_urls loop
    begin
      perform extensions.http_set_curlopt('CURLOPT_TIMEOUT_MS', '10000');
      v_resp := extensions.http_get(v_url);
      if v_resp.status <> 200 then
        continue;
      end if;
      v_body := v_resp.content::jsonb;
      v_rates := v_body -> 'rates';
      if v_rates is null or jsonb_typeof(v_rates) <> 'object' then
        continue;
      end if;
      v_date := coalesce(
        (v_body ->> 'date')::date,
        (to_timestamp(nullif(v_body ->> 'time_last_update_unix', '')::bigint))::date,
        current_date
      );

      insert into public.exchange_rates (currency, per_eur_micros, source, rate_date, fetched_at)
      select upper(r.key), round(r.value::text::numeric * 1000000)::bigint, 'feed', v_date, now()
      from jsonb_each(v_rates) r
      where upper(r.key) ~ '^[A-Z]{3}$'
        and jsonb_typeof(r.value) = 'number'
        and r.value::text::numeric > 0
        and round(r.value::text::numeric * 1000000) > 0
      on conflict (currency) do update set
        per_eur_micros = excluded.per_eur_micros,
        rate_date = excluded.rate_date,
        fetched_at = excluded.fetched_at
      where public.exchange_rates.source = 'feed';

      get diagnostics v_count = row_count;
      if v_count > 0 then
        return v_count;
      end if;
    exception when others then
      -- The next source, or yesterday's rates.
      null;
    end;
  end loop;
  return 0;
end;
$$;

revoke all on function public.refresh_exchange_rates() from public;
revoke execute on function public.refresh_exchange_rates() from anon, authenticated;

-- Every six hours, at a minute nobody else picks.
select cron.schedule('refresh-exchange-rates', '23 */6 * * *', $cron$select public.refresh_exchange_rates()$cron$);

-- Today's rates, so a plan can be set to a live currency at once.
select public.refresh_exchange_rates();
