-- Phase 4: property-scoped, append-only cashier drawer control.
-- Business dates are selected from business_dates; never inferred from time.

create type public.cashier_shift_status as enum ('open', 'closing', 'closed');
create type public.cash_movement_type as enum ('paid_out', 'cash_drop', 'cash_added', 'cash_adjustment', 'correction');
create type public.cash_movement_direction as enum ('in', 'out');

create table public.cashier_shifts (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties(id) on delete restrict,
  cashier_id uuid not null,
  business_date_id uuid not null,
  status public.cashier_shift_status not null default 'open',
  opening_balance_cents bigint not null,
  counted_cash_cents bigint,
  expected_cash_at_close_cents bigint,
  variance_cents bigint,
  opened_at timestamptz not null default now(), closed_at timestamptz,
  opening_notes text, closing_notes text, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique (id, property_id),
  foreign key (cashier_id, property_id) references public.staff_users(id, property_id) on delete restrict,
  foreign key (business_date_id, property_id) references public.business_dates(id, property_id) on delete restrict,
  constraint cashier_shifts_opening_nonnegative check (opening_balance_cents >= 0),
  constraint cashier_shifts_close_snapshot check ((status <> 'closed' and counted_cash_cents is null and expected_cash_at_close_cents is null and variance_cents is null and closed_at is null) or (status = 'closed' and counted_cash_cents is not null and expected_cash_at_close_cents is not null and variance_cents is not null and closed_at is not null))
);
create unique index cashier_shifts_one_open_per_cashier_date on public.cashier_shifts(property_id, cashier_id, business_date_id) where status in ('open', 'closing');

alter table public.payments add constraint payments_shift_property_fk foreign key (shift_id, property_id) references public.cashier_shifts(id, property_id) on delete restrict;

create table public.cash_movements (
  id uuid primary key default gen_random_uuid(), property_id uuid not null references public.properties(id) on delete restrict,
  shift_id uuid not null, business_date_id uuid not null,
  movement_type public.cash_movement_type not null, direction public.cash_movement_direction not null,
  amount_cents bigint not null, reason text not null, reference text, created_by uuid not null, approved_by uuid,
  created_at timestamptz not null default now(),
  unique (id, property_id),
  foreign key (shift_id, property_id) references public.cashier_shifts(id, property_id) on delete restrict,
  foreign key (business_date_id, property_id) references public.business_dates(id, property_id) on delete restrict,
  foreign key (created_by, property_id) references public.staff_users(id, property_id) on delete restrict,
  foreign key (approved_by, property_id) references public.staff_users(id, property_id) on delete restrict,
  constraint cash_movements_amount_positive check (amount_cents > 0),
  constraint cash_movements_direction_valid check ((movement_type in ('paid_out','cash_drop') and direction = 'out') or (movement_type = 'cash_added' and direction = 'in') or (movement_type in ('cash_adjustment','correction'))),
  constraint cash_movements_approval_required check (movement_type not in ('cash_adjustment','correction') or approved_by is not null)
);
create index cash_movements_shift_created_idx on public.cash_movements(property_id, shift_id, created_at desc);

create function public.cashier_shift_expected(p_shift_id uuid)
returns table(opening_balance_cents bigint, cash_payments_cents bigint, cash_added_cents bigint, paid_outs_cents bigint, cash_drops_cents bigint, adjustments_cents bigint, expected_cash_cents bigint)
language sql stable security invoker set search_path = public as $$
  select s.opening_balance_cents,
    coalesce((select sum(p.signed_amount_cents) from payments p join payment_methods pm on pm.id=p.payment_method_id and pm.property_id=p.property_id where p.shift_id=s.id and pm.affects_drawer),0)::bigint,
    coalesce((select sum(m.amount_cents) from cash_movements m where m.shift_id=s.id and m.movement_type='cash_added'),0)::bigint,
    coalesce((select sum(m.amount_cents) from cash_movements m where m.shift_id=s.id and m.movement_type='paid_out'),0)::bigint,
    coalesce((select sum(m.amount_cents) from cash_movements m where m.shift_id=s.id and m.movement_type='cash_drop'),0)::bigint,
    coalesce((select sum(case when m.direction='in' then m.amount_cents else -m.amount_cents end) from cash_movements m where m.shift_id=s.id and m.movement_type in ('cash_adjustment','correction')),0)::bigint,
    (s.opening_balance_cents + coalesce((select sum(p.signed_amount_cents) from payments p join payment_methods pm on pm.id=p.payment_method_id and pm.property_id=p.property_id where p.shift_id=s.id and pm.affects_drawer),0) + coalesce((select sum(case when m.movement_type='cash_added' then m.amount_cents when m.movement_type in ('paid_out','cash_drop') then -m.amount_cents else case when m.direction='in' then m.amount_cents else -m.amount_cents end end) from cash_movements m where m.shift_id=s.id),0))::bigint
  from cashier_shifts s where s.id=p_shift_id and s.property_id=current_property_id();
