import { Outlet, Link, createRootRoute } from "@tanstack/react-router";
import { ThemeProvider } from "@/lib/theme";
import { I18nProvider } from "@/lib/i18n";
import { AuthProvider } from "@/lib/auth";
import { SecurityProvider } from "@/lib/security-store";
import { SystemProvider } from "@/lib/system-store";
import { BrandProvider } from "@/lib/brand-store";
import { UsersProvider } from "@/lib/users-store";
import { SessionsProvider } from "@/lib/sessions-store";
import { VoiceProvider } from "@/lib/voice-store";
import { ModelIdentityProvider } from "@/lib/model-identity-store";
import { RbacProvider } from "@/lib/rbac";
import { UserPrefsProvider } from "@/lib/user-prefs-store";
import { VisionConfigProvider } from "@/lib/vision-config-store";
import { Toaster } from "@/components/ui/sonner";

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-gradient">404</h1>
        <h2 className="mt-4 text-xl font-semibold">Signal lost</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          This route is not on the cockpit map.
        </p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Return to base
          </Link>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRoute({
  component: () => (
    <ThemeProvider>
      <I18nProvider>
        <BrandProvider>
          <AuthProvider>
            <UserPrefsProvider>
              <SecurityProvider>
                <SystemProvider>
                  <UsersProvider>
                    <SessionsProvider>
                      <VoiceProvider>
                        <ModelIdentityProvider>
                          <RbacProvider>
                            <VisionConfigProvider>
                              <Outlet />
                              <Toaster />
                            </VisionConfigProvider>
                          </RbacProvider>
                        </ModelIdentityProvider>
                      </VoiceProvider>
                    </SessionsProvider>
                  </UsersProvider>
                </SystemProvider>
              </SecurityProvider>
            </UserPrefsProvider>
          </AuthProvider>
        </BrandProvider>
      </I18nProvider>
    </ThemeProvider>
  ),
  notFoundComponent: NotFoundComponent,
});
