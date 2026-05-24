"use server";

import type { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import {
    refreshWhatsAppAvatarForContact,
    refreshWhatsAppAvatarForContactsInBackground,
} from "@/lib/whatsapp-avatar";
import { resolveMessageSourceId } from "@/lib/message-source";
import { getSystemSettingsOrDefaults } from "@/lib/system-settings";

const CONTACT_LIST_INCLUDE = {
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
} satisfies Prisma.ContactInclude;

export type ContactListItem = Prisma.ContactGetPayload<{
    include: typeof CONTACT_LIST_INCLUDE;
}>;

function buildContactSearchWhere(query?: string): Prisma.ContactWhereInput {
    if (!query) {
        return {};
    }

    return {
        OR: [
            { name: { contains: query, mode: "insensitive" } },
            { lastName: { contains: query, mode: "insensitive" } },
            { email: { contains: query, mode: "insensitive" } },
            { phone: { contains: query, mode: "insensitive" } },
            { company: { contains: query, mode: "insensitive" } },
        ],
    };
}

function normalizeContactIds(contactIds: string[]) {
    return [...new Set(contactIds.map((value) => value.trim()).filter(Boolean))];
}

function revalidateContactSurfaces(contactIds: string[] = []) {
    revalidatePath("/dashboard");
    revalidatePath("/dashboard/contacts");
    revalidatePath("/dashboard/inbox");
    revalidatePath("/dashboard/pipeline");

    for (const contactId of contactIds) {
        revalidatePath(`/dashboard/contacts/${contactId}`);
    }
}

function isPhoneUniqueConstraintError(error: unknown) {
    if (!error || typeof error !== "object") {
        return false;
    }

    const maybePrismaError = error as {
        code?: string;
        meta?: {
            target?: unknown;
        };
    };

    const targets = Array.isArray(maybePrismaError.meta?.target)
        ? maybePrismaError.meta.target.map(String)
        : [];

    return maybePrismaError.code === "P2002" && targets.includes("phone");
}

async function deleteContactsGraph(contactIds: string[]) {
    const ids = normalizeContactIds(contactIds);
    if (ids.length === 0) {
        return 0;
    }

    const conversations = await prisma.conversation.findMany({
        where: {
            contactId: {
                in: ids,
            },
        },
        select: {
            id: true,
        },
    });

    const conversationIds = conversations.map((conversation) => conversation.id);
    let deletedCount = 0;

    await prisma.$transaction(async (tx) => {
        if (conversationIds.length > 0) {
            await tx.message.deleteMany({
                where: {
                    conversationId: {
                        in: conversationIds,
                    },
                },
            });

            await tx.catalogConversationState.deleteMany({
                where: {
                    conversationId: {
                        in: conversationIds,
                    },
                },
            });

            await tx.bulkCampaignRecipient.updateMany({
                where: {
                    conversationId: {
                        in: conversationIds,
                    },
                },
                data: {
                    conversationId: null,
                },
            });

            await tx.conversation.deleteMany({
                where: {
                    id: {
                        in: conversationIds,
                    },
                },
            });
        }

        await tx.appointment.deleteMany({
            where: {
                contactId: {
                    in: ids,
                },
            },
        });

        await tx.deal.deleteMany({
            where: {
                contactId: {
                    in: ids,
                },
            },
        });

        const deletedContacts = await tx.contact.deleteMany({
            where: {
                id: {
                    in: ids,
                },
            },
        });

        deletedCount = deletedContacts.count;
    });

    return deletedCount;
}

export async function getContacts(query?: string) {
    try {
        const contacts = await prisma.contact.findMany({
            where: buildContactSearchWhere(query),
            orderBy: { createdAt: "desc" },
            include: CONTACT_LIST_INCLUDE,
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
                                tag: true,
                            },
                        },
                    },
                },
                appointments: true,
            },
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
    const status = (formData.get("status") as string) || "lead";

    if (!phone) {
        return { success: false, error: "El telefono es obligatorio" };
    }

    try {
        const settings = await getSystemSettingsOrDefaults();
        const wuzapiSourceId = resolveMessageSourceId("wuzapi", settings);
        const contact = await prisma.$transaction(async (tx) => {
            const createdContact = await tx.contact.create({
                data: {
                    name,
                    email,
                    phone,
                    company,
                    status,
                    tags: ["Nuevo"],
                },
            });

            await tx.conversation.create({
                data: {
                    contactId: createdContact.id,
                    status: "active",
                    sourceType: "wuzapi",
                    sourceId: wuzapiSourceId,
                    botActive: true,
                },
            });

            return createdContact;
        });

        revalidatePath("/dashboard/contacts");
        return { success: true, contact };
    } catch (error) {
        console.error("Failed to create contact:", error);
        if (isPhoneUniqueConstraintError(error)) {
            return { success: false, error: "Ya existe un contacto con este numero de telefono." };
        }
        return { success: false, error: "Error al crear el contacto." };
    }
}

export async function updateContact(
    id: string,
    data: Partial<{
        name: string;
        lastName: string;
        email: string;
        phone: string;
        company: string;
        role: string;
        status: string;
        tags: string[];
    }>,
) {
    try {
        const contact = await prisma.contact.update({
            where: { id },
            data,
        });

        revalidatePath("/dashboard/contacts");
        revalidatePath(`/dashboard/contacts/${id}`);
        return { success: true, contact };
    } catch (error) {
        console.error("Failed to update contact:", error);
        if (isPhoneUniqueConstraintError(error)) {
            return { success: false, error: "Ya existe un contacto con este numero de telefono." };
        }
        return {
            success: false,
            error: `Error al actualizar: ${error instanceof Error ? error.message : String(error)}`,
        };
    }
}

export async function deleteContact(id: string) {
    try {
        const deletedCount = await deleteContactsGraph([id]);
        revalidateContactSurfaces([id]);

        if (deletedCount === 0) {
            return { success: false, error: "No se encontro el contacto." };
        }

        return { success: true };
    } catch (error) {
        console.error("Failed to delete contact:", error);
        return { success: false, error: "Error al eliminar el contacto." };
    }
}

export async function deleteContactsBulk(contactIds: string[]) {
    try {
        const ids = normalizeContactIds(contactIds);
        if (ids.length === 0) {
            return { success: false, error: "Selecciona al menos un contacto." };
        }

        const deletedCount = await deleteContactsGraph(ids);
        revalidateContactSurfaces(ids);

        return {
            success: true,
            deletedCount,
        };
    } catch (error) {
        console.error("Failed to bulk delete contacts:", error);
        return {
            success: false,
            error: "Error al eliminar los contactos seleccionados.",
        };
    }
}

export async function addContactTag(contactId: string, tag: string) {
    try {
        const contact = await prisma.contact.findUnique({ where: { id: contactId } });
        if (!contact) {
            return { success: false, error: "Contact not found" };
        }

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
        if (!contact) {
            return { success: false, error: "Contact not found" };
        }

        const newTags = contact.tags.filter((entry: string) => entry !== tag);

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
