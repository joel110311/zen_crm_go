"use server";

import { prisma } from "@/lib/db";
import { revalidatePath } from "next/cache";
import {
    refreshWhatsAppAvatarForContact,
    refreshWhatsAppAvatarForContactsInBackground,
} from "@/lib/whatsapp-avatar";

export async function getContacts(query?: string) {
    try {
        const where = query
            ? {
                OR: [
                    { name: { contains: query, mode: "insensitive" as const } },
                    { lastName: { contains: query, mode: "insensitive" as const } },
                    { email: { contains: query, mode: "insensitive" as const } },
                    { phone: { contains: query, mode: "insensitive" as const } },
                    { company: { contains: query, mode: "insensitive" as const } },
                ],
            }
            : {};

        const contacts = await prisma.contact.findMany({
            where,
            orderBy: { createdAt: "desc" },
            include: {
                conversations: {
                    orderBy: { updatedAt: "desc" },
                    take: 1,
                    select: {
                        botActive: true,
                        assignedUser: {
                            select: {
                                name: true,
                            },
                        },
                        updatedAt: true,
                    },
                },
                deals: {
                    orderBy: { updatedAt: "desc" },
                    take: 1,
                    include: {
                        stage: {
                            select: {
                                name: true,
                                color: true,
                                isClosedWon: true,
                                isClosedLost: true,
                            },
                        },
                        intelligence: {
                            select: {
                                score: true,
                                interestStatus: true,
                                currentStep: true,
                            },
                        },
                    },
                },
            },
        });

        refreshWhatsAppAvatarForContactsInBackground(
            contacts.map((contact) => contact.id).slice(0, 20),
            { limit: 6, concurrency: 2 },
        );

        return contacts;
    } catch (error) {
        console.error("Failed to fetch contacts:", error);
        return [];
    }
}

export async function getContact(id: string) {
    try {
        await refreshWhatsAppAvatarForContact(id).catch((error) => {
            console.warn("[Contacts] Could not refresh WhatsApp avatar for contact details", error);
        });

        const contact = await prisma.contact.findUnique({
            where: { id },
            include: {
                deals: {
                    include: {
                        dealTags: {
                            include: {
                                tag: true
                            }
                        }
                    }
                },
                appointments: true,
            }
        });
        return contact;
    } catch (error) {
        console.error("Failed to fetch contact:", error);
        return null;
    }
}

export async function createContact(formData: FormData) {
    const name = formData.get("name") as string;
    const email = formData.get("email") as string;
    const phone = formData.get("phone") as string;
    const company = formData.get("company") as string;
    const status = formData.get("status") as string || "lead";

    if (!phone) {
        return { success: false, error: "El teléfono es obligatorio" };
    }

    try {
        const contact = await prisma.contact.create({
            data: {
                name,
                email,
                phone,
                company,
                status,
                tags: ["Nuevo"],
            },
        });
        revalidatePath("/dashboard/contacts");
        return { success: true, contact };
    } catch (error: any) {
        console.error("Failed to create contact:", error);
        if (error.code === 'P2002' && error.meta?.target?.includes('phone')) {
            return { success: false, error: "Ya existe un contacto con este número de teléfono." };
        }
        return { success: false, error: "Error al crear el contacto." };
    }
}

export async function updateContact(id: string, data: Partial<{
    name: string;
    lastName: string;
    email: string;
    phone: string;
    company: string;
    role: string;
    status: string;
    tags: string[];
}>) {
    try {
        const contact = await prisma.contact.update({
            where: { id },
            data,
        });
        revalidatePath("/dashboard/contacts");
        revalidatePath(`/dashboard/contacts/${id}`);
        return { success: true, contact };
    } catch (error: any) {
        console.error("Failed to update contact:", error);
        if (error.code === 'P2002' && error.meta?.target?.includes('phone')) {
            return { success: false, error: "Ya existe un contacto con este número de teléfono." };
        }
        return { success: false, error: "Error al actualizar: " + (error instanceof Error ? error.message : String(error)) };
    }
}

export async function deleteContact(id: string) {
    try {
        await prisma.contact.delete({
            where: { id },
        });
        revalidatePath("/dashboard/contacts");
        return { success: true };
    } catch (error) {
        console.error("Failed to delete contact:", error);
        return { success: false, error: "Error al eliminar el contacto." };
    }
}

export async function addContactTag(contactId: string, tag: string) {
    try {
        const contact = await prisma.contact.findUnique({ where: { id: contactId } });
        if (!contact) return { success: false, error: "Contact not found" };

        const newTags = Array.from(new Set([...contact.tags, tag]));

        await prisma.contact.update({
            where: { id: contactId },
            data: { tags: newTags },
        });

        revalidatePath(`/dashboard/contacts/${contactId}`);
        return { success: true };
    } catch (error) {
        console.error("Failed to add tag:", error);
        return { success: false, error: "Failed to add tag" };
    }
}

export async function removeContactTag(contactId: string, tag: string) {
    try {
        const contact = await prisma.contact.findUnique({ where: { id: contactId } });
        if (!contact) return { success: false, error: "Contact not found" };

        const newTags = contact.tags.filter((t: string) => t !== tag);

        await prisma.contact.update({
            where: { id: contactId },
            data: { tags: newTags },
        });

        revalidatePath(`/dashboard/contacts/${contactId}`);
        return { success: true };
    } catch (error) {
        console.error("Failed to remove tag:", error);
        return { success: false, error: "Failed to remove tag" };
    }
}
