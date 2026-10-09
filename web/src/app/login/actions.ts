"use server";

import { CallbackRouteError } from "@auth/core/errors";
import { CredentialsSignin } from "next-auth";
import { redirect } from "next/navigation";
import { signIn } from "@/auth";

export async function loginAction(formData: FormData) {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");
  const callbackUrl = String(formData.get("callbackUrl") ?? "/dashboard");

  try {
    // Ne pas passer le FormData brut : Next.js y ajoute $ACTION_* et casse le callback Auth.js.
    await signIn("credentials", {
      email,
      password,
      redirectTo: callbackUrl.startsWith("/") ? callbackUrl : "/dashboard",
    });
  } catch (error) {
    if (error instanceof CredentialsSignin) {
      redirect(
        `/login?error=1&email=${encodeURIComponent(email)}&callbackUrl=${encodeURIComponent(callbackUrl)}`,
      );
    }
    if (error instanceof CallbackRouteError) {
      console.error("[auth] CallbackRouteError", error.cause ?? error);
      redirect(
        `/login?error=server&email=${encodeURIComponent(email)}&callbackUrl=${encodeURIComponent(callbackUrl)}`,
      );
    }
    throw error;
  }
}
