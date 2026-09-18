import { useState } from "react";
import { toast } from "sonner";
import { trpc } from "#root/shared/trpc/client";

/**
 * The contact form's behaviour, shared by every storefront template.
 *
 * Extracted from the Minimal contact page so the Mach page can render its own
 * fields against the *same* `contact.submit` mutation rather than growing a
 * second submit path — one backend, one validation surface, one place for the
 * success and failure messages to stay consistent.
 *
 * Templates own the markup and nothing else.
 */
export interface ContactFormState {
  name: string;
  email: string;
  message: string;
  isSubmitting: boolean;
  setName: (value: string) => void;
  setEmail: (value: string) => void;
  setMessage: (value: string) => void;
  handleSubmit: (event: React.FormEvent) => Promise<void>;
}

export function useContactForm(locale: "en" | "ar"): ContactFormState {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const isAr = locale === "ar";

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!name.trim() || !email.trim() || !message.trim()) return;

    setIsSubmitting(true);
    try {
      const result = await trpc.contact.submit.mutate({
        name: name.trim(),
        email: email.trim(),
        message: message.trim(),
      });

      if (result.success) {
        toast.success(
          isAr
            ? "تم إرسال رسالتك بنجاح!"
            : "Your message has been sent successfully!",
        );
        setName("");
        setEmail("");
        setMessage("");
      } else {
        toast.error(
          result.error || (isAr ? "فشل إرسال الرسالة" : "Failed to send message"),
        );
      }
    } catch {
      toast.error(isAr ? "فشل إرسال الرسالة" : "Failed to send message");
    } finally {
      setIsSubmitting(false);
    }
  };

  return {
    name,
    email,
    message,
    isSubmitting,
    setName,
    setEmail,
    setMessage,
    handleSubmit,
  };
}
