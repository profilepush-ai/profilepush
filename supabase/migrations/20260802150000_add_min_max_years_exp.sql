-- Add min_years_exp and max_years_exp columns, migrate from years_exp
ALTER TABLE public.hotlist_ai_roles
  ADD COLUMN IF NOT EXISTS min_years_exp integer,
  ADD COLUMN IF NOT EXISTS max_years_exp integer;

-- Populate from existing years_exp: min = years_exp, max = years_exp + 4
UPDATE public.hotlist_ai_roles
SET min_years_exp = years_exp,
    max_years_exp = years_exp + 4
WHERE years_exp IS NOT NULL
  AND min_years_exp IS NULL;

-- Drop old column
ALTER TABLE public.hotlist_ai_roles DROP COLUMN IF EXISTS years_exp;
