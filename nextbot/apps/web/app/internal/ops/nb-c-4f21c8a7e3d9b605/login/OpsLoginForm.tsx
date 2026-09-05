"use client";

import { useEffect, useRef, useActionState } from "react";
import { Button } from "@nextbot/ui/components/ui/button";
import { Input } from "@nextbot/ui/components/ui/input";
import { Label } from "@nextbot/ui/components/ui/label";
import { Card } from "@nextbot/ui/components/ui/card";
import { Alert, AlertDescription } from "@nextbot/ui/components/ui/alert";
import { opsLoginAction, type OpsLoginFormState } from "./actions";

/**
 * Platform Manager console token-entry form (NFR-11). Deliberately not the tenant
 * Admin Console's `LoginForm` — no tenant slug/email/password/MFA/branding lookup at
 * all, just the one operator token, matching this surface's entirely different
 * (shared-secret + IP allowlist) trust model.
 */
export function OpsLoginForm() {
  const [state, formAction, pending] = useActionState<OpsLoginFormState, FormData>(opsLoginAction, {});
  const errorRef = useRef<HTMLDivElement>(null);

  // Same accessibility convention as the tenant Admin Console's LoginForm: move
  // focus to the error alert on failure so screen-reader users get an unambiguous
  // signal, rather than relying on `role="alert"`/`aria-live` alone.
  useEffect(() => {
    if (state.error) errorRef.current?.focus();
  }, [state.error]);

  return (
    <Card className="mx-auto mt-20 max-w-sm p-8">
      <main role="main">
        <h1 className="mb-6 font-heading text-lg font-semibold">Platform Manager sign-in</h1>
        <form action={formAction}>
          <div className="flex flex-col gap-4">
            <div>
              <Label htmlFor="ops-token">Operator token</Label>
              <Input
                id="ops-token"
                name="token"
                type="password"
                autoComplete="off"
                required
                className="mt-1"
              />
            </div>
            {state.error && (
              <Alert ref={errorRef} tabIndex={-1} variant="destructive" aria-live="assertive">
                <AlertDescription>{state.error}</AlertDescription>
              </Alert>
            )}
            <Button type="submit" disabled={pending}>
              Sign in
            </Button>
          </div>
        </form>
      </main>
    </Card>
  );
}
