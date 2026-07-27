-- Support tickets
CREATE TABLE support_tickets (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id  uuid REFERENCES accounts(id) ON DELETE CASCADE,
  user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  subject     text NOT NULL,
  description text NOT NULL,
  screenshot_url text,
  status      text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'in_progress', 'resolved')),
  created_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE support_tickets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "select_own_tickets" ON support_tickets FOR SELECT
  TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "insert_own_tickets" ON support_tickets FOR INSERT
  TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "update_own_tickets" ON support_tickets FOR UPDATE
  TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "delete_own_tickets" ON support_tickets FOR DELETE
  TO authenticated USING (auth.uid() = user_id);

-- Feature requests
CREATE TABLE feature_requests (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title       text NOT NULL,
  description text,
  vote_count  integer NOT NULL DEFAULT 1,
  created_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE feature_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "select_feature_requests" ON feature_requests FOR SELECT
  TO authenticated USING (true);
CREATE POLICY "insert_feature_requests" ON feature_requests FOR INSERT
  TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "update_feature_requests" ON feature_requests FOR UPDATE
  TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "delete_own_feature_requests" ON feature_requests FOR DELETE
  TO authenticated USING (auth.uid() = user_id);

-- Votes (one per user per request)
CREATE TABLE feature_request_votes (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL REFERENCES feature_requests(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (request_id, user_id)
);

ALTER TABLE feature_request_votes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "select_votes" ON feature_request_votes FOR SELECT
  TO authenticated USING (true);
CREATE POLICY "insert_vote" ON feature_request_votes FOR INSERT
  TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "delete_own_vote" ON feature_request_votes FOR DELETE
  TO authenticated USING (auth.uid() = user_id);

-- Storage bucket for support screenshots
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'support-screenshots',
  'support-screenshots',
  false,
  5242880,
  ARRAY['image/png','image/jpeg','image/gif','image/webp']
)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "upload_own_screenshots" ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'support-screenshots' AND (storage.foldername(name))[1] = auth.uid()::text);

CREATE POLICY "read_own_screenshots" ON storage.objects FOR SELECT
  TO authenticated
  USING (bucket_id = 'support-screenshots' AND (storage.foldername(name))[1] = auth.uid()::text);
