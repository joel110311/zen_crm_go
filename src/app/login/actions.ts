"use server";

import { signIn } from "@/lib/auth";
import { AuthError } from "next-auth";

export async function loginAction(formData: FormData) {
    const email = formData.get("email") as string;
    const password = formData.get("password") as string;

    try {
        await signIn("credentials", {
            email,
            password,
            redirectTo: "/dashboard",
        });
    } catch (error) {
        if (error instanceof AuthError) {
            return { error: "Credenciales incorrectas. Verifica tu email y contraseña." };
        }
        // Next.js redirect throws a NEXT_REDIRECT error — rethrow it
        throw error;
    }
}
