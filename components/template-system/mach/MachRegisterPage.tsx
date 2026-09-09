import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
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
  AuthPasswordToggle,
  AuthRule,
  MachAuthShell,
} from "./MachAuthShell";

/**
 * Mach account creation.
 *
 * Same five fields, same zod schema, same Better Auth `signUp.email` call and
 * same success/error handling as the inherited page — only the presentation is
 * Mach's. The wider form column carries the two side-by-side field pairs the
 * inherited layout already used at `md`.
 */

const formSchema = z
  .object({
    name: z.string().min(2, "Name must be at least 2 characters"),
    email: z.string().email("Please enter a valid email address"),
    phone: z
      .string()
      .regex(/^(\+201|01|00201)[0-2,5]{1}[0-9]{8}/, "Invalid phone number"),
    password: z.string().min(8, "Password must be at least 8 characters"),
    confirmPassword: z.string(),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
  });

type FormValues = z.infer<typeof formSchema>;

export function MachRegisterPage() {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isRegistered, setIsRegistered] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: "",
      email: "",
      phone: "",
      password: "",
      confirmPassword: "",
    },
  });

  const onSubmit = async (values: FormValues) => {
    setIsSubmitting(true);

    try {
      const result = await authClient.signUp.email({
        email: values.email,
        password: values.password,
        name: values.name,
        phone: values.phone,
      } as Parameters<typeof authClient.signUp.email>[0]);

      if (result.error) {
        toast.error(result.error.message || "Registration failed");
        setIsSubmitting(false);
        return;
      }

      setIsRegistered(true);
      toast.success(
        "Registration successful! Please check your email to verify your account.",
      );
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error
          ? error.message
          : "An unexpected error occurred during registration";
      toast.error(errorMessage);
    } finally {
      setIsSubmitting(false);
    }
  };

  const errors = form.formState.errors;

  if (isRegistered) {
    return (
      <MachAuthShell eyebrow="New account">
        <AuthNotice
          eyebrow="Account created"
          icon={<Check className="h-5 w-5" strokeWidth={2.5} />}
          title="You're all set">
          Please check your email to verify your account. Once verified, you can
          log in to access all features.
        </AuthNotice>

        <AuthRule className="mt-10" />

        <Link href="/login" className={`${AUTH_LINK} mt-4 gap-2`}>
          <ArrowLeft aria-hidden="true" className="h-4 w-4" />
          Go to login
        </Link>
      </MachAuthShell>
    );
  }

  return (
    <MachAuthShell eyebrow="New account" contentClassName="max-w-[560px]">
      <h1 className={`${HEADING_SHOP} text-[var(--mach-ink)]`}>
        Create account
      </h1>
      <p className={AUTH_LEAD}>
        Create an account to check out faster and keep track of your orders.
      </p>

      <AuthRule className="mt-8" />

      <form
        onSubmit={form.handleSubmit(onSubmit)}
        autoComplete="on"
        className="mt-8 flex flex-col gap-7">
        {/* Name + Email */}
        <div className="grid grid-cols-1 gap-7 md:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
          <div>
            <label htmlFor="name" className={AUTH_LABEL}>
              Full name
            </label>
            <Input
              {...form.register("name")}
              id="name"
              type="text"
              autoComplete="name"
              placeholder="Your full name"
              aria-invalid={errors.name ? true : undefined}
              aria-describedby={errors.name ? "name-error" : undefined}
              className={`mt-3 ${AUTH_FIELD} ${errors.name ? AUTH_FIELD_INVALID : ""}`}
              disabled={isSubmitting}
            />
            {errors.name && (
              <AuthFieldError id="name-error">
                {errors.name.message}
              </AuthFieldError>
            )}
          </div>

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
              aria-invalid={errors.email ? true : undefined}
              aria-describedby={errors.email ? "email-error" : undefined}
              className={`mt-3 ${AUTH_FIELD} ${errors.email ? AUTH_FIELD_INVALID : ""}`}
              disabled={isSubmitting}
            />
            {errors.email && (
              <AuthFieldError id="email-error">
                {errors.email.message}
              </AuthFieldError>
            )}
          </div>
        </div>

        {/* Phone */}
        <div>
          <label htmlFor="phone" className={AUTH_LABEL}>
            Phone
          </label>
          <Input
            {...form.register("phone")}
            id="phone"
            type="tel"
            autoComplete="tel"
            placeholder="+201xxxxxxxxx"
            aria-invalid={errors.phone ? true : undefined}
            aria-describedby={errors.phone ? "phone-error" : undefined}
            className={`mt-3 ${AUTH_FIELD} ${errors.phone ? AUTH_FIELD_INVALID : ""}`}
            disabled={isSubmitting}
          />
          {errors.phone && (
            <AuthFieldError id="phone-error">
              {errors.phone.message}
            </AuthFieldError>
          )}
        </div>

        {/* Password + Confirm */}
        <div className="grid grid-cols-1 gap-7 md:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
          <div>
            <label htmlFor="password" className={AUTH_LABEL}>
              Password
            </label>
            <div className="relative mt-3">
              <Input
                {...form.register("password")}
                id="password"
                type={showPassword ? "text" : "password"}
                autoComplete="new-password"
                placeholder="Min. 8 characters"
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

          <div>
            <label htmlFor="confirmPassword" className={AUTH_LABEL}>
              Confirm password
            </label>
            <div className="relative mt-3">
              <Input
                {...form.register("confirmPassword")}
                id="confirmPassword"
                type={showConfirmPassword ? "text" : "password"}
                autoComplete="new-password"
                placeholder="Repeat password"
                aria-invalid={errors.confirmPassword ? true : undefined}
                aria-describedby={
                  errors.confirmPassword ? "confirmPassword-error" : undefined
                }
                className={`${AUTH_FIELD} pe-14 ${errors.confirmPassword ? AUTH_FIELD_INVALID : ""}`}
                disabled={isSubmitting}
              />
              <AuthPasswordToggle
                shown={showConfirmPassword}
                onToggle={() => setShowConfirmPassword(!showConfirmPassword)}
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
          {isSubmitting ? "Creating account" : "Create account"}
        </button>
      </form>

      <AuthRule className="mt-10" />

      <div className="mt-6 flex flex-wrap items-center justify-between gap-x-6 gap-y-1">
        <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-[var(--mach-mute)]">
          Already have an account?
        </p>
        <Link href="/login" className={AUTH_LINK}>
          Sign in instead
        </Link>
      </div>
    </MachAuthShell>
  );
}
