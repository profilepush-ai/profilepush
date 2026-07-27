/*
# Add Notifications System

## Summary
Adds a full in-app + email + WhatsApp notification system.

## New Tables

### notifications
Stores individual notifications per user. Service role (edge functions) can insert for any user.
- id: UUID primary key
- account_id: workspace the notification belongs to
- user_id: the recipient user (FK auth.users)
- type: notification type key (e.g. 'credits_low', 'submission_confirmed')
- title: short headline text
- body: optional longer description
- link: optional in-app route to navigate to on click
- read: whether the user has read it (default false)
- created_at: timestamp

### notification_preferences
Stores per-user per-type delivery preferences. Defaults to in-app + email enabled, WhatsApp off.
- id: UUID primary key
- account_id: workspace scope
- user_id: FK auth.users
- notif_type: notification type key
- in_app_enabled: show in bell dropdown (default true)
- email_enabled: send email (default true)
- whatsapp_enabled: send WhatsApp (default false)
- updated_at: last changed timestamp
- UNIQUE(user_id, notif_type): one row per user per type

## Modified Tables

### account_members
- Added: whatsapp_number (text, nullable) — user's WhatsApp number for delivery

## Security
- RLS enabled on both new tables.
- notifications: authenticated users can select/update/delete their own rows. Service role bypasses RLS to insert for any user.
- notification_preferences: authenticated users can CRUD their own preference rows.
*/

-- ── notifications ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  type text NOT NULL,
  title text NOT NULL,
  body text,
  link text,
  read boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS notifications_user_id_read_idx ON notifications(user_id, read, created_at DESC);
CREATE INDEX IF NOT EXISTS notifications_account_id_idx ON notifications(account_id);

DROP POLICY IF EXISTS "select_own_notifications" ON notifications;
CREATE POLICY "select_own_notifications" ON notifications FOR SELECT
  TO authenticated USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "insert_own_notifications" ON notifications;
CREATE POLICY "insert_own_notifications" ON notifications FOR INSERT
  TO authenticated WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "update_own_notifications" ON notifications;
CREATE POLICY "update_own_notifications" ON notifications FOR UPDATE
  TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "delete_own_notifications" ON notifications;
CREATE POLICY "delete_own_notifications" ON notifications FOR DELETE
  TO authenticated USING (auth.uid() = user_id);

-- ── notification_preferences ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS notification_preferences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  notif_type text NOT NULL,
  in_app_enabled boolean NOT NULL DEFAULT true,
  email_enabled boolean NOT NULL DEFAULT true,
  whatsapp_enabled boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, notif_type)
);

ALTER TABLE notification_preferences ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS notif_prefs_user_id_idx ON notification_preferences(user_id);

DROP POLICY IF EXISTS "select_own_notif_prefs" ON notification_preferences;
CREATE POLICY "select_own_notif_prefs" ON notification_preferences FOR SELECT
  TO authenticated USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "insert_own_notif_prefs" ON notification_preferences;
CREATE POLICY "insert_own_notif_prefs" ON notification_preferences FOR INSERT
  TO authenticated WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "update_own_notif_prefs" ON notification_preferences;
CREATE POLICY "update_own_notif_prefs" ON notification_preferences FOR UPDATE
  TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "delete_own_notif_prefs" ON notification_preferences;
CREATE POLICY "delete_own_notif_prefs" ON notification_preferences FOR DELETE
  TO authenticated USING (auth.uid() = user_id);

-- ── account_members: add whatsapp_number ──────────────────────────────────────
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'account_members' AND column_name = 'whatsapp_number'
  ) THEN
    ALTER TABLE account_members ADD COLUMN whatsapp_number text;
  END IF;
END $$;
