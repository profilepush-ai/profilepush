-- The resumes bucket let anyone, signed in or not, list every file and delete
-- any of them (policies from 20260608135526). Nothing in the app lists or
-- deletes through the API: files are uploaded and then opened by their public
-- link, which a public bucket serves without these policies. So both go.
-- Uploads stay open (candidates upload on the public screening page); edge
-- functions use the service role and are unaffected.
drop policy if exists anon_select_resumes on storage.objects;
drop policy if exists anon_delete_resumes on storage.objects;
