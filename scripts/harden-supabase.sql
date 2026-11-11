-- Better Auth and encrypted workspaces are accessed only by the trusted backend.
-- Run after the existing db:migrate command when provisioning Supabase.
BEGIN;
ALTER TABLE public."user" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."session" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."account" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."verification" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."rateLimit" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workspaces ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public."user", public."session", public."account",
  public."verification", public."rateLimit", public.workspaces FROM anon, authenticated;
COMMIT;
