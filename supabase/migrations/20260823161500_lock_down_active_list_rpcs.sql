-- The previous migration's `REVOKE ALL ... FROM PUBLIC` did not actually
-- block anon/authenticated access: this project has a default-privileges
-- rule (ALTER DEFAULT PRIVILEGES ... GRANT EXECUTE ON FUNCTIONS TO anon,
-- authenticated) that grants EXECUTE directly to those roles at function
-- creation time, independent of PUBLIC. Revoking from PUBLIC alone doesn't
-- remove a direct role grant. Confirmed via a live anon-key curl call that
-- returned real contact rows before this fix. Revoke from anon/authenticated
-- explicitly by name.
REVOKE ALL ON FUNCTION public.get_active_list_recruiter_contacts_24h() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_active_list_vendor_contacts_24h() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_active_list_recruiter_contacts_24h() TO service_role;
GRANT EXECUTE ON FUNCTION public.get_active_list_vendor_contacts_24h() TO service_role;
