import { supabase } from './supabase';
import { trackEvent } from './track';
import type { ResumeFile } from './today';

// A resume added to a profile: stored in the resumes bucket, listed on the
// profile (the first one becomes its default). Throws a message to show.
export async function uploadProfileResume(accountId: string, profileId: string, file: File, isFirst: boolean): Promise<ResumeFile> {
  if (!/\.(pdf|docx?)$/i.test(file.name)) throw new Error('Attach a PDF or Word resume.');
  if (file.size > 4 * 1024 * 1024) throw new Error('Resume must be under 4 MB.');
  const safeName = file.name.replace(/[^A-Za-z0-9._-]+/g, '_').slice(-80);
  const path = `consultant-resumes/${accountId}/${crypto.randomUUID()}-${safeName}`;
  const { error: upErr } = await supabase.storage.from('resumes').upload(path, file, { contentType: file.type || 'application/octet-stream' });
  if (upErr) throw new Error(upErr.message);
  const { data: urlData } = supabase.storage.from('resumes').getPublicUrl(path);
  const { data: id, error } = await supabase.rpc('set_hotlist_resume' as never, { p_hotlist_id: profileId, p_url: urlData.publicUrl, p_file_name: file.name } as never);
  if (error) throw new Error(error.message);
  trackEvent('consultant_resume_attached', { type: file.name.split('.').pop()?.toLowerCase() ?? '' });
  return { id: String(id), url: urlData.publicUrl, file_name: file.name, is_default: isFirst };
}
