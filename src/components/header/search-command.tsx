"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Briefcase, Loader2, Search, User } from "lucide-react";
import { useDebounce } from "use-debounce";
import {
    CommandDialog,
    CommandEmpty,
    CommandGroup,
    CommandInput,
    CommandItem,
    CommandList,
    CommandSeparator,
} from "@/components/ui/command";
import { Button } from "@/components/ui/button";
import { searchGlobal, type SearchResult } from "@/app/actions/search";
import { cn } from "@/lib/utils";
import { getContactFullName } from "@/lib/contact-name";

export function SearchCommand() {
    const router = useRouter();
    const [open, setOpen] = React.useState(false);
    const [query, setQuery] = React.useState("");
    const [debouncedQuery] = useDebounce(query, 300);
    const [data, setData] = React.useState<SearchResult | null>(null);
    const [loading, setLoading] = React.useState(false);

    React.useEffect(() => {
        const down = (event: KeyboardEvent) => {
            if (event.key === "k" && (event.metaKey || event.ctrlKey)) {
                event.preventDefault();
                setOpen((current) => !current);
            }
        };
        document.addEventListener("keydown", down);
        return () => document.removeEventListener("keydown", down);
    }, []);

    React.useEffect(() => {
        if (debouncedQuery.length < 2) {
            setData(null);
            return;
        }

        const fetchResults = async () => {
            setLoading(true);
            try {
                const results = await searchGlobal(debouncedQuery);
                setData(results);
            } catch (error) {
                console.error("Search failed", error);
            } finally {
                setLoading(false);
            }
        };

        void fetchResults();
    }, [debouncedQuery]);

    const handleSelect = (callback: () => void) => {
        setOpen(false);
        callback();
    };

    return (
        <>
            <Button
                variant="outline"
                className={cn(
                    "relative h-10 w-full justify-start rounded-xl border-border bg-card px-3.5 text-sm text-muted-foreground shadow-[var(--shadow-inset)] sm:pr-14",
                )}
                onClick={() => setOpen(true)}
            >
                <Search className="mr-2 h-4 w-4" />
                <span>Buscar...</span>
                <kbd className="pointer-events-none absolute right-1.5 top-1.5 hidden h-5 select-none items-center rounded border bg-muted px-1.5 font-mono text-[10px] font-medium opacity-100 sm:flex">
                    Ctrl K
                </kbd>
            </Button>

            <CommandDialog open={open} onOpenChange={setOpen}>
                <CommandInput
                    placeholder="Buscar contactos u oportunidades..."
                    value={query}
                    onValueChange={setQuery}
                />
                <CommandList>
                    <CommandEmpty>No se encontraron resultados.</CommandEmpty>

                    {loading ? (
                        <div className="flex items-center justify-center p-4 text-sm text-muted-foreground">
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            Buscando...
                        </div>
                    ) : null}

                    {!loading && data ? (
                        <>
                            {data.contacts.length > 0 ? (
                                <CommandGroup heading="Contactos">
                                    {data.contacts.map((contact) => (
                                        <CommandItem
                                            key={contact.id}
                                            value={`contact-${contact.id}-${contact.name}-${contact.email}`}
                                            onSelect={() => handleSelect(() => router.push(`/dashboard/contacts?id=${contact.id}`))}
                                        >
                                            <User className="mr-2 h-4 w-4" />
                                            <div className="flex flex-col">
                                                <span>{getContactFullName(contact, "Unknown")}</span>
                                                <span className="text-xs text-muted-foreground">{contact.email}</span>
                                            </div>
                                        </CommandItem>
                                    ))}
                                </CommandGroup>
                            ) : null}

                            {data.contacts.length > 0 && data.deals.length > 0 ? <CommandSeparator /> : null}

                            {data.deals.length > 0 ? (
                                <CommandGroup heading="Oportunidades">
                                    {data.deals.map((deal) => (
                                        <CommandItem
                                            key={deal.id}
                                            value={`deal-${deal.id}-${deal.title}`}
                                            onSelect={() => handleSelect(() => router.push(`/dashboard/pipeline?deal=${deal.id}`))}
                                        >
                                            <Briefcase className="mr-2 h-4 w-4" />
                                            <div className="flex flex-col">
                                                <span>{deal.title}</span>
                                                <span className="text-xs text-muted-foreground">
                                                    {new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN" }).format(deal.value)} - {deal.stageName}
                                                </span>
                                            </div>
                                        </CommandItem>
                                    ))}
                                </CommandGroup>
                            ) : null}
                        </>
                    ) : null}
                </CommandList>
            </CommandDialog>
        </>
    );
}
