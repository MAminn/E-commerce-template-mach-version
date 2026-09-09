import { useState, useEffect } from "react";
import { CheckCircle, XCircle, Loader2 } from "lucide-react";
import { authClient } from "#root/lib/auth-client";
import { useSearchParams } from "#root/hooks/useSearchParams";
import { CTA_ON_LIGHT } from "./machTokens";
import {
  AUTH_SUBMIT,
  AuthNotice,
  AuthRule,
  MachAuthShell,
} from "./MachAuthShell";

/**
 * Mach email verification.
 *
 * The last screen of the auth journey to still carry inherited styling: a
 * white `rounded-lg shadow-md` card with a `#1B4571` blue spinner and CTA, a
 * green tick, a red cross, and a success line naming the perfume brand this
 * template was forked from. All three states now run on the same ink-and-paper
 * shell as the other four screens.
 *
 * The verification itself is untouched. The effect below — token read, the
 * `authClient.verifyEmail({ query: { token } })` call, the `result.data` test,
 * every status transition and every error message — is the inherited
 * implementation verbatim, with one correctness fix to its dependency array
 * noted at the call site.
 *
 * There is no resend action here, and none was added: the route only ever
 * consumed a token from the URL.
 */

export function MachVerifyEmailPage() {
  const [verificationStatus, setVerificationStatus] = useState<
    "loading" | "success" | "error"
  >("loading");
  const [errorMessage, setErrorMessage] = useState<string>("");
  const params = useSearchParams();
  // Depend on the token *string*, not on the params object: useSearchParams
  // builds a fresh URLSearchParams every render, so `[params]` re-ran this
  // effect after each status update and fired a second verifyEmail with an
  // already-consumed token — which could report a genuine success as a
  // failure. The token value is stable across those re-renders, and still
  // changes if the URL's token does.
  const token = params.get("token");

  useEffect(() => {
    const verifyEmail = async () => {
      try {
        if (!token) {
          setVerificationStatus("error");
          setErrorMessage("Missing verification token");
          return;
        }

        const result = await authClient.verifyEmail({ query: { token } });
        if (result.data) {
          setVerificationStatus("success");
        } else {
          setVerificationStatus("error");
          setErrorMessage(result.error?.message || "Verification failed");
        }
      } catch (error) {
        setVerificationStatus("error");
        setErrorMessage(
          error instanceof Error
            ? error.message
            : "An unexpected error occurred during verification",
        );
      }
    };

    verifyEmail();
  }, [token]);

  return (
    <MachAuthShell eyebrow="Email verification">
      {verificationStatus === "loading" && (
        <AuthNotice
          eyebrow="Verifying"
          icon={<Loader2 aria-hidden="true" className="h-5 w-5 animate-spin" />}
          title="Verifying your email">
          Please wait while we verify your email address...
        </AuthNotice>
      )}

      {verificationStatus === "success" && (
        <>
          <AuthNotice
            eyebrow="Verified"
            icon={<CheckCircle aria-hidden="true" className="h-5 w-5" />}
            title="Email verified">
            Your email has been verified. You can now log in to your account.
          </AuthNotice>

          <AuthRule className="mt-10" />

          <a href="/login" className={`${CTA_ON_LIGHT} ${AUTH_SUBMIT} mt-6`}>
            Continue to login
          </a>
        </>
      )}

      {verificationStatus === "error" && (
        <>
          <AuthNotice
            eyebrow="Verification failed"
            icon={<XCircle aria-hidden="true" className="h-5 w-5" />}
            title="Verification failed"
            tone="alert">
            {errorMessage ||
              "We couldn't verify your email. The verification link may be invalid or expired."}
          </AuthNotice>

          <AuthRule className="mt-10" />

          <a href="/login" className={`${CTA_ON_LIGHT} ${AUTH_SUBMIT} mt-6`}>
            Return to login
          </a>
        </>
      )}
    </MachAuthShell>
  );
}
