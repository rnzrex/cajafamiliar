alter table public.recurring_payments
  add column if not exists amount_mode text not null default 'fixed',
  add column if not exists due_date date;

alter table public.recurring_payments
  alter column amount drop not null,
  alter column due_day drop not null;

alter table public.recurring_payments
  drop constraint if exists recurring_payments_amount_check,
  drop constraint if exists recurring_payments_due_day_check,
  drop constraint if exists recurring_payments_recurrence_type_check,
  drop constraint if exists recurring_payments_total_installments_check,
  drop constraint if exists recurring_payments_amount_positive_or_null_check,
  drop constraint if exists recurring_payments_amount_mode_check,
  drop constraint if exists recurring_payments_amount_mode_values_check,
  drop constraint if exists recurring_payments_schedule_check,
  drop constraint if exists recurring_payments_installments_check;

alter table public.recurring_payments
  add constraint recurring_payments_amount_positive_or_null_check check (amount is null or amount > 0),
  add constraint recurring_payments_amount_mode_check check (
    (amount_mode = 'fixed' and amount is not null and amount > 0)
    or (amount_mode = 'variable' and (amount is null or amount > 0))
  ),
  add constraint recurring_payments_amount_mode_values_check check (amount_mode in ('fixed', 'variable')),
  add constraint recurring_payments_due_day_check check (due_day is null or due_day between 1 and 31),
  add constraint recurring_payments_schedule_check check (
    (recurrence_type = 'one_time' and due_date is not null and due_day is null)
    or (recurrence_type in ('indefinite', 'fixed') and due_day is not null and due_day between 1 and 31 and due_date is null)
  ),
  add constraint recurring_payments_recurrence_type_check check (recurrence_type in ('indefinite', 'fixed', 'one_time')),
  add constraint recurring_payments_installments_check check (
    (recurrence_type = 'fixed' and total_installments is not null and total_installments > 0)
    or (recurrence_type in ('indefinite', 'one_time') and total_installments is null)
  );
