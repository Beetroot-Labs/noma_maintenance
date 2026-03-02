import { useEffect, useRef } from "react";

type GoogleCredentialResponse = {
  credential?: string;
};

type GoogleAccountsIdConfiguration = {
  client_id: string;
  callback: (response: GoogleCredentialResponse) => void;
};

type GoogleAccountsButtonConfiguration = {
  theme?: "outline" | "filled_blue" | "filled_black";
  size?: "large" | "medium" | "small";
  text?: "signin_with" | "signup_with" | "continue_with" | "signin";
  shape?: "rectangular" | "pill" | "circle" | "square";
  width?: number;
};

declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize: (config: GoogleAccountsIdConfiguration) => void;
          renderButton: (
            element: HTMLElement,
            options: GoogleAccountsButtonConfiguration,
          ) => void;
        };
      };
    };
  }
}

const loadGoogleIdentityScript = () =>
  new Promise<void>((resolve, reject) => {
    if (window.google) {
      resolve();
      return;
    }

    const existingScript = document.querySelector<HTMLScriptElement>(
      'script[src="https://accounts.google.com/gsi/client"]',
    );
    if (existingScript) {
      existingScript.addEventListener("load", () => resolve(), { once: true });
      existingScript.addEventListener("error", () => reject(new Error("Google script load failed")), {
        once: true,
      });
      return;
    }

    const script = document.createElement("script");
    script.src = "https://accounts.google.com/gsi/client";
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Google script load failed"));
    document.head.appendChild(script);
  });

type GoogleSignInButtonProps = {
  clientId: string;
  disabled?: boolean;
  width?: number;
  onCredential: (credential: string) => void | Promise<void>;
  onLoadError?: () => void;
};

export function GoogleSignInButton({
  clientId,
  disabled = false,
  width = 320,
  onCredential,
  onLoadError,
}: GoogleSignInButtonProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!clientId || disabled) {
      return;
    }

    let cancelled = false;

    const renderButton = async () => {
      try {
        await loadGoogleIdentityScript();
      } catch {
        if (!cancelled) {
          onLoadError?.();
        }
        return;
      }

      if (cancelled || !window.google || !containerRef.current) {
        return;
      }

      containerRef.current.innerHTML = "";
      window.google.accounts.id.initialize({
        client_id: clientId,
        callback: (response) => {
          if (response.credential) {
            void onCredential(response.credential);
          }
        },
      });
      window.google.accounts.id.renderButton(containerRef.current, {
        theme: "outline",
        size: "large",
        text: "signin_with",
        shape: "pill",
        width,
      });
    };

    void renderButton();

    return () => {
      cancelled = true;
    };
  }, [clientId, disabled, onCredential, onLoadError, width]);

  return <div ref={containerRef} />;
}
