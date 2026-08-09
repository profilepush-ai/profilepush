CREATE TABLE IF NOT EXISTS public.social_vendors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL UNIQUE,
  name text NOT NULL DEFAULT '',
  phone text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT social_vendors_email_normalized_check CHECK (email = lower(trim(email)) AND email <> '')
);

ALTER TABLE public.social_vendors ENABLE ROW LEVEL SECURITY;

GRANT SELECT ON public.social_vendors TO authenticated, service_role;
GRANT INSERT, UPDATE, DELETE ON public.social_vendors TO service_role;

DROP POLICY IF EXISTS "authenticated_read_social_vendors" ON public.social_vendors;
CREATE POLICY "authenticated_read_social_vendors"
  ON public.social_vendors
  FOR SELECT
  TO authenticated
  USING (true);

ALTER TABLE public.social_jobs
  ADD COLUMN IF NOT EXISTS vendor_id uuid REFERENCES public.social_vendors(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS social_jobs_vendor_id_idx
  ON public.social_jobs (vendor_id);

INSERT INTO public.social_vendors (email, name, phone)
SELECT DISTINCT ON (lower(trim(poster_email)))
  lower(trim(poster_email)),
  trim(posted_by_name),
  trim(poster_phone)
FROM public.social_jobs
WHERE trim(poster_email) <> ''
ORDER BY lower(trim(poster_email)), created_at DESC
ON CONFLICT (email) DO UPDATE
SET name = CASE WHEN EXCLUDED.name <> '' THEN EXCLUDED.name ELSE public.social_vendors.name END,
    phone = CASE WHEN EXCLUDED.phone <> '' THEN EXCLUDED.phone ELSE public.social_vendors.phone END,
    updated_at = now();

UPDATE public.social_jobs AS jobs
SET vendor_id = vendors.id
FROM public.social_vendors AS vendors
WHERE vendors.email = lower(trim(jobs.poster_email))
  AND jobs.vendor_id IS DISTINCT FROM vendors.id;

CREATE OR REPLACE FUNCTION public.sync_social_job_vendor()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_email text;
BEGIN
  v_email := lower(trim(COALESCE(NEW.poster_email, '')));
  IF v_email = '' THEN
    NEW.vendor_id := NULL;
    RETURN NEW;
  END IF;

  INSERT INTO public.social_vendors (email, name, phone)
  VALUES (v_email, trim(COALESCE(NEW.posted_by_name, '')), trim(COALESCE(NEW.poster_phone, '')))
  ON CONFLICT (email) DO UPDATE
  SET name = CASE WHEN EXCLUDED.name <> '' THEN EXCLUDED.name ELSE public.social_vendors.name END,
      phone = CASE WHEN EXCLUDED.phone <> '' THEN EXCLUDED.phone ELSE public.social_vendors.phone END,
      updated_at = now()
  RETURNING id INTO NEW.vendor_id;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS sync_social_job_vendor_before_write ON public.social_jobs;
CREATE TRIGGER sync_social_job_vendor_before_write
  BEFORE INSERT OR UPDATE OF poster_email, posted_by_name, poster_phone
  ON public.social_jobs
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_social_job_vendor();

REVOKE ALL ON FUNCTION public.sync_social_job_vendor() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sync_social_job_vendor() TO service_role;
