import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import z from "zod";
import { toast } from "sonner";
import { AlertCircle, Check, Loader2 } from "lucide-react";
import { Input } from "#root/components/ui/input";
import { Link } from "#root/components/utils/Link";
import { authClient } from "#root/lib/auth-client.js";
import { CTA_ON_LIGHT, HEADING_SHOP } from "./machTokens";
import {
  AUTH_FIELD,
  AUTH_FIELD_INVALID,
  AUTH_LABEL,
  AUTH_LEAD,
  AUTH_LINK,
  AUTH_SUBMIT,
  AuthFieldError,
  AuthNotice,
  AuthPasswordToggle,
  AuthRule,
  MachAuthShell,
} from "./MachAuthShell";

/**
 * Mach new-password screen.
 *
 * Token handling is the inherited behaviour verbatim, including this local
 * `useSearchParams` helper: it reads `window.location.search` directly and
 * returns an empty set on the server, so a missing `?token=` still renders the
 * dead-end screen and a present one still renders the form. The query
 * semantics, the `if (!token) return` submit guard and the `resetPassword`
 * call are untouched — only the three screens' presentation is Mach's.
 */

function useSearchParams() {
  if (typeof window === "undefined") return new URLSearchParams();
  return new URLSearchParams(window.location.search);
}

const formSchema = z
  .object({
    password: z
      .string()
      .min(8, "Password must be at least 8 characters long")
      .max(255),
    confirmPassword: z.string(),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
  });

type FormValues = z.infer<typeof formSchema>;

export function MachResetPasswordPage() {
  const searchParams = useSearchParams();
  const token = searchParams.get("token");

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: { password: "", confirmPassword: "" },
  });

  const onSubmit = async (values: FormValues) => {
    if (!token) return;
    setIsSubmitting(true);
    try {
      const result = await authClient.resetPassword({
        newPassword: values.password,
        token,
      });

      if (result.error) {
        toast.error(result.error.message || "Failed to reset password");
        setIsSubmitting(false);
        return;
      }

      setIsSuccess(true);
    } catch {
      toast.error("Something went wrong. Please try again.");
      setIsSubmitting(false);
    }
  };

  const errors = form.formState.errors;

  // No token in URL
  if (!token) {
    return (
      <MachAuthShell eyebrow="Password reset">
        <AuthNotice
          eyebrow="Link invalid"
          icon={<AlertCircle className="h-5 w-5" strokeWidth={2.25} />}
          title="Invalid link"
          tone="alert">
          This password reset link is missing or invalid. Please request a new
          one.
        </AuthNotice>

        <AuthRule className="mt-10" />

        <Link href="/forgot-password" className={`${AUTH_LINK} mt-4`}>
          Request a new reset link
        </Link>
      </MachAuthShell>
    );
  }

  if (isSuccess) {
    return (
      <MachAuthShell eyebrow="Password reset">
        <AuthNotice
          eyebrow="Reset complete"
          icon={<Check className="h-5 w-5" strokeWidth={2.5} />}
          title="Password updated">
          Your password has been successfully reset. You can now log in with
          your new password.
        </AuthNotice>

        <AuthRule className="mt-10" />

        <button
          type="button"
          onClick={() => {
            window.location.href = "/login";
          }}
          className={`${CTA_ON_LIGHT} ${AUTH_SUBMIT} mt-6`}>
          Go to login
        </button>
      </MachAuthShell>
    );
  }

  return (
    <MachAuthShell eyebrow="Password reset">
      <h1 className={`${HEADING_SHOP} text-[var(--mach-ink)]`}>New password</h1>
      <p className={AUTH_LEAD}>Choose a strong password for your account.</p>

      <AuthRule className="mt-8" />

      <form
        onSubmit={form.handleSubmit(onSubmit)}
        autoComplete="on"
        className="mt-8 flex flex-col gap-7">
        {/* New password */}
        <div>
          <label htmlFor="password" className={AUTH_LABEL}>
            New password
          </label>
          <div className="relative mt-3">
            <Input
              {...form.register("password")}
              id="password"
              type={showPassword ? "text" : "password"}
              autoComplete="new-password"
              placeholder="At least 8 characters"
              aria-invalid={errors.password ? true : undefined}
              aria-describedby={errors.password ? "password-error" : undefined}
              className={`${AUTH_FIELD} pe-14 ${errors.password ? AUTH_FIELD_INVALID : ""}`}
              disabled={isSubmitting}
            />
            <AuthPasswordToggle
              shown={showPassword}
              onToggle={() => setShowPassword(!showPassword)}
              disabled={isSubmitting}
            />
          </div>
          {errors.password && (
            <AuthFieldError id="password-error">
              {errors.password.message}
            </AuthFieldError>
          )}
        </div>

        {/* Confirm password */}
        <div>
          <label htmlFor="confirmPassword" className={AUTH_LABEL}>
            Confirm password
          </label>
          <div className="relative mt-3">
            <Input
              {...form.register("confirmPassword")}
              id="confirmPassword"
              type={showConfirm ? "text" : "password"}
              autoComplete="new-password"
              placeholder="Repeat your password"
              aria-invalid={errors.confirmPassword ? true : undefined}
              aria-describedby={
                errors.confirmPassword ? "confirmPassword-error" : undefined
              }
              className={`${AUTH_FIELD} pe-14 ${errors.confirmPassword ? AUTH_FIELD_INVALID : ""}`}
              disabled={isSubmitting}
            />
            <AuthPasswordToggle
              shown={showConfirm}
              onToggle={() => setShowConfirm(!showConfirm)}
              disabled={isSubmitting}
              label="password confirmation"
            />
          </div>
          {errors.confirmPassword && (
            <AuthFieldError id="confirmPassword-error">
              {errors.confirmPassword.message}
            </AuthFieldError>
          )}
        </div>

        <button
          type="submit"
          disabled={isSubmitting}
          aria-busy={isSubmitting}
          className={`${CTA_ON_LIGHT} ${AUTH_SUBMIT}`}>
          {isSubmitting && (
            <Loader2 aria-hidden="true" className="h-3.5 w-3.5 animate-spin" />
          )}
          {isSubmitting ? "Resetting" : "Reset password"}
        </button>
      </form>

      <AuthRule className="mt-10" />

      <Link href="/login" className={`${AUTH_LINK} mt-4`}>
        Back to login
      </Link>
    </MachAuthShell>
  );
}
