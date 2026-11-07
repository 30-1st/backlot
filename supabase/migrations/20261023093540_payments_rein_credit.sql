-- Recorded in the database on Oct 23 as its own migration; the same function is also in
-- 20261023093509_payments.sql. Kept here so the repo and the database list the same versions.
create or replace function public.rein_add_credit_once(p_event text, p_user uuid, p_customer text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into private.stripe_events (id, type) values (p_event, 'checkout.session.completed:rein_one')
  on conflict (id) do nothing;
  if not found then
    return false;
  end if;
  insert into public.rein_access (user_id, stripe_customer_id, credits, updated_at)
  values (p_user, p_customer, 1, now())
  on conflict (user_id) do update
    set credits = least(public.rein_access.credits + 1, 1000),
        stripe_customer_id = coalesce(public.rein_access.stripe_customer_id, excluded.stripe_customer_id),
        updated_at = now();
  return true;
end;
$$;
revoke all on function public.rein_add_credit_once(text, uuid, text) from public, anon, authenticated;
grant execute on function public.rein_add_credit_once(text, uuid, text) to service_role;
