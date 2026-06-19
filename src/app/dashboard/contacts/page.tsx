import { getContactsPage } from "@/app/actions/contacts";
import { ContactsTable } from "@/components/contacts/contacts-table";

export const dynamic = "force-dynamic";

export default async function ContactsPage({
    searchParams,
}: {
    searchParams?: Promise<{
        query?: string | string[];
        page?: string | string[];
        pageSize?: string | string[];
    }>;
}) {
    const resolvedSearchParams = await searchParams;
    const queryValue = resolvedSearchParams?.query;
    const query = Array.isArray(queryValue) ? queryValue[0] || "" : queryValue || "";
    const pageValue = resolvedSearchParams?.page;
    const pageSizeValue = resolvedSearchParams?.pageSize;
    const requestedPage = Number.parseInt(Array.isArray(pageValue) ? pageValue[0] || "1" : pageValue || "1", 10);
    const requestedPageSize = Number.parseInt(Array.isArray(pageSizeValue) ? pageSizeValue[0] || "10" : pageSizeValue || "10", 10);
    const result = await getContactsPage({
        query,
        page: Number.isFinite(requestedPage) ? requestedPage : 1,
        pageSize: Number.isFinite(requestedPageSize) ? requestedPageSize : 10,
    });

    return (
        <div className="h-full">
            <ContactsTable
                key={`${query}:${result.pageSize}`}
                contacts={result.contacts}
                total={result.total}
                page={result.page}
                pageSize={result.pageSize}
                totalPages={result.totalPages}
                query={query}
            />
        </div>
    );
}
