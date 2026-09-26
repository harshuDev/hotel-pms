-- Settings -> Inventory -> Discounts, cloned from the client's reference: a
-- searchable list (Title, Type, Amount) and "Add Discount" -- Title, Amount,
-- and Type as Percent or Fixed.
--
-- THE AMOUNT IS NEVER A FLOAT. A percentage is basis points, as every rate in
-- this schema is (1000 = 10.0 %); a fixed amount is integer minor units of the
-- property's currency. A check constraint makes each kind carry exactly its
-- own column, so a discount can never be "10" of an unknown unit.
--
-- STORED, NOT YET APPLIED. Nothing takes a discount off a stay yet. Applying
-- one is a money change -- to a booking's nights before the audit, or to the
-- folio after it -- and the folio path that exists, `post_discount()`, posts
-- every discount with no tax split, which is wrong on a VAT-inclusive rate.
-- It is raised with the client rather than slipped in with a settings
-- screen. A promotion (Offers) is still what reduces a stay automatically.
--
-- Genuinely deleted: nothing points at a discount.

create table public.discounts (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties(id) on delete cascade,
  title text not null check (btrim(title) <> '' and char_length(title) <= 80),
  kind text not null check (kind in ('percent', 'fixed')),
  percent_bps integer,
  amount_cents bigint,
  created_at timestamptz not null default now(),
  constraint discounts_amount_matches_kind check (
    (kind = 'percent' and percent_bps between 1 and 10000 and amount_cents is null)
    or (kind = 'fixed' and amount_cents > 0 and percent_bps is null)
  )
);

create unique index discounts_title_unique
  on public.discounts (property_id, lower(btrim(title)));

alter table public.discounts enable row level security;

create policy discounts_select_current_property on public.discounts
  for select using (property_id = public.current_property_id());
create policy discounts_insert_revenue_staff on public.discounts
  for insert with check (
    property_id = public.current_property_id() and public.is_revenue_staff()
  );
create policy discounts_update_revenue_staff on public.discounts
  for update using (
    property_id = public.current_property_id() and public.is_revenue_staff()
  ) with check (
    property_id = public.current_property_id() and public.is_revenue_staff()
  );
create policy discounts_delete_revenue_staff on public.discounts
  for delete using (
    property_id = public.current_property_id() and public.is_revenue_staff()
  );

grant select, insert, update, delete on public.discounts to authenticated;
revoke all on public.discounts from anon;

create or replace function public.save_discount(
  p_id uuid,
  p_title text,
  p_kind text,
  p_percent_bps integer,
  p_amount_cents bigint
)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_property uuid;
  v_title text := btrim(coalesce(p_title, ''));
  v_id uuid;
begin
  if not public.is_revenue_staff() then
    raise exception 'Only managers and administrators can change the discounts';
  end if;
  v_property := public.current_property_id();
  if v_property is null then
    raise exception 'No active staff account for the current user';
  end if;
  if v_title = '' then
    raise exception 'Write the title';
  end if;
  if char_length(v_title) > 80 then
    raise exception 'Keep the title to 80 characters';
  end if;
  if coalesce(p_kind, '') not in ('percent', 'fixed') then
    raise exception 'Choose Percent or Fixed';
  end if;
  if p_kind = 'percent' and (p_percent_bps is null or p_percent_bps < 1 or p_percent_bps > 10000) then
    raise exception 'A percent discount is more than 0 and at most 100';
  end if;
  if p_kind = 'fixed' and coalesce(p_amount_cents, 0) <= 0 then
    raise exception 'A fixed discount is more than 0';
  end if;
  if exists (
    select 1 from public.discounts d
    where d.property_id = v_property and lower(btrim(d.title)) = lower(v_title)
      and (p_id is null or d.id <> p_id)
  ) then
    raise exception 'There is already a discount called %', v_title;
  end if;

  if p_id is null then
    insert into public.discounts (property_id, title, kind, percent_bps, amount_cents)
    values (
      v_property, v_title, p_kind,
      case when p_kind = 'percent' then p_percent_bps end,
      case when p_kind = 'fixed' then p_amount_cents end
    )
    returning id into v_id;
    return v_id;
  end if;

  update public.discounts set
    title = v_title,
    kind = p_kind,
    -- Switching kind drops the other figure rather than refusing.
    percent_bps = case when p_kind = 'percent' then p_percent_bps end,
    amount_cents = case when p_kind = 'fixed' then p_amount_cents end
  where id = p_id and property_id = v_property
  returning id into v_id;
  if v_id is null then
    raise exception 'That discount is not on this property';
  end if;
  return v_id;
end;
$$;

revoke execute on function public.save_discount(uuid, text, text, integer, bigint) from public, anon;
grant execute on function public.save_discount(uuid, text, text, integer, bigint) to authenticated;

create or replace function public.delete_discount(p_id uuid)
returns void
language plpgsql
security invoker
set search_path = public
as $$
begin
  if not public.is_revenue_staff() then
    raise exception 'Only managers and administrators can change the discounts';
  end if;
  delete from public.discounts
  where id = p_id and property_id = public.current_property_id();
end;
$$;

revoke execute on function public.delete_discount(uuid) from public, anon;
grant execute on function public.delete_discount(uuid) to authenticated;
