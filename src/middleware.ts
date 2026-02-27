import { getToken } from "next-auth/jwt";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

export async function middleware(req: NextRequest) {
    const { pathname } = req.nextUrl;

    // Public paths that don't require authentication
    const publicPaths = ["/login", "/api/auth", "/api/webhook", "/api/seed", "/api/bot-message"];
    const isPublicPath = publicPaths.some((path) => pathname.startsWith(path));

    if (isPublicPath) {
        return NextResponse.next();
    }

    // Try both cookie names (HTTPS uses __Secure- prefix, HTTP uses plain)
    // Behind reverse proxies like Traefik, the internal request may be HTTP
    // but the cookie was set with __Secure- prefix because AUTH_URL is HTTPS
    let token = await getToken({
        req,
        secret: process.env.AUTH_SECRET,
        cookieName: "__Secure-authjs.session-token",
    });

    if (!token) {
        token = await getToken({
            req,
            secret: process.env.AUTH_SECRET,
            cookieName: "authjs.session-token",
        });
    }

    // If not authenticated, redirect to login
    if (!token) {
        const loginUrl = new URL("/login", req.url);
        loginUrl.searchParams.set("callbackUrl", pathname);
        return NextResponse.redirect(loginUrl);
    }

    // ADMIN users cannot access /dashboard/brain
    if (token.role === "ADMIN" && pathname.startsWith("/dashboard/brain")) {
        return NextResponse.redirect(new URL("/dashboard", req.url));
    }

    return NextResponse.next();
}

export const config = {
    matcher: [
        "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|mp3|wav|ogg)$).*)",
    ],
};
