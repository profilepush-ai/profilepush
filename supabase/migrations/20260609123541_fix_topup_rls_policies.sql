-- Allow authenticated users to insert credit_transactions for their own account
CREATE POLICY "insert_own_credit_transactions" ON credit_transactions
  FOR INSERT TO authenticated
  WITH CHECK (account_id IN (
    SELECT account_id FROM account_members WHERE user_id = auth.uid()
  ));

-- Allow authenticated users to update credits_balance on their own account
CREATE POLICY "update_own_account_credits" ON accounts
  FOR UPDATE TO authenticated
  USING (id IN (
    SELECT account_id FROM account_members WHERE user_id = auth.uid()
  ))
  WITH CHECK (id IN (
    SELECT account_id FROM account_members WHERE user_id = auth.uid()
  ));
