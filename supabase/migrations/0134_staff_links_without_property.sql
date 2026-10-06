-- 0134: a staff reference names the person, not the person-at-a-hotel.
--
-- The client's platform team (0135) works across hotels with ONE login:
-- staff_users keeps one row per login, and switching hotel moves its
-- property_id. Fifteen columns pointed at staff_users through a composite
-- (staff id, property id) key, so the moment Juan had posted anything in
-- hotel A -- a booking, a charge, an activity line -- moving his row to hotel
-- B would be refused by every one of them (and ON UPDATE CASCADE would have
-- been worse: it would carry hotel A's bookings into hotel B).
--
-- So each now references staff_users(id) alone, with the same ON DELETE as
-- before. What the composite key also asserted -- that the actor belongs to
-- the row's hotel -- is still what every write path does: the actor is
-- auth.uid() and the property is current_property_id(), read together in the
-- same statement. A row written in hotel A keeps naming Juan after he moves.
--
-- The (id, property_id) unique key on staff_users stays; nothing is lost by
-- keeping it.

alter table public.business_dates
  drop constraint business_dates_opened_by_property_id_fkey,
  add constraint business_dates_opened_by_staff_fkey
    foreign key (opened_by) references public.staff_users (id) on delete restrict,
  drop constraint business_dates_closed_by_property_id_fkey,
  add constraint business_dates_closed_by_staff_fkey
    foreign key (closed_by) references public.staff_users (id) on delete restrict;

alter table public.room_status_history
  drop constraint room_status_history_changed_by_property_id_fkey,
  add constraint room_status_history_changed_by_staff_fkey
    foreign key (changed_by) references public.staff_users (id) on delete restrict;

alter table public.activity_log
  drop constraint activity_log_actor_id_property_id_fkey,
  add constraint activity_log_actor_id_staff_fkey
    foreign key (actor_id) references public.staff_users (id) on delete restrict;

alter table public.bookings
  drop constraint bookings_created_by_property_id_fkey,
  add constraint bookings_created_by_staff_fkey
    foreign key (created_by) references public.staff_users (id) on delete restrict;

alter table public.folio_items
  drop constraint folio_items_posted_by_property_id_fkey,
  add constraint folio_items_posted_by_staff_fkey
    foreign key (posted_by) references public.staff_users (id) on delete restrict;

alter table public.payments
  drop constraint payments_received_by_property_id_fkey,
  add constraint payments_received_by_staff_fkey
    foreign key (received_by) references public.staff_users (id) on delete restrict;

alter table public.cashier_shifts
  drop constraint cashier_shifts_cashier_id_property_id_fkey,
  add constraint cashier_shifts_cashier_id_staff_fkey
    foreign key (cashier_id) references public.staff_users (id) on delete restrict;

alter table public.cash_movements
  drop constraint cash_movements_created_by_property_id_fkey,
  add constraint cash_movements_created_by_staff_fkey
    foreign key (created_by) references public.staff_users (id) on delete restrict,
  drop constraint cash_movements_approved_by_property_id_fkey,
  add constraint cash_movements_approved_by_staff_fkey
    foreign key (approved_by) references public.staff_users (id) on delete restrict;

alter table public.rate_plan_days
  drop constraint rate_plan_days_updated_by_property_id_fkey,
  add constraint rate_plan_days_updated_by_staff_fkey
    foreign key (updated_by) references public.staff_users (id) on delete set null;

alter table public.room_type_days
  drop constraint room_type_days_updated_by_property_id_fkey,
  add constraint room_type_days_updated_by_staff_fkey
    foreign key (updated_by) references public.staff_users (id) on delete set null;

alter table public.promotions
  drop constraint promotions_created_by_property_id_fkey,
  add constraint promotions_created_by_staff_fkey
    foreign key (created_by) references public.staff_users (id) on delete set null;

alter table public.meeting_room_bookings
  drop constraint meeting_room_bookings_created_by_property_id_fkey,
  add constraint meeting_room_bookings_created_by_staff_fkey
    foreign key (created_by) references public.staff_users (id) on delete set null;

alter table public.booking_waitlist
  drop constraint booking_waitlist_created_by_property_id_fkey,
  add constraint booking_waitlist_created_by_staff_fkey
    foreign key (created_by) references public.staff_users (id) on delete restrict;