$$;

create view public.cashier_shift_summaries with (security_invoker = true) as
select s.id as shift_id, s.property_id, s.cashier_id, bd.id as business_date_id, bd.business_date, s.status, s.opened_at, s.closed_at,
  e.opening_balance_cents, e.cash_payments_cents, e.cash_added_cents, e.paid_outs_cents, e.cash_drops_cents, e.adjustments_cents, e.expected_cash_cents,
  s.counted_cash_cents, s.expected_cash_at_close_cents, s.variance_cents
from cashier_shifts s join business_dates bd on bd.id=s.business_date_id and bd.property_id=s.property_id
cross join lateral cashier_shift_expected(s.id) e;

create function public.open_cashier_shift(p_opening_balance_cents bigint, p_opening_notes text default null)
returns uuid language plpgsql security definer set search_path=public,auth as $$
declare v_property uuid:=current_property_id(); v_date business_dates; v_id uuid;
begin
  if auth.uid() is null or current_role() not in ('admin','manager','front_desk','cashier') then raise exception 'Not authorised to open a cashier shift'; end if;
  if p_opening_balance_cents < 0 then raise exception 'Opening balance must be non-negative'; end if;
  select * into v_date from business_dates where property_id=v_property and status='open' for update;
  if not found then raise exception 'No open business date for property'; end if;
  insert into cashier_shifts(property_id,cashier_id,business_date_id,opening_balance_cents,opening_notes) values(v_property,auth.uid(),v_date.id,p_opening_balance_cents,p_opening_notes) returning id into v_id;
  insert into activity_log(property_id,actor_id,entity_type,entity_id,action,summary,metadata) values(v_property,auth.uid(),'cashier_shift',v_id,'cashier_shift_opened','Cashier shift opened',jsonb_build_object('business_date_id',v_date.id,'opening_balance_cents',p_opening_balance_cents));
  return v_id;
end; $$;

create function public.record_cash_movement(p_shift_id uuid,p_movement_type public.cash_movement_type,p_amount_cents bigint,p_reason text,p_reference text default null,p_direction public.cash_movement_direction default null)
returns uuid language plpgsql security definer set search_path=public,auth as $$
declare s cashier_shifts; v_id uuid; d cash_movement_direction;
begin
  if current_role() not in ('admin','manager','front_desk','cashier') then raise exception 'Not authorised'; end if;
  select * into s from cashier_shifts where id=p_shift_id and property_id=current_property_id() and status='open' for update;
  if not found then raise exception 'Open cashier shift not found'; end if;
  if s.cashier_id <> auth.uid() and current_role() not in ('admin','manager') then raise exception 'Cannot post to another cashier drawer'; end if;
  d:=coalesce(p_direction,case when p_movement_type='cash_added' then 'in'::cash_movement_direction else 'out'::cash_movement_direction end);
  if p_amount_cents<=0 or btrim(p_reason)='' then raise exception 'Amount and reason are required'; end if;
  insert into cash_movements(property_id,shift_id,business_date_id,movement_type,direction,amount_cents,reason,reference,created_by,approved_by) values(s.property_id,s.id,s.business_date_id,p_movement_type,d,p_amount_cents,p_reason,p_reference,auth.uid(),case when p_movement_type in ('cash_adjustment','correction') then auth.uid() end) returning id into v_id;
  insert into activity_log(property_id,actor_id,entity_type,entity_id,action,summary,metadata) values(s.property_id,auth.uid(),'cash_movement',v_id,p_movement_type::text,replace(p_movement_type::text,'_',' '),jsonb_build_object('shift_id',s.id,'amount_cents',p_amount_cents)); return v_id;
