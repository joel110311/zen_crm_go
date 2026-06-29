"use client";

import { useActionState, useState } from "react";
import { Eye, EyeOff, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ZenLogo } from "@/components/icons/zen-logo";
import { loginAction } from "./actions";

export default function LoginPage() {
    const [errorMessage, formAction, isPending] = useActionState(loginAction, undefined);
    const [showPassword, setShowPassword] = useState(false);

    return (
        <div className="flex min-h-screen items-center justify-center bg-background px-4">
            <div className="w-full max-w-md">
                <div className="mb-8 text-center sm:mb-10">
                    <div className="mb-5 flex justify-center">
                        <div className="flex h-20 w-20 items-center justify-center rounded-2xl border border-border bg-card shadow-soft sm:h-24 sm:w-24">
                            <ZenLogo className="h-16 w-16 text-foreground sm:h-20 sm:w-20" />
                        </div>
                    </div>
                    <h1 className="text-2xl font-semibold tracking-normal text-foreground sm:text-3xl">
                        Zen CRM
                    </h1>
                    <p className="mt-1 text-sm text-muted-foreground sm:text-base">
                        Gestion inteligente de clientes con IA
                    </p>
                </div>

                <div className="rounded-xl border border-border bg-card p-6 shadow-soft sm:p-8">
                    <div className="mb-5 sm:mb-6">
                        <h2 className="text-lg font-semibold text-foreground sm:text-xl">Iniciar sesion</h2>
                        <p className="mt-0.5 text-sm text-muted-foreground">Ingresa tus credenciales para continuar</p>
                    </div>

                    <form action={formAction} className="space-y-4 sm:space-y-5">
                        <input type="hidden" name="redirectTo" value="/dashboard" />

                        <div className="space-y-1.5">
                            <Label htmlFor="email" className="text-sm font-medium text-foreground">
                                Correo electronico
                            </Label>
                            <Input
                                id="email"
                                name="email"
                                type="email"
                                placeholder="tu@email.com"
                                required
                                className="h-12 border-border bg-background text-base text-foreground placeholder:text-muted-foreground focus:border-primary focus:ring-primary/20"
                            />
                        </div>

                        <div className="space-y-1.5">
                            <Label htmlFor="password" className="text-sm font-medium text-foreground">
                                Contrasena
                            </Label>
                            <div className="relative">
                                <Input
                                    id="password"
                                    name="password"
                                    type={showPassword ? "text" : "password"}
                                    placeholder="********"
                                    required
                                    className="h-12 border-border bg-background pr-11 text-base text-foreground placeholder:text-muted-foreground focus:border-primary focus:ring-primary/20"
                                />
                                <button
                                    type="button"
                                    onClick={() => setShowPassword(!showPassword)}
                                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground transition hover:text-foreground"
                                    aria-label={showPassword ? "Ocultar contrasena" : "Mostrar contrasena"}
                                >
                                    {showPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                                </button>
                            </div>
                        </div>

                        {errorMessage ? (
                            <div className="rounded-lg border border-destructive/20 bg-destructive/10 px-4 py-3 text-sm text-destructive">
                                {errorMessage}
                            </div>
                        ) : null}

                        <Button type="submit" disabled={isPending} className="h-12 w-full text-base">
                            {isPending ? (
                                <>
                                    <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                                    Verificando...
                                </>
                            ) : (
                                "Iniciar sesion"
                            )}
                        </Button>
                    </form>
                </div>

                <p className="mt-6 text-center text-xs text-muted-foreground sm:mt-8">
                    v1.0 - 2026 Zen CRM
                </p>
            </div>
        </div>
    );
}
