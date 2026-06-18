import { getContacts } from "@/app/actions/contacts";
import { OrderManagerPanel, type OrderContactOption, type OrderRecordView } from "@/components/orders/order-manager-panel";
import { listCustomerOrders } from "@/lib/orders";

export const dynamic = "force-dynamic";

export default async function OrdersPage({
    searchParams,
}: {
    searchParams?: Promise<{
        contactId?: string | string[];
        conversationId?: string | string[];
        new?: string | string[];
    }>;
}) {
    const params = await searchParams;
    const contactIdParam = Array.isArray(params?.contactId) ? params?.contactId[0] : params?.contactId;
    const conversationIdParam = Array.isArray(params?.conversationId) ? params?.conversationId[0] : params?.conversationId;
    const newParam = Array.isArray(params?.new) ? params?.new[0] : params?.new;

    const [contacts, orders] = await Promise.all([
        getContacts(),
        listCustomerOrders(contactIdParam ? { contactId: contactIdParam } : {}),
    ]);

    const contactOptions: OrderContactOption[] = contacts.map((contact) => ({
        id: contact.id,
        name: contact.name,
        lastName: contact.lastName,
        phone: contact.phone,
        email: contact.email,
        company: contact.company,
        whatsappAvatarUrl: contact.whatsappAvatarUrl,
    }));

    return (
        <OrderManagerPanel
            initialOrders={JSON.parse(JSON.stringify(orders)) as OrderRecordView[]}
            contacts={contactOptions}
            initialContactId={contactIdParam || null}
            initialConversationId={conversationIdParam || null}
            openNew={newParam === "1"}
        />
    );
}