end; $$;

create function public.close_cashier_shift(p_shift_id uuid,p_counted_cash_cents bigint,p_closing_notes text default null)
returns table(expected_cash_cents bigint,variance_cents bigint) language plpgsql security definer set search_path=public,auth as $$
declare s cashier_shifts; e record;
begin
  if p_counted_cash_cents<0 then raise exception 'Counted cash must be non-negative'; end if;
  select * into s from cashier_shifts where id=p_shift_id and property_id=current_property_id() and status='open' for update;
  if not found or (s.cashier_id<>auth.uid() and current_role() not in ('admin','manager')) then raise exception 'Open cashier shift not found or not authorised'; end if;
  select * into e from cashier_shift_expected(s.id);
  update cashier_shifts set status='closed',counted_cash_cents=p_counted_cash_cents,expected_cash_at_close_cents=e.expected_cash_cents,variance_cents=p_counted_cash_cents-e.expected_cash_cents,closing_notes=p_closing_notes,closed_at=now(),updated_at=now() where id=s.id;
  insert into activity_log(property_id,actor_id,entity_type,entity_id,action,summary,metadata) values(s.property_id,auth.uid(),'cashier_shift',s.id,'cashier_shift_closed','Cashier shift closed',jsonb_build_object('counted_cash_cents',p_counted_cash_cents,'expected_cash_cents',e.expected_cash_cents,'variance_cents',p_counted_cash_cents-e.expected_cash_cents));
  if p_counted_cash_cents<>e.expected_cash_cents then insert into activity_log(property_id,actor_id,entity_type,entity_id,action,summary,metadata) values(s.property_id,auth.uid(),'cashier_shift',s.id,'cashier_variance_recorded','Cashier variance recorded',jsonb_build_object('variance_cents',p_counted_cash_cents-e.expected_cash_cents)); end if;
  return query select e.expected_cash_cents::bigint,(p_counted_cash_cents-e.expected_cash_cents)::bigint;
end; $$;

create function public.validate_cash_payment_shift() returns trigger language plpgsql security definer set search_path=public as $$
declare s cashier_shifts; m payment_methods;
begin select * into m from payment_methods where id=new.payment_method_id and property_id=new.property_id; if m.affects_drawer then if new.shift_id is null then raise exception 'Cash payments require a cashier shift'; end if; select * into s from cashier_shifts where id=new.shift_id and property_id=new.property_id and status='open'; if not found or s.business_date_id <> (select id from business_dates where property_id=new.property_id and business_date=new.business_date) then raise exception 'Cash payment must use an open shift on its business date'; end if; elsif new.shift_id is not null then raise exception 'Only cash payments may reference a cashier shift'; end if; return new; end; $$;
create trigger payments_validate_cash_shift before insert on public.payments for each row execute function public.validate_cash_payment_shift();
create function public.prevent_cashier_mutation() returns trigger language plpgsql as $$ begin raise exception '% is append-only',tg_table_name; end; $$;
create trigger cash_movements_immutable before update or delete on public.cash_movements for each row execute function public.prevent_cashier_mutation();
create function public.protect_cashier_shift() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' or old.status = 'closed' then raise exception 'Closed cashier shifts are immutable'; end if;
  if new.opening_balance_cents <> old.opening_balance_cents or new.opened_at <> old.opened_at or new.cashier_id <> old.cashier_id or new.business_date_id <> old.business_date_id then
    raise exception 'Cashier shift opening facts are immutable';
  end if;
  return new;
end; $$;
create trigger cashier_shifts_protect_before_write before update or delete on public.cashier_shifts for each row execute function public.protect_cashier_shift();

alter table public.cashier_shifts enable row level security; alter table public.cash_movements enable row level security;
create policy cashier_shifts_select_property on public.cashier_shifts for select using(property_id=current_property_id());
create policy cash_movements_select_property on public.cash_movements for select using(property_id=current_property_id());
revoke all on public.cashier_shifts,public.cash_movements from anon,authenticated; grant select on public.cashier_shifts,public.cash_movements,public.cashier_shift_summaries to authenticated;
grant execute on function public.open_cashier_shift(bigint,text),public.record_cash_movement(uuid,public.cash_movement_type,bigint,text,text,public.cash_movement_direction),public.close_cashier_shift(uuid,bigint,text) to authenticated;
