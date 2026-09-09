import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import z from "zod";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
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
  AuthPasswordToggle,
  AuthRule,
  MachAuthShell,
} from "./MachAuthShell";

/**
 * Mach customer sign-in.
 *
 * The inherited login page is a rounded, shadowed "Atelier" card floating on a
 * warm brown gradient — the visual language of the perfume storefront this
 * template system was forked from, down to naming the wrong brand in its
 * heading. So Mach gets its own page rather than a restyle of that one, which
 * is how every other template here owns its auth screens (MinimalLoginPage).
 *
 * Frame, field chrome and password toggle come from MachAuthShell, shared with
 * the other three screens of this journey. The authentication is the inherited
 * flow, unchanged: same Better Auth call, same zod schema, same error mapping,
 * same role-based redirect.
 */

const formSchema = z.object({
  email: z.string().email("Please enter a valid email address"),
  password: z.string().min(1, "Password cannot be empty"),
});

type FormValues = z.infer<typeof formSchema>;

export function MachLoginPage() {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      email: "",
      password: "",
    },
  });

  const onSubmit = async (values: FormValues) => {
    setIsSubmitting(true);
    try {
      const result = await authClient.signIn.email({
        email: values.email,
        password: values.password,
      });

      if (result.error) {
        const raw = result.error.message || "";
        const friendly =
          raw.toLowerCase().includes("invalid") ||
          raw.toLowerCase().includes("password") ||
          raw.toLowerCase().includes("credentials")
            ? "Incorrect email or password."
            : raw.toLowerCase().includes("not found") ||
                raw.toLowerCase().includes("user")
              ? "No account found with that email."
              : "Login failed. Please try again.";
        toast.error(friendly);
        setIsSubmitting(false);
        return;
      }

      toast.success("Login successful");

      // Redirect based on role
      const role = (result.data?.user as { role?: string } | null)?.role;
      if (role === "admin" || role === "superadmin") {
        window.location.href = "/dashboard";
      } else {
        window.location.href = "/";
      }
    } catch {
      toast.error(
        "Something went wrong. Please refresh the page and try again.",
      );
      setIsSubmitting(false);
    }
  };

  const emailError = form.formState.errors.email;
  const passwordError = form.formState.errors.password;

  return (
    <MachAuthShell eyebrow="Customer account">
      <h1 className={`${HEADING_SHOP} text-[var(--mach-ink)]`}>Sign in</h1>
      <p className={AUTH_LEAD}>
        Sign in to track your orders and check out faster.
      </p>

      <AuthRule className="mt-8" />

      <form
        onSubmit={form.handleSubmit(onSubmit)}
        autoComplete="on"
        className="mt-8 flex flex-col gap-7">
        {/* Email */}
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

        {/* Password */}
        <div>
          {/* Row is sized by the link's 44px target rather than by the label,
              so the shortcut stays tappable at its small type size. */}
          <div className="-my-1 flex items-center justify-between gap-4">
            <label htmlFor="password" className={AUTH_LABEL}>
              Password
            </label>
            <Link
              href="/forgot-password"
              className={`${AUTH_LINK} text-[10px] tracking-[0.16em] text-[var(--mach-mute)] hover:text-[var(--mach-ink)]`}>
              Forgot?
            </Link>
          </div>
          <div className="relative mt-2">
            <Input
              {...form.register("password")}
              id="password"
              type={showPassword ? "text" : "password"}
              autoComplete="current-password"
              placeholder="Enter your password"
              aria-invalid={passwordError ? true : undefined}
              aria-describedby={passwordError ? "password-error" : undefined}
              className={`${AUTH_FIELD} pe-14 ${passwordError ? AUTH_FIELD_INVALID : ""}`}
              disabled={isSubmitting}
            />
            <AuthPasswordToggle
              shown={showPassword}
              onToggle={() => setShowPassword(!showPassword)}
              disabled={isSubmitting}
            />
          </div>
          {passwordError && (
            <AuthFieldError id="password-error">
              {passwordError.message}
            </AuthFieldError>
          )}
        </div>

        {/* Primary CTA */}
        <button
          type="submit"
          disabled={isSubmitting}
          aria-busy={isSubmitting}
          className={`${CTA_ON_LIGHT} ${AUTH_SUBMIT}`}>
          {isSubmitting && (
            <Loader2 aria-hidden="true" className="h-3.5 w-3.5 animate-spin" />
          )}
          {isSubmitting ? "Signing in" : "Sign in"}
        </button>
      </form>

      <AuthRule className="mt-10" />

      <div className="mt-6 flex flex-wrap items-center justify-between gap-x-6 gap-y-1">
        <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-[var(--mach-mute)]">
          No account yet?
        </p>
        <Link href="/register" className={AUTH_LINK}>
          Create an account
        </Link>
      </div>
    </MachAuthShell>
  );
}
