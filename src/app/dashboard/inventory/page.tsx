import { InventoryManagerPanel } from "@/components/inventory/inventory-manager-panel";
import { getInventoryDashboard, listInventoryProducts, listInventorySources } from "@/lib/inventory";
import { auth } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function InventoryPage() {
    const [dashboard, inventory, sources, session] = await Promise.all([
        getInventoryDashboard(),
        listInventoryProducts({ includeInactive: true, pageSize: 100 }),
        listInventorySources(),
        auth(),
    ]);
    return <InventoryManagerPanel
        initialProducts={inventory.products}
        initialCategories={inventory.categories.map((category) => ({ id: category.id, name: category.name }))}
        stats={dashboard.stats}
        lastRun={dashboard.lastRun}
        sources={sources.map((source) => ({ ...source, lastSuccessfulSyncAt: source.lastSuccessfulSyncAt?.toISOString() || null }))}
        canManageSources={(session?.user as { role?: string } | undefined)?.role === "SUPERADMIN"}
    />;
}
