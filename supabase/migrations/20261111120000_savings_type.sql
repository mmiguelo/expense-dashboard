-- A third transaction type: money moved from the everyday account to a savings account.
-- It is not spending, but it is no longer available to spend. Savings transactions are
-- always in the category 'Poupança' (set by the app, like 'Rendimentos' for income).

alter table public.transactions drop constraint transactions_type_check;
alter table public.transactions add constraint transactions_type_check check (type in ('expense', 'income', 'savings'));
