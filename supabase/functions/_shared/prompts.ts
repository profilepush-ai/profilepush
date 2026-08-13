import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";

export interface PromptOverride {
  systemPrompt?: string | null;
  userPrompt?: string | null;
}

export async function getPromptOverride(supabase: SupabaseClient, promptKey: string): Promise<PromptOverride | null> {
  try {
    const { data, error } = await supabase
      .from("ai_prompts")
      .select("system_prompt, user_prompt")
      .eq("prompt_key", promptKey)
      .maybeSingle();
    if (error || !data) return null;
    return { systemPrompt: data.system_prompt, userPrompt: data.user_prompt };
  } catch {
    return null;
  }
}
