-- Grant signed-in users access to the tables explicitly, instead of relying on the
-- project's "Automatically expose new tables" setting (which can be off). Row Level
-- Security still limits every row to its owner; signed-out (anon) users get nothing.
grant usage on schema public to authenticated;
grant select, insert, update, delete on
  public.categories,
  public.budgets,
  public.recurring_expenses,
  public.recurring_occurrences,
  public.transactions,
  public.category_corrections
to authenticated;
