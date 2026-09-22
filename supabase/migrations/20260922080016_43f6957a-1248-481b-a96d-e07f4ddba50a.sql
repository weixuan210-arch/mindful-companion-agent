CREATE TABLE public.vault_notes (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  source_file_id TEXT NOT NULL,
  name TEXT NOT NULL,
  modified_time TIMESTAMP WITH TIME ZONE,
  thought_id UUID REFERENCES public.thoughts(id) ON DELETE SET NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX vault_notes_user_file_idx ON public.vault_notes (user_id, source_file_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.vault_notes TO authenticated;
GRANT ALL ON public.vault_notes TO service_role;

ALTER TABLE public.vault_notes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own vault notes" ON public.vault_notes
  FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE TRIGGER touch_vault_notes_updated_at
  BEFORE UPDATE ON public.vault_notes
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();