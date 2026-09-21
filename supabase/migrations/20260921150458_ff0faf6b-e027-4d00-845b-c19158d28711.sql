REVOKE ALL ON FUNCTION public.handle_new_user() FROM anon, authenticated, PUBLIC;
REVOKE ALL ON FUNCTION public.touch_updated_at() FROM anon, authenticated, PUBLIC;
CREATE POLICY "no direct client access" ON public.app_user_connections FOR SELECT TO authenticated USING (false);