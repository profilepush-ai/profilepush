-- Allow all authenticated users to read the total count of watched actions (for social proof)
create policy "Anyone authenticated can read watched count"
  on onboarding_logs for select
  to authenticated
  using (action = 'watched');
