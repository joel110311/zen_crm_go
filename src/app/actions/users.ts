"use server";

import { prisma } from "@/lib/db";
import { auth } from "@/lib/auth";
import bcrypt from "bcryptjs";
import { revalidatePath } from "next/cache";

// Guard: only superadmin can call these
async function requireSuperAdmin() {
    const session = await auth();
    const role = (session?.user as any)?.role;
    if (role !== "SUPERADMIN") {
        throw new Error("Unauthorized");
    }
    return session;
}

export async function getUsers() {
    await requireSuperAdmin();
    const users = await prisma.user.findMany({
        select: {
            id: true,
            name: true,
            email: true,
            role: true,
            createdAt: true,
        },
        orderBy: { createdAt: "asc" },
    });
    return users;
}

export async function createUser(data: {
    name: string;
    email: string;
    password: string;
    role: "ADMIN" | "SUPERADMIN";
}) {
    await requireSuperAdmin();

    const existing = await prisma.user.findUnique({
        where: { email: data.email },
    });
    if (existing) {
        return { success: false, error: "Ya existe un usuario con ese correo." };
    }

    if (data.password.length < 6) {
        return { success: false, error: "La contraseña debe tener al menos 6 caracteres." };
    }

    const hashedPassword = await bcrypt.hash(data.password, 12);

    const user = await prisma.user.create({
        data: {
            name: data.name,
            email: data.email,
            password: hashedPassword,
            role: data.role,
        },
        select: {
            id: true,
            name: true,
            email: true,
            role: true,
            createdAt: true,
        },
    });

    revalidatePath("/dashboard/settings");
    return { success: true, user };
}

export async function updateUser(userId: string, data: {
    name?: string;
    email?: string;
    password?: string;
    role?: "ADMIN" | "SUPERADMIN";
}) {
    await requireSuperAdmin();

    // If email is being changed, check uniqueness
    if (data.email) {
        const existing = await prisma.user.findUnique({
            where: { email: data.email },
        });
        if (existing && existing.id !== userId) {
            return { success: false, error: "Ya existe un usuario con ese correo." };
        }
    }

    // Build update payload
    const updateData: any = {};
    if (data.name !== undefined) updateData.name = data.name;
    if (data.email !== undefined) updateData.email = data.email;
    if (data.role !== undefined) updateData.role = data.role;
    if (data.password && data.password.length > 0) {
        if (data.password.length < 6) {
            return { success: false, error: "La contraseña debe tener al menos 6 caracteres." };
        }
        updateData.password = await bcrypt.hash(data.password, 12);
    }

    const user = await prisma.user.update({
        where: { id: userId },
        data: updateData,
        select: {
            id: true,
            name: true,
            email: true,
            role: true,
            createdAt: true,
        },
    });

    revalidatePath("/dashboard/settings");
    return { success: true, user };
}

export async function deleteUser(userId: string) {
    const session = await requireSuperAdmin();
    const currentUserId = (session?.user as any)?.id;

    if (userId === currentUserId) {
        return { success: false, error: "No puedes eliminar tu propia cuenta." };
    }

    await prisma.user.delete({
        where: { id: userId },
    });

    revalidatePath("/dashboard/settings");
    return { success: true };
}
