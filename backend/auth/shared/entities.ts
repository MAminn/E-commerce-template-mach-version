export interface ClientSession {
  id: string;
  token: string;
  email: string;
  name: string;
  phone: string;
  expiresAt: Date;
  role: "admin" | "vendor" | "user" | "superadmin" | "media_buyer";
  emailVerified?: boolean;
  profilePicture?: string | null;
  image?: string | null;
}
