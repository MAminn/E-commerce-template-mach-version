import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import z from "zod";
import { toast } from "sonner";
import { ArrowLeft, Check, Loader2 } from "lucide-react";
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
  AuthRule,
  MachAuthShell,
} from "./MachAuthShell";

/**
 * Mach password-reset request.
 *
 * Same single field, same `requestPasswordReset` call with the same
 * `redirectTo` origin, and the same deliberately non-committal success copy —
 * it does not confirm whether the address is registered. Only the presentation
 * changes: the inherited green status disc becomes the journey's neutral ink
 * notice, which carries the outcome in words and a live region rather than in
 * colour.
 */

const formSchema = z.object({
  email: z.string().email("Please enter a valid email address"),
});

type FormValues = z.infer<typeof formSchema>;

export function MachForgotPasswordPage() {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: { email: "" },
  });

  const onSubmit = async (values: FormValues) => {
    setIsSubmitting(true);
    try {
      const result = await authClient.requestPasswordReset({
        email: values.email,
        redirectTo: `${typeof window !== "undefined" ? window.location.origin : ""}/reset-password`,
      });

      if (result.error) {
        toast.error(result.error.message || "Something went wrong");
        setIsSubmitting(false);
        return;
      }

      setIsSuccess(true);
    } catch {
      toast.error("Something went wrong. Please try again.");
      setIsSubmitting(false);
    }
  };

  const emailError = form.formState.errors.email;

  if (isSuccess) {
    return (
      <MachAuthShell eyebrow="Password reset">
        <AuthNotice
          eyebrow="Request sent"
          icon={<Check className="h-5 w-5" strokeWidth={2.5} />}
          title="Check your email">
          If an account exists with that email, we've sent a password reset
          link. Please check your inbox and spam folder.
        </AuthNotice>

        <AuthRule className="mt-10" />

        <Link href="/login" className={`${AUTH_LINK} mt-4 gap-2`}>
          <ArrowLeft aria-hidden="true" className="h-4 w-4" />
          Back to login
        </Link>
      </MachAuthShell>
    );
  }

  return (
    <MachAuthShell eyebrow="Password reset">
      <h1 className={`${HEADING_SHOP} text-[var(--mach-ink)]`}>
        Forgot password
      </h1>
      <p className={AUTH_LEAD}>
        Enter the email on your account and we'll send you a reset link.
      </p>

      <AuthRule className="mt-8" />

      <form
        onSubmit={form.handleSubmit(onSubmit)}
        autoComplete="on"
        className="mt-8 flex flex-col gap-7">
        <div>
          <label htmlFor="email" className={AUTH_LABEL}>
            Email
          </label>
          <Input
            {...form.register("email")}
            id="email"
            type="email"
            autoComplete="email"
            placeholder="you@example.com"
            aria-invalid={emailError ? true : undefined}
            aria-describedby={emailError ? "email-error" : undefined}
            className={`mt-3 ${AUTH_FIELD} ${emailError ? AUTH_FIELD_INVALID : ""}`}
            disabled={isSubmitting}
          />
          {emailError && (
            <AuthFieldError id="email-error">
              {emailError.message}
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
          {isSubmitting ? "Sending" : "Send reset link"}
        </button>
      </form>

      <AuthRule className="mt-10" />

      <Link href="/login" className={`${AUTH_LINK} mt-4 gap-2`}>
        <ArrowLeft aria-hidden="true" className="h-4 w-4" />
        Back to login
      </Link>
    </MachAuthShell>
  );
}
