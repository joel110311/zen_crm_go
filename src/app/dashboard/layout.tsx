import { Sidebar } from "@/components/layout/sidebar";
import { DashboardShell } from "@/components/layout/dashboard-shell";
import { InboxNotifier } from "@/components/layout/inbox-notifier";
import { UnreadTabBadge } from "@/components/layout/unread-tab-badge";
import { SessionProvider } from "@/components/providers/session-provider";
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
        <SessionProvider session={session}>
            <div className="flex h-screen w-full overflow-hidden bg-background">
                <InboxNotifier />
                <UnreadTabBadge />
                <Sidebar session={session} />
                <DashboardShell>{children}</DashboardShell>
            </div>
        </SessionProvider>
    );
}
