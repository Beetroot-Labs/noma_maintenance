import { GoogleLoginScreen, useAuth } from "@noma/shared";

type LoginPageProps = {
  googleClientId: string;
};

export default function LoginPage({ googleClientId }: LoginPageProps) {
  const { isAuthenticating, loginWithGoogle } = useAuth();

  return (
    <GoogleLoginScreen
      googleClientId={googleClientId}
      title="Címkéző"
      isAuthenticating={isAuthenticating}
      onCredential={loginWithGoogle}
      onLoadError={() => {
        window.alert("A Google bejelentkezési script nem tölthető be.");
      }}
    />
  );
}
