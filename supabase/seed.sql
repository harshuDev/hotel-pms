-- Development-only Layer 3 examples. Values are INR paise (integer minor units).
-- This deliberately uses no auth identity: posted_by/received_by remain null.
insert into public.properties (id, name, timezone, currency, check_in_time, check_out_time)
values ('10000000-0000-0000-0000-000000000001', 'Grand Ferndale', 'Asia/Kolkata', 'INR', '14:00', '11:00');

insert into public.business_dates (property_id, business_date, status)
values ('10000000-0000-0000-0000-000000000001', current_date, 'open');
insert into public.channels (id, property_id, code, name, kind) values
  ('10000000-0000-0000-0000-000000000011', '10000000-0000-0000-0000-000000000001', 'DIRECT', 'Front Desk', 'direct'),
  ('10000000-0000-0000-0000-000000000012', '10000000-0000-0000-0000-000000000001', 'OTA', 'Booking.com', 'ota');
insert into public.customers (id, property_id, kind, first_name, last_name) values
  ('10000000-0000-0000-0000-000000000021', '10000000-0000-0000-0000-000000000001', 'personal', 'Asha', 'Mehta'),
  ('10000000-0000-0000-0000-000000000022', '10000000-0000-0000-0000-000000000001', 'personal', 'Rohan', 'Kapoor'),
  ('10000000-0000-0000-0000-000000000023', '10000000-0000-0000-0000-000000000001', 'personal', 'Mira', 'Sen');
insert into public.room_types (id, property_id, code, name, base_occupancy, max_occupancy) values
  ('10000000-0000-0000-0000-000000000031', '10000000-0000-0000-0000-000000000001', 'DLX', 'Deluxe', 2, 3);
insert into public.rooms (id, property_id, room_type_id, number) values
  ('10000000-0000-0000-0000-000000000041', '10000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000031', '101');
insert into public.tax_rates (id, property_id, name, rate_bps, inclusion) values
  ('10000000-0000-0000-0000-000000000051', '10000000-0000-0000-0000-000000000001', 'GST 12%', 1200, 'exclusive');
