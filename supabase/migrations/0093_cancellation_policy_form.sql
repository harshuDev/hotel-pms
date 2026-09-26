-- Settings -> Inventory -> Cancellation Policy, cloned from the client's
-- reference: a list (Policy Name, Default, a pencil, a cross) and the form --
-- Policy Title; How do you handle deposits?; How do you handle refunds of
-- deposits?; Do you have any other details?; Cancellation Policy; No-Show or
-- late cancellation policy; Breakfast; Use as default policy; and the
-- sentence the choices add up to.
--
-- WHAT IS LIVE:
--   * THE CANCELLATION CHOICE still decides `kind` and
--     `free_cancellation_days`, which `booking_cancellation_terms()` (the
--     booking screen and its cancel dialog) and `public_rate_plans()` (the
--     guest page) already read. Postgres derives them, so they cannot
--     disagree with the choice:
--       free at any time       -> flexible, 0 days (free until arrival)
--       no cancellation        -> non_refundable
--       free up to N days      -> flexible, N days
--       free up to N hours     -> flexible, ceil(N / 24) days -- the terms are
--                                 dated by business date, so hours round UP
--                                 to whole days: never a promise the hotel
--                                 did not make
--       custom                 -> custom (0092): the hotel's words, no date
--   * THE SENTENCE the form builds is saved as `description`, which the guest
--     page already shows as the policy's wording -- so the deposit, refund,
--     other details, no-show and breakfast choices reach the guest in words.
--     Built by the pure `cancellationPolicySummary()`; like every hotel's own
--     wording it is not translated.
--   * USE AS DEFAULT POLICY: exactly one per property, by a partial unique
--     index. A new rate plan with no policy is given the default by trigger.
--     The default cannot be unticked or deleted -- tick another instead.
--   * A POLICY CAN BE DELETED when it is not the default and no rate plan
--     uses it; one in use is refused by name. There is no longer an Active
--     switch: the reference has none, and a policy nobody uses can simply go.
--
-- WHAT IS STORED: deposits, refunds and no-show are not collected or charged
-- by anything -- there is no card capture ("Card capture is not built"). They
-- are the hotel's stated terms, shown to the guest in the sentence.
--
-- NOT BUILT: "Flexible Cancellation Fee based at cancellation period" -- its
-- fee schedule has not been seen. The reference's LOCALE picker and per-field
-- translate button are not copied, as elsewhere.

alter table public.cancellation_policies
  drop constraint cancellation_policies_days_match_kind,
  add constraint cancellation_policies_days_match_kind check (
    (kind = 'flexible' and free_cancellation_days is not null and free_cancellation_days >= 0)
    or (kind in ('non_refundable', 'custom') and free_cancellation_days is null)
  ),
  add column deposit_rule text
    check (deposit_rule in ('none', 'full', 'nights', 'percent', 'per_booking', 'per_room')),
  add column deposit_nights integer,
  add column deposit_percent_bps integer,
  add column deposit_amount_cents bigint,
  add column refund_rule text check (refund_rule in ('non_refundable', 'until_days', 'custom')),
  add column refund_days integer,
  add column refund_custom text,
  add column balance_due text check (balance_due in ('arrival', 'departure')),
  add column preauthorise_card boolean not null default false,
  add column other_custom text,
  add column cancel_rule text check (cancel_rule in ('free_any_time', 'no_cancellation', 'free_until', 'custom')),
  add column cancel_value integer,
  add column cancel_unit text check (cancel_unit in ('days', 'hours')),
  add column cancel_custom text,
  add column no_show_rule text check (no_show_rule in ('first_night', 'total', 'custom')),
  add column no_show_custom text,
  add column breakfast_omit boolean not null default true,
  add column breakfast_custom text,
  add column is_default boolean not null default false,
  add constraint cancellation_policies_deposit_value check (
    (deposit_rule is distinct from 'nights' or deposit_nights between 1 and 365)
    and (deposit_rule is distinct from 'percent' or deposit_percent_bps between 1 and 10000)
    and (deposit_rule not in ('per_booking', 'per_room') or deposit_rule is null or deposit_amount_cents > 0)
  );

create unique index cancellation_policies_one_default
  on public.cancellation_policies (property_id) where is_default;

-- The existing policies, read into the new choices, and each property's
-- first active policy made its default.
update public.cancellation_policies set
  cancel_rule = case when kind = 'non_refundable' then 'no_cancellation' else 'free_until' end,
  cancel_value = case when kind = 'flexible' then free_cancellation_days end,
  cancel_unit = case when kind = 'flexible' then 'days' end;

