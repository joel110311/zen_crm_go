import { Sidebar } from "@/components/layout/sidebar";
import { Header } from "@/components/layout/header";
import { InboxNotifier } from "@/components/layout/inbox-notifier";
import { UnreadTabBadge } from "@/components/layout/unread-tab-badge";
import { auth } from "@/lib/auth";

// Force all dashboard pages to be server-rendered at request time (not during build)
// This is required for Docker builds where no database is available
export const dynamic = 'force-dynamic';

export default async function DashboardLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    const session = await auth();

    return (
        <div className="flex h-screen w-full overflow-hidden bg-background">
            <InboxNotifier />
            <UnreadTabBadge />
            <Sidebar session={session} />
            <div className="flex min-w-0 flex-1 flex-col overflow-hidden pt-14 md:pt-0">
                <Header />
                <main className="min-h-0 flex-1 overflow-auto px-3.5 pb-5 pt-3 md:px-5 md:pb-6 md:pt-3.5 lg:px-6 xl:px-7">
                    {children}
                </main>
            </div>
        </div>
    );
}
