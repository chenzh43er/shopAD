import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { Session, User } from "@supabase/supabase-js";
import type { Profile } from "@shopad/shared";
import { isSuperAdmin as checkSuper } from "@shopad/shared";
import { ApiError, apiFetch } from "../lib/api";
import { supabase } from "../lib/supabase";

interface AuthContextValue {
  session: Session | null;
  user: User | null;
  profile: Profile | null;
  loading: boolean;
  /** 已登录但资料拉取失败时的说明（如未授权） */
  authError: string | null;
  isSuperAdmin: boolean;
  refreshProfile: () => Promise<void>;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const profileReqId = useRef(0);
  const signingOut = useRef(false);

  const loadProfile = useCallback(async (activeSession: Session | null) => {
    if (!activeSession) {
      setProfile(null);
      setAuthError(null);
      return;
    }

    const reqId = ++profileReqId.current;
    try {
      const me = await apiFetch<Profile>("/api/me");
      if (reqId !== profileReqId.current) return;
      setProfile(me);
      setAuthError(null);
    } catch (e) {
      if (reqId !== profileReqId.current) return;

      const message =
        e instanceof ApiError
          ? e.message
          : e instanceof Error
            ? e.message
            : "无法加载账号资料";

      // 未授权：清会话一次，避免与登录页互相跳转
      if (e instanceof ApiError && (e.status === 401 || e.status === 403)) {
        setProfile(null);
        setAuthError(message);
        if (!signingOut.current) {
          signingOut.current = true;
          try {
            await supabase.auth.signOut();
          } finally {
            signingOut.current = false;
          }
        }
        setSession(null);
        return;
      }

      // 网络/服务端临时错误：保留已有 profile，避免闪烁重定向环
      setAuthError(message);
    }
  }, []);

  useEffect(() => {
    let mounted = true;
    let initialized = false;

    const finishInit = () => {
      if (mounted && !initialized) {
        initialized = true;
        setLoading(false);
      }
    };

    supabase.auth.getSession().then(async ({ data }) => {
      if (!mounted) return;
      setSession(data.session);
      await loadProfile(data.session);
      finishInit();
    });

    const { data: sub } = supabase.auth.onAuthStateChange(
      async (event, next) => {
        if (!mounted) return;

        // getSession 已处理首屏；跳过重复的 INITIAL_SESSION，避免二次拉取导致闪烁
        if (event === "INITIAL_SESSION") {
          return;
        }

        setSession(next);

        if (event === "SIGNED_OUT") {
          profileReqId.current += 1;
          setProfile(null);
          if (!signingOut.current) setAuthError(null);
          finishInit();
          return;
        }

        if (
          event === "SIGNED_IN" ||
          event === "TOKEN_REFRESHED" ||
          event === "USER_UPDATED"
        ) {
          await loadProfile(next);
          finishInit();
        }
      },
    );

    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
  }, [loadProfile]);

  const refreshProfile = useCallback(async () => {
    await loadProfile(session);
  }, [loadProfile, session]);

  const signIn = useCallback(async (email: string, password: string) => {
    setAuthError(null);
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    if (error) throw error;
    // onAuthStateChange(SIGNED_IN) 会拉 profile；这里先同步 session 便于立刻跳转判断
    setSession(data.session);
    await loadProfile(data.session);
  }, [loadProfile]);

  const signOut = useCallback(async () => {
    signingOut.current = true;
    try {
      const { error } = await supabase.auth.signOut();
      if (error) throw error;
      setSession(null);
      setProfile(null);
      setAuthError(null);
    } finally {
      signingOut.current = false;
    }
  }, []);

  const value = useMemo(
    () => ({
      session,
      user: session?.user ?? null,
      profile,
      loading,
      authError,
      isSuperAdmin: checkSuper(profile?.role),
      refreshProfile,
      signIn,
      signOut,
    }),
    [
      session,
      profile,
      loading,
      authError,
      refreshProfile,
      signIn,
      signOut,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