update public.cancellation_policies c set is_default = true
where c.id = (
  select c2.id from public.cancellation_policies c2
  where c2.property_id = c.property_id and c2.is_active
  order by c2.sort_order, c2.created_at
  limit 1
);

drop function public.save_cancellation_policy(text, public.cancellation_policy_kind, integer, text, boolean, integer, uuid);

create or replace function public.save_cancellation_policy_terms(
  p_id uuid,
  p_name text,
  p_deposit_rule text,
  p_deposit_nights integer,
  p_deposit_percent_bps integer,
  p_deposit_amount_cents bigint,
  p_refund_rule text,
  p_refund_days integer,
  p_refund_custom text,
  p_balance_due text,
  p_preauthorise_card boolean,
  p_other_custom text,
  p_cancel_rule text,
  p_cancel_value integer,
  p_cancel_unit text,
  p_cancel_custom text,
  p_no_show_rule text,
  p_no_show_custom text,
  p_breakfast_omit boolean,
  p_breakfast_custom text,
  p_is_default boolean,
  p_summary text
)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_property uuid;
  v_name text := btrim(coalesce(p_name, ''));
  v_kind public.cancellation_policy_kind;
  v_days integer;
  v_was_default boolean;
  v_id uuid;
  v_refund_custom text := nullif(btrim(coalesce(p_refund_custom, '')), '');
  v_other_custom text := nullif(btrim(coalesce(p_other_custom, '')), '');
  v_cancel_custom text := nullif(btrim(coalesce(p_cancel_custom, '')), '');
  v_no_show_custom text := nullif(btrim(coalesce(p_no_show_custom, '')), '');
  v_breakfast_custom text := nullif(btrim(coalesce(p_breakfast_custom, '')), '');
