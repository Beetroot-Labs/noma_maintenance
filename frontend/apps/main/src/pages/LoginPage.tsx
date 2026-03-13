import { useDemoUser } from "@/context/DemoUserContext";
import { toast } from "@/lib/toast";
import { GoogleLoginScreen } from "@noma/shared";

export default function LoginPage() {
  const googleClientId = import.meta.env.VITE_GOOGLE_CLIENT_ID;
  const { isAuthenticating, loginWithGoogle } = useDemoUser();

  console.log("Google Client ID:", googleClientId);

  const handleGoogleCredential = async (credential: string) => {
    try {
      await loginWithGoogle(credential);
      toast.success("Sikeres bejelentkezés.");
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Sikertelen Google bejelentkezés.";
      toast.error(message);
    }
  };

  return (
    <GoogleLoginScreen
      googleClientId={googleClientId}
      title="Karbantartás"
      isAuthenticating={isAuthenticating}
      onCredential={handleGoogleCredential}
      onLoadError={() => {
        toast.error("A Google bejelentkezési script nem tölthető be.");
      }}
    />
  );
}
