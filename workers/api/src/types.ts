import type { UserRole } from "@shopad/shared";

export interface Env {
  SUPABASE_URL: string;
  SUPABASE_ANON_KEY: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  /** Optional legacy JWT secret; auth now uses supabase.auth.getUser */
  SUPABASE_JWT_SECRET?: string;
  CORS_ORIGINS: string;
}

export type Variables = {
  userId: string;
  userEmail: string;
  userName: string;
  userRole: UserRole;
};