begin
  if not public.is_revenue_staff() then
    raise exception 'Only managers and administrators can change the cancellation policies';
  end if;
  v_property := public.current_property_id();
  if v_property is null then
    raise exception 'No active staff account for the current user';
  end if;
  if v_name = '' then
    raise exception 'Write the policy title';
  end if;

  -- Deposits
  if p_deposit_rule is not null and p_deposit_rule not in ('none', 'full', 'nights', 'percent', 'per_booking', 'per_room') then
    raise exception 'Choose how deposits are handled';
  end if;
  if p_deposit_rule = 'nights' and coalesce(p_deposit_nights, 0) not between 1 and 365 then
    raise exception 'Write how many nights the deposit is';
  end if;
  if p_deposit_rule = 'percent' and coalesce(p_deposit_percent_bps, 0) not between 1 and 10000 then
    raise exception 'Write the deposit percentage, above 0 and up to 100';
  end if;
  if p_deposit_rule in ('per_booking', 'per_room') and coalesce(p_deposit_amount_cents, 0) <= 0 then
    raise exception 'Write the deposit amount, above 0';
  end if;

  -- Refunds of deposits
  if p_refund_rule is not null and p_refund_rule not in ('non_refundable', 'until_days', 'custom') then
    raise exception 'Choose how refunds of deposits are handled';
  end if;
  if p_refund_rule = 'until_days' and coalesce(p_refund_days, -1) not between 0 and 365 then
    raise exception 'Write how many days before arrival a deposit is refundable';
  end if;
  if p_refund_rule = 'custom' and v_refund_custom is null then
    raise exception 'Write the custom refund policy';
  end if;

  -- Other details
  if p_balance_due is not null and p_balance_due not in ('arrival', 'departure') then
    raise exception 'Choose when the remaining balance is paid';
  end if;

  -- Cancellation: required, and the one choice the booking screen enforces.
  if p_cancel_rule is null or p_cancel_rule not in ('free_any_time', 'no_cancellation', 'free_until', 'custom') then
    raise exception 'Choose the cancellation policy';
  end if;
  if p_cancel_rule = 'free_until' then
    if coalesce(p_cancel_unit, '') not in ('days', 'hours') then
      raise exception 'Choose days or hours before arrival';
    end if;
    if p_cancel_unit = 'days' and coalesce(p_cancel_value, -1) not between 0 and 365 then
      raise exception 'Write how many days before arrival cancellation is free';
    end if;
    if p_cancel_unit = 'hours' and coalesce(p_cancel_value, -1) not between 0 and 8760 then
      raise exception 'Write how many hours before arrival cancellation is free';
    end if;
  end if;
  if p_cancel_rule = 'custom' and v_cancel_custom is null then
    raise exception 'Write the custom cancellation policy';
  end if;

  v_kind := case p_cancel_rule
    when 'no_cancellation' then 'non_refundable'::public.cancellation_policy_kind
    when 'custom' then 'custom'::public.cancellation_policy_kind
    else 'flexible'::public.cancellation_policy_kind
  end;
  v_days := case p_cancel_rule
    when 'free_any_time' then 0
    -- Terms are dated by business date: hours round UP to whole days.
    when 'free_until' then case when p_cancel_unit = 'hours'
                                then (p_cancel_value + 23) / 24
                                else p_cancel_value end
  end;

  -- No-show
  if p_no_show_rule is not null and p_no_show_rule not in ('first_night', 'total', 'custom') then
    raise exception 'Choose the no-show policy';
  end if;
  if p_no_show_rule = 'custom' and v_no_show_custom is null then
    raise exception 'Write the custom no-show policy';
  end if;

  if char_length(coalesce(p_summary, '')) > 4000 then
    raise exception 'The policy is too long';
  end if;

  select is_default into v_was_default from public.cancellation_policies
  where id = p_id and property_id = v_property;
  if coalesce(v_was_default, false) and not coalesce(p_is_default, false) then
    raise exception 'This is the default policy. Make another policy the default instead.';
  end if;

  -- One default: stand the old one down first, or the index refuses. The
  -- first policy a property has is its default whatever the tick says.
  if coalesce(p_is_default, false)
     or not exists (select 1 from public.cancellation_policies where property_id = v_property) then
    update public.cancellation_policies set is_default = false
    where property_id = v_property and is_default and (p_id is null or id <> p_id);
  end if;

  if p_id is null then
    insert into public.cancellation_policies (
      property_id, name, kind, free_cancellation_days, description,
      deposit_rule, deposit_nights, deposit_percent_bps, deposit_amount_cents,
      refund_rule, refund_days, refund_custom,
      balance_due, preauthorise_card, other_custom,
      cancel_rule, cancel_value, cancel_unit, cancel_custom,
      no_show_rule, no_show_custom, breakfast_omit, breakfast_custom,
      is_default
    ) values (
      v_property, v_name, v_kind, v_days, nullif(btrim(coalesce(p_summary, '')), ''),
      p_deposit_rule,
      case when p_deposit_rule = 'nights' then p_deposit_nights end,
      case when p_deposit_rule = 'percent' then p_deposit_percent_bps end,
      case when p_deposit_rule in ('per_booking', 'per_room') then p_deposit_amount_cents end,
      p_refund_rule,
      case when p_refund_rule = 'until_days' then p_refund_days end,
      case when p_refund_rule = 'custom' then v_refund_custom end,
      p_balance_due, coalesce(p_preauthorise_card, false), v_other_custom,
      p_cancel_rule,
      case when p_cancel_rule = 'free_until' then p_cancel_value end,
      case when p_cancel_rule = 'free_until' then p_cancel_unit end,
      case when p_cancel_rule = 'custom' then v_cancel_custom end,
      p_no_show_rule,
      case when p_no_show_rule = 'custom' then v_no_show_custom end,
      coalesce(p_breakfast_omit, true),
      case when not coalesce(p_breakfast_omit, true) then v_breakfast_custom end,
      coalesce(p_is_default, false)
        or not exists (select 1 from public.cancellation_policies where property_id = v_property)
    )
    returning id into v_id;
    return v_id;
  end if;

  update public.cancellation_policies set
    name = v_name,
    kind = v_kind,
    free_cancellation_days = v_days,
    description = nullif(btrim(coalesce(p_summary, '')), ''),
    deposit_rule = p_deposit_rule,
    deposit_nights = case when p_deposit_rule = 'nights' then p_deposit_nights end,
    deposit_percent_bps = case when p_deposit_rule = 'percent' then p_deposit_percent_bps end,
    deposit_amount_cents = case when p_deposit_rule in ('per_booking', 'per_room') then p_deposit_amount_cents end,
    refund_rule = p_refund_rule,
    refund_days = case when p_refund_rule = 'until_days' then p_refund_days end,
    refund_custom = case when p_refund_rule = 'custom' then v_refund_custom end,
    balance_due = p_balance_due,
    preauthorise_card = coalesce(p_preauthorise_card, false),
    other_custom = v_other_custom,
    cancel_rule = p_cancel_rule,
    cancel_value = case when p_cancel_rule = 'free_until' then p_cancel_value end,
    cancel_unit = case when p_cancel_rule = 'free_until' then p_cancel_unit end,
    cancel_custom = case when p_cancel_rule = 'custom' then v_cancel_custom end,
    no_show_rule = p_no_show_rule,
    no_show_custom = case when p_no_show_rule = 'custom' then v_no_show_custom end,
    breakfast_omit = coalesce(p_breakfast_omit, true),
    breakfast_custom = case when not coalesce(p_breakfast_omit, true) then v_breakfast_custom end,
    is_default = coalesce(p_is_default, false) or coalesce(v_was_default, false),
    is_active = true,
    updated_at = now()
  where id = p_id and property_id = v_property
  returning id into v_id;
  if v_id is null then
    raise exception 'That cancellation policy is not on this property';
  end if;
  return v_id;
