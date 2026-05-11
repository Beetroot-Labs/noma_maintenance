/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_GOOGLE_CLIENT_ID?: string;
  readonly VITE_REFRESH_CACHE_ON_SCAN?: string;
  readonly VITE_E2E?: string;
}

interface NomaE2EHooks {
  getOutboxItems: () => Promise<unknown[]>;
  hasPendingOutboxItems: () => Promise<boolean>;
  clearAllStorage: () => Promise<void>;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

interface GoogleCredentialResponse {
  credential?: string;
}

interface GoogleAccountsIdConfiguration {
  client_id: string;
  callback: (response: GoogleCredentialResponse) => void;
}

interface GoogleAccountsButtonConfiguration {
  theme?: "outline" | "filled_blue" | "filled_black";
  size?: "large" | "medium" | "small";
  text?:
    | "signin_with"
    | "signup_with"
    | "continue_with"
    | "signin";
  shape?: "rectangular" | "pill" | "circle" | "square";
  width?: number;
}

interface Window {
  __noma_e2e?: NomaE2EHooks;
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
