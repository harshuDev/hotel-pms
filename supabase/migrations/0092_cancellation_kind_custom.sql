-- Settings -> Inventory -> Cancellation Policy: the reference's "Custom
-- Policy" choice. A custom policy is the hotel's own words, and no date can
-- be worked out from it -- so it is a third kind rather than a flexible or a
-- non-refundable one pretending. `booking_cancellation_terms()` already
-- reports a kind it has no rule for with no free window and no verdict, which
-- is the truth for a custom policy.
--
-- Its own migration because a new enum value cannot be used in the
-- transaction that adds it; 0093 is the rest of the round.

alter type public.cancellation_policy_kind add value if not exists 'custom';