end;
$$;

revoke execute on function public.save_cancellation_policy_terms(
  uuid, text, text, integer, integer, bigint, text, integer, text, text, boolean, text,
  text, integer, text, text, text, text, boolean, text, boolean, text
) from public, anon;
grant execute on function public.save_cancellation_policy_terms(
  uuid, text, text, integer, integer, bigint, text, integer, text, text, boolean, text,
  text, integer, text, text, text, text, boolean, text, boolean, text
) to authenticated;

create or replace function public.delete_cancellation_policy(p_id uuid)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_policy public.cancellation_policies;
  v_plans integer;
begin
  if not public.is_revenue_staff() then
    raise exception 'Only managers and administrators can change the cancellation policies';
  end if;
  select * into v_policy from public.cancellation_policies
  where id = p_id and property_id = public.current_property_id();
  if not found then
    raise exception 'That cancellation policy is not on this property';
  end if;
  if v_policy.is_default then
    raise exception '% is the default policy. Make another policy the default first.', v_policy.name;
  end if;
  select count(*) into v_plans from public.rate_plans
  where cancellation_policy_id = v_policy.id and property_id = v_policy.property_id;
  if v_plans > 0 then
    raise exception '% is on % rate plan%. Move them to another policy first.',
      v_policy.name, v_plans, case when v_plans = 1 then '' else 's' end;
  end if;
  delete from public.cancellation_policies
  where id = v_policy.id and property_id = v_policy.property_id;
end;
$$;

revoke execute on function public.delete_cancellation_policy(uuid) from public, anon;
grant execute on function public.delete_cancellation_policy(uuid) to authenticated;

-- A new rate plan with no policy takes the property's default.
create or replace function public.rate_plans_default_cancellation_policy()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.cancellation_policy_id is null then
    select c.id into new.cancellation_policy_id
    from public.cancellation_policies c
    where c.property_id = new.property_id and c.is_default;
  end if;
  return new;
end;
$$;

revoke execute on function public.rate_plans_default_cancellation_policy() from public, anon;

create trigger rate_plans_default_cancellation_policy
  before insert on public.rate_plans
  for each row execute function public.rate_plans_default_cancellation_policy();

drop function public.cancellation_policies_list();

create function public.cancellation_policies_list()
returns table (
  id uuid, name text, kind public.cancellation_policy_kind, free_cancellation_days integer,
  description text, is_active boolean, sort_order integer, rate_plan_count integer,
  is_default boolean,
  deposit_rule text, deposit_nights integer, deposit_percent_bps integer, deposit_amount_cents bigint,
  refund_rule text, refund_days integer, refund_custom text,
  balance_due text, preauthorise_card boolean, other_custom text,
  cancel_rule text, cancel_value integer, cancel_unit text, cancel_custom text,
  no_show_rule text, no_show_custom text, breakfast_omit boolean, breakfast_custom text
)
language sql
stable
set search_path = public
as $$
  select
    c.id, c.name, c.kind, c.free_cancellation_days, c.description, c.is_active, c.sort_order,
    (
      select count(*)::integer
      from public.rate_plans rp
      where rp.cancellation_policy_id = c.id
        and rp.property_id = c.property_id
    ),
    c.is_default,
    c.deposit_rule, c.deposit_nights, c.deposit_percent_bps, c.deposit_amount_cents,
    c.refund_rule, c.refund_days, c.refund_custom,
    c.balance_due, c.preauthorise_card, c.other_custom,
    c.cancel_rule, c.cancel_value, c.cancel_unit, c.cancel_custom,
    c.no_show_rule, c.no_show_custom, c.breakfast_omit, c.breakfast_custom
  from public.cancellation_policies c
  where c.property_id = public.current_property_id()
  order by c.sort_order, c.created_at, c.name;
$$;

revoke execute on function public.cancellation_policies_list() from public, anon;
grant execute on function public.cancellation_policies_list() to authenticated;