insert into public.payment_methods (id, property_id, kind, name, affects_drawer) values
  ('10000000-0000-0000-0000-000000000061', '10000000-0000-0000-0000-000000000001', 'cash', 'Cash', true),
  ('10000000-0000-0000-0000-000000000062', '10000000-0000-0000-0000-000000000001', 'card', 'Card', false),
  ('10000000-0000-0000-0000-000000000063', '10000000-0000-0000-0000-000000000001', 'ota_prepaid', 'OTA Prepaid', false),
  ('10000000-0000-0000-0000-000000000064', '10000000-0000-0000-0000-000000000001', 'upi', 'UPI', false),
  ('10000000-0000-0000-0000-000000000065', '10000000-0000-0000-0000-000000000001', 'bank_transfer', 'Bank transfer', false),
  ('10000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'virtual_card', 'Virtual card', false),
  ('10000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', 'complimentary', 'Complimentary', false),
  ('10000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000001', 'other', 'Other', false);

-- Three primary guest folios are created by the booking trigger: open,
-- partially paid, and fully settled respectively.
insert into public.bookings (id, property_id, reference, customer_id, channel_id, status, settlement, check_in, check_out) values
  ('10000000-0000-0000-0000-000000000071', '10000000-0000-0000-0000-000000000001', 'GF-OPEN', '10000000-0000-0000-0000-000000000021', '10000000-0000-0000-0000-000000000011', 'checked_in', 'at_property', current_date, current_date + 2),
  ('10000000-0000-0000-0000-000000000072', '10000000-0000-0000-0000-000000000001', 'GF-PARTIAL', '10000000-0000-0000-0000-000000000022', '10000000-0000-0000-0000-000000000011', 'checked_in', 'at_property', current_date, current_date + 1),
  ('10000000-0000-0000-0000-000000000073', '10000000-0000-0000-0000-000000000001', 'GF-OTA', '10000000-0000-0000-0000-000000000023', '10000000-0000-0000-0000-000000000012', 'checked_in', 'prepaid_to_channel', current_date, current_date + 1);
insert into public.booking_rooms (id, property_id, booking_id, room_type_id, room_id, status, check_in, check_out) values
  ('10000000-0000-0000-0000-000000000081', '10000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000071', '10000000-0000-0000-0000-000000000031', '10000000-0000-0000-0000-000000000041', 'checked_in', current_date, current_date + 2),
  ('10000000-0000-0000-0000-000000000082', '10000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000072', '10000000-0000-0000-0000-000000000031', null, 'checked_in', current_date, current_date + 1),
  ('10000000-0000-0000-0000-000000000083', '10000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000073', '10000000-0000-0000-0000-000000000031', null, 'checked_in', current_date, current_date + 1);
update public.booking_room_nights set room_rate_cents = 150000, tax_cents = 18000 where booking_room_id = '10000000-0000-0000-0000-000000000081' and stay_date = current_date;
update public.booking_room_nights set room_rate_cents = 120000, tax_cents = 14400 where booking_room_id = '10000000-0000-0000-0000-000000000082';
update public.booking_room_nights set room_rate_cents = 140000, tax_cents = 16800 where booking_room_id = '10000000-0000-0000-0000-000000000083';

-- Charges include room, tax, a minibar charge, and an explicit reversal trail.
insert into public.folio_items (property_id, folio_id, booking_id, business_date, item_type, description, quantity, unit_amount_cents, net_amount_cents, tax_amount_cents, amount_cents, tax_rate_id)
select f.property_id, f.id, f.booking_id, current_date, 'room_charge', 'Room charge', 1, 150000, 150000, 18000, 168000, '10000000-0000-0000-0000-000000000051' from public.folios f where f.booking_id = '10000000-0000-0000-0000-000000000071';
insert into public.folio_items (property_id, folio_id, booking_id, business_date, item_type, description, quantity, unit_amount_cents, net_amount_cents, tax_amount_cents, amount_cents)
select f.property_id, f.id, f.booking_id, current_date, 'minibar', 'Minibar snacks', 1, 25000, 25000, 0, 25000 from public.folios f where f.booking_id = '10000000-0000-0000-0000-000000000071';
insert into public.folio_items (property_id, folio_id, booking_id, business_date, item_type, description, quantity, unit_amount_cents, net_amount_cents, tax_amount_cents, amount_cents)
select f.property_id, f.id, f.booking_id, current_date, 'room_charge', 'Room charge', 1, 120000, 120000, 14400, 134400 from public.folios f where f.booking_id = '10000000-0000-0000-0000-000000000072';
insert into public.folio_items (property_id, folio_id, booking_id, business_date, item_type, description, quantity, unit_amount_cents, net_amount_cents, tax_amount_cents, amount_cents)
select f.property_id, f.id, f.booking_id, current_date, 'room_charge', 'Room charge', 1, 140000, 140000, 16800, 156800 from public.folios f where f.booking_id = '10000000-0000-0000-0000-000000000073';
insert into public.folio_items (property_id, folio_id, booking_id, business_date, item_type, description, quantity, unit_amount_cents, net_amount_cents, tax_amount_cents, amount_cents, reverses_id)
select property_id, folio_id, booking_id, current_date, 'discount', 'Minibar goodwill discount', 1, 5000, 5000, 0, 5000, id
from public.folio_items where description = 'Minibar snacks';
insert into public.folio_items (property_id, folio_id, booking_id, business_date, item_type, description, quantity, unit_amount_cents, net_amount_cents, tax_amount_cents, amount_cents)
select f.property_id, f.id, f.booking_id, current_date, 'miscellaneous', 'Incorrect parking charge', 1, 5000, 5000, 0, 5000 from public.folios f where f.booking_id = '10000000-0000-0000-0000-000000000071';
insert into public.folio_items (property_id, folio_id, booking_id, business_date, item_type, description, quantity, unit_amount_cents, net_amount_cents, tax_amount_cents, amount_cents, reverses_id)
select property_id, folio_id, booking_id, current_date, 'reversal', 'Reversal: Incorrect parking charge', quantity, unit_amount_cents, net_amount_cents, tax_amount_cents, amount_cents, id from public.folio_items where description = 'Incorrect parking charge';

insert into public.payments (property_id, folio_id, booking_id, payment_method_id, amount_cents, currency, business_date)
select f.property_id, f.id, f.booking_id, '10000000-0000-0000-0000-000000000061', 50000, f.currency, current_date from public.folios f where f.booking_id = '10000000-0000-0000-0000-000000000072';
insert into public.payments (property_id, folio_id, booking_id, payment_method_id, amount_cents, currency, business_date, external_reference)
select f.property_id, f.id, f.booking_id, '10000000-0000-0000-0000-000000000063', 156800, f.currency, current_date, 'OTA settlement example' from public.folios f where f.booking_id = '10000000-0000-0000-0000-000000000073';
-- A non-cash card payment is intentionally separate from the cash drawer.
insert into public.payments (property_id, folio_id, booking_id, payment_method_id, amount_cents, currency, business_date, authorization_reference)
select f.property_id, f.id, f.booking_id, '10000000-0000-0000-0000-000000000062', 10000, f.currency, current_date, 'CARD-DEV-001' from public.folios f where f.booking_id = '10000000-0000-0000-0000-000000000071';
