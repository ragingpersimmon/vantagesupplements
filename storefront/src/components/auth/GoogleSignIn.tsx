"use client";

import Script from "next/script";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";

/**
 * Google Identity Services (GIS) integration: One Tap prompt + optional button.
 *
 * GIS hands us a Google-signed ID token ("credential"). We post it to a Server
 * Action, which forwards it to Spree for verification and returns normal Spree
 * session cookies. No Google secret or Spree admin key ever reaches the browser.
 *
 * Performance: the GIS script is loaded with `lazyOnload` (after the page is
 * idle) so it never competes with LCP — keeps mobile Lighthouse > 90.
 */

const CLIENT_ID = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;

type GoogleCredentialResponse = { credential: string };

interface GoogleIdApi {
  initialize(config: {
    client_id: string;
    callback: (response: GoogleCredentialResponse) => void;
    auto_select?: boolean;
    cancel_on_tap_outside?: boolean;
    context?: "signin" | "signup" | "use";
    itp_support?: boolean;
    use_fedcm_for_prompt?: boolean;
  }): void;
  prompt(): void;
  cancel(): void;
  renderButton(
    parent: HTMLElement,
    options: Record<string, string | number>,
  ): void;
}

declare global {
  interface Window {
    google?: { accounts: { id: GoogleIdApi } };
  }
}

// GIS must be initialized once per page load; multiple components share it.
let initialized = false;
const credentialListeners = new Set<(c: string) => void>();

function ensureInitialized() {
  if (initialized || !window.google || !CLIENT_ID) return;
  window.google.accounts.id.initialize({
    client_id: CLIENT_ID,
    // Exactly one handler per credential, or we'd sign in twice. The most
    // recently mounted one wins (the page's button over the global One Tap),
    // so page-specific onSuccess (e.g. redirect after login) runs.
    callback: ({ credential }) => {
      [...credentialListeners].at(-1)?.(credential);
    },
    context: "signup",
    cancel_on_tap_outside: true,
    itp_support: true,
    use_fedcm_for_prompt: true,
  });
  initialized = true;
}

function useGoogleCredential(onSuccess?: () => void) {
  const { loginWithGoogle } = useAuth();
  const [pending, setPending] = useState(false);

  const handle = useCallback(
    async (credential: string) => {
      setPending(true);
      const result = await loginWithGoogle(credential);
      setPending(false);
      if (!result.success) {
        toast.error(result.error ?? "Google sign-in failed");
        return;
      }
      if (result.welcomeCode) {
        toast.success(`Welcome! Your first-order code: ${result.welcomeCode}`, {
          description: "We've emailed it to you too.",
          duration: 12_000,
        });
      }
      onSuccess?.();
    },
    [loginWithGoogle, onSuccess],
  );

  useEffect(() => {
    credentialListeners.add(handle);
    return () => {
      credentialListeners.delete(handle);
    };
  }, [handle]);

  return pending;
}

function GisScript({ onReady }: { onReady: () => void }) {
  return (
    <Script
      src="https://accounts.google.com/gsi/client"
      strategy="lazyOnload"
      onReady={onReady}
    />
  );
}

/** Site-wide One Tap prompt. Shown only to signed-out visitors. */
export function GoogleOneTap() {
  const { isAuthenticated, loading } = useAuth();
  useGoogleCredential();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!ready || loading) return;
    ensureInitialized();
    if (isAuthenticated) {
      window.google?.accounts.id.cancel();
    } else {
      window.google?.accounts.id.prompt();
    }
  }, [ready, loading, isAuthenticated]);

  if (!CLIENT_ID || isAuthenticated) return null;
  return <GisScript onReady={() => setReady(true)} />;
}

/** Explicit "Sign in with Google" button for the login / register pages. */
export function GoogleSignInButton({ onSuccess }: { onSuccess?: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const pending = useGoogleCredential(onSuccess);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!ready || !ref.current || !window.google) return;
    ensureInitialized();
    window.google.accounts.id.renderButton(ref.current, {
      type: "standard",
      theme: "outline",
      size: "large",
      text: "continue_with",
      shape: "rectangular",
      width: 320,
    });
  }, [ready]);

  if (!CLIENT_ID) return null;
  return (
    <>
      <GisScript onReady={() => setReady(true)} />
      {/* Reserve the button's height so it doesn't cause layout shift (CLS). */}
      <div
        ref={ref}
        className="flex min-h-[44px] justify-center"
        aria-busy={pending}
      />
    </>
  );
}
