-- refresh_free_plan_credits() resets every trial account's balance to a
-- flat $5.00 — a destructive monthly reset, fundamentally incompatible with
-- the new "500 credits, one time, never expires" model. Unreferenced
-- anywhere else (no cron, no other caller) besides its own now-deleted
-- supabase/functions/refresh-free-credits edge function — safe to drop.
DROP FUNCTION IF EXISTS public.refresh_free_plan_credits();
