"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ZenLogo } from "@/components/icons/zen-logo";
import { Loader2, Eye, EyeOff } from "lucide-react";
import { loginAction } from "./actions";

export default function LoginPage() {
    const [showPassword, setShowPassword] = useState(false);
    const [error, setError] = useState("");
    const [isPending, startTransition] = useTransition();

    const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        setError("");

        const formData = new FormData(e.currentTarget);

        startTransition(async () => {
            const result = await loginAction(formData);
            if (result?.error) {
                setError(result.error);
            }
        });
    };

    return (
        <div className="min-h-screen flex items-center justify-center bg-white relative overflow-hidden px-4">
            {/* Subtle background accent */}
            <div className="absolute inset-0 pointer-events-none">
                <div className="absolute top-0 right-0 w-[500px] h-[500px] bg-gray-100 rounded-full blur-3xl -translate-y-1/2 translate-x-1/4" />
                <div className="absolute bottom-0 left-0 w-[400px] h-[400px] bg-gray-50 rounded-full blur-3xl translate-y-1/3 -translate-x-1/4" />
            </div>

            <div className="relative z-10 w-full max-w-md">
                {/* Logo and branding */}
                <div className="text-center mb-8 sm:mb-10">
                    <div className="flex justify-center mb-5">
                        <ZenLogo className="h-20 w-20 sm:h-28 sm:w-28 text-[#0F172A]" />
                    </div>
                    <h1 className="text-2xl sm:text-3xl font-bold text-[#0F172A] tracking-tight">
                        Zen CRM
                    </h1>
                    <p className="text-sm sm:text-base text-[#64748B] mt-1">
                        Gestión inteligente de clientes con IA
                    </p>
                </div>

                {/* Login card */}
                <div className="bg-white border border-[#E2E8F0] rounded-2xl p-6 sm:p-8 shadow-[0_4px_6px_-1px_rgba(0,0,0,0.1)]">
                    <div className="mb-5 sm:mb-6">
                        <h2 className="text-lg sm:text-xl font-semibold text-[#0F172A]">Iniciar Sesión</h2>
                        <p className="text-sm text-[#64748B] mt-0.5">Ingresa tus credenciales para continuar</p>
                    </div>

                    <form onSubmit={handleSubmit} className="space-y-4 sm:space-y-5">
                        <div className="space-y-1.5">
                            <Label htmlFor="email" className="text-[#0F172A] text-sm font-medium">
                                Correo Electrónico
                            </Label>
                            <Input
                                id="email"
                                name="email"
                                type="email"
                                placeholder="tu@email.com"
                                required
                                className="bg-[#F8FAFC] border-[#E2E8F0] text-[#0F172A] placeholder:text-[#94A3B8] focus:border-[#0F172A] focus:ring-[#0F172A]/20 h-12 sm:h-12 text-base"
                            />
                        </div>

                        <div className="space-y-1.5">
                            <Label htmlFor="password" className="text-[#0F172A] text-sm font-medium">
                                Contraseña
                            </Label>
                            <div className="relative">
                                <Input
                                    id="password"
                                    name="password"
                                    type={showPassword ? "text" : "password"}
                                    placeholder="••••••••"
                                    required
                                    className="bg-[#F8FAFC] border-[#E2E8F0] text-[#0F172A] placeholder:text-[#94A3B8] focus:border-[#0F172A] focus:ring-[#0F172A]/20 h-12 sm:h-12 text-base pr-11"
                                />
                                <button
                                    type="button"
                                    onClick={() => setShowPassword(!showPassword)}
                                    className="absolute right-3 top-1/2 -translate-y-1/2 text-[#94A3B8] hover:text-[#64748B] transition"
                                >
                                    {showPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                                </button>
                            </div>
                        </div>

                        {error && (
                            <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-4 py-3">
                                {error}
                            </div>
                        )}

                        <Button
                            type="submit"
                            disabled={isPending}
                            className="w-full h-12 bg-[#0F172A] hover:bg-[#1E293B] text-white font-medium rounded-lg shadow-md transition-all duration-200 text-base"
                        >
                            {isPending ? (
                                <>
                                    <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                                    Verificando...
                                </>
                            ) : (
                                "Iniciar Sesión"
                            )}
                        </Button>
                    </form>
                </div>

                {/* Footer */}
                <p className="text-center text-xs text-[#94A3B8] mt-6 sm:mt-8">
                    v1.0 · © 2026 Zen CRM
                </p>
            </div>
        </div>
    );
}
