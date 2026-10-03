-- Event-trigger helpers should only be executable by privileged database roles.
revoke execute on function public.rls_auto_enable() from public, anon, authenticated;
