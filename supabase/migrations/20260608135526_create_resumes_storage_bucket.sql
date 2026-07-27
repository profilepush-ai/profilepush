-- Create the resumes storage bucket (public so files are downloadable without auth)
INSERT INTO storage.buckets (id, name, public, allowed_mime_types, file_size_limit)
VALUES ('resumes', 'resumes', true, ARRAY['application/pdf'], 10485760)
ON CONFLICT (id) DO NOTHING;

-- Storage RLS policies
DROP POLICY IF EXISTS "anon_upload_resumes" ON storage.objects;
CREATE POLICY "anon_upload_resumes" ON storage.objects
  FOR INSERT TO anon, authenticated
  WITH CHECK (bucket_id = 'resumes');

DROP POLICY IF EXISTS "anon_select_resumes" ON storage.objects;
CREATE POLICY "anon_select_resumes" ON storage.objects
  FOR SELECT TO anon, authenticated
  USING (bucket_id = 'resumes');

DROP POLICY IF EXISTS "anon_delete_resumes" ON storage.objects;
CREATE POLICY "anon_delete_resumes" ON storage.objects
  FOR DELETE TO anon, authenticated
  USING (bucket_id = 'resumes');
