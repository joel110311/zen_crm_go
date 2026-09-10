"use client";

import { FormEvent, useMemo, useRef, useState } from "react";
import { AlertTriangle, Box, Boxes, Download, FileUp, Loader2, PackagePlus, Pencil, Plus, Power, PowerOff, RefreshCw, Search, Sparkles, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import type { InventoryProductView } from "@/lib/inventory";

type InventoryStats = { products: number; unitsAvailable: number; lowStock: number; outOfStock: number };
type Source = { id: string; name: string; type: string; sourceUri: string | null; isActive: boolean; lastSuccessfulSyncAt: string | null; lastError: string | null };

type Props = {
    initialProducts: InventoryProductView[];
    initialCategories: Array<{ id: string; name: string }>;
    stats: InventoryStats;
    sources: Source[];
    canManageSources: boolean;
};

type PriceTierForm = { minQuantity: string; maxQuantity: string; unitPrice: string };
type ProductForm = Record<"sku" | "name" | "category" | "description" | "unit" | "salePrice" | "onHand" | "minimumStock" | "tags", string> & { priceTiers: PriceTierForm[] };
const blankForm: ProductForm = { sku: "", name: "", category: "", description: "", unit: "pieza", salePrice: "", onHand: "0", minimumStock: "0", tags: "", priceTiers: [] };
const blankSourceForm = { name: "", type: "google_sheets", sourceUri: "", isActive: true };

function formFromProduct(product: InventoryProductView): ProductForm {
    return {
        sku: product.sku, name: product.name, category: product.category?.name || "", description: product.description || "", unit: product.unit,
        salePrice: product.priceTiers.length ? "" : String(product.salePrice), onHand: String(product.locations[0]?.onHand ?? product.onHand),
        minimumStock: String(product.locations[0]?.minimumStock ?? product.minimumStock), tags: product.tags.join(", "),
        priceTiers: product.priceTiers.map((tier) => ({ minQuantity: String(tier.minQuantity), maxQuantity: tier.maxQuantity === null ? "" : String(tier.maxQuantity), unitPrice: String(tier.unitPrice) })),
    };
}

function money(value: number) {
    return new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN", maximumFractionDigits: 2 }).format(value);
}

function priceLabel(product: InventoryProductView) {
    if (product.priceTiers.length === 0) return money(product.salePrice);
    const prices = product.priceTiers.map((tier) => tier.unitPrice);
    return `${money(Math.min(...prices))}–${money(Math.max(...prices))}`;
}

function statusLabel(status: InventoryProductView["stockStatus"]) {
    if (status === "out") return "Agotado";
    if (status === "low") return "Stock bajo";
    return "Disponible";
}

export function InventoryManagerPanel({ initialProducts, initialCategories, stats, sources: initialSources, canManageSources }: Props) {
    const [products, setProducts] = useState(initialProducts);
    const [sources, setSources] = useState(initialSources);
    const [categories] = useState(initialCategories);
    const [query, setQuery] = useState("");
    const [status, setStatus] = useState("all");
    const [loading, setLoading] = useState(false);
    const [notice, setNotice] = useState<string | null>(null);
    const [editing, setEditing] = useState<InventoryProductView | null>(null);
    const [form, setForm] = useState<ProductForm>(blankForm);
    const [formOpen, setFormOpen] = useState(false);
    const [adjusting, setAdjusting] = useState<InventoryProductView | null>(null);
    const [nextOnHand, setNextOnHand] = useState("");
    const [reason, setReason] = useState("");
    const [sourceOpen, setSourceOpen] = useState(false);
    const [editingSource, setEditingSource] = useState<Source | null>(null);
    const [sourceForm, setSourceForm] = useState(blankSourceForm);
    const fileRef = useRef<HTMLInputElement>(null);

    const visibleProducts = useMemo(() => products.filter((product) => status === "all" || product.stockStatus === status), [products, status]);

    async function readError(response: Response) {
        const data = await response.json().catch(() => ({}));
        return data.error || "Ocurrió un error inesperado.";
    }

    async function search(event?: FormEvent) {
        event?.preventDefault();
        setLoading(true);
        setNotice(null);
        try {
            const response = await fetch(`/api/inventory?q=${encodeURIComponent(query)}&pageSize=100`, { cache: "no-store" });
            if (!response.ok) throw new Error(await readError(response));
            const data = await response.json();
            setProducts(data.products);
        } catch (error) {
            setNotice(error instanceof Error ? error.message : "No se pudo buscar.");
        } finally { setLoading(false); }
    }

    function openNewProduct() {
        setEditing(null); setForm({ ...blankForm, priceTiers: [] }); setNotice(null); setFormOpen(true);
    }

    function openEditProduct(product: InventoryProductView) {
        setEditing(product); setForm(formFromProduct(product)); setNotice(null); setFormOpen(true);
    }

    async function saveProduct(event: FormEvent) {
        event.preventDefault(); setLoading(true); setNotice(null);
        try {
            const response = await fetch(editing ? `/api/inventory/${editing.id}` : "/api/inventory", {
                method: editing ? "PATCH" : "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(form),
            });
            if (!response.ok) throw new Error(await readError(response));
            const { product } = await response.json() as { product: InventoryProductView };
            setProducts((current) => editing ? current.map((item) => item.id === product.id ? product : item) : [product, ...current]);
            setFormOpen(false); setNotice(editing ? "Producto actualizado." : "Producto creado.");
        } catch (error) { setNotice(error instanceof Error ? error.message : "No se pudo guardar."); }
        finally { setLoading(false); }
    }

    async function saveAdjustment(event: FormEvent) {
        event.preventDefault(); if (!adjusting) return; setLoading(true); setNotice(null);
        try {
            const response = await fetch(`/api/inventory/${adjusting.id}/adjust`, {
                method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ nextOnHand, reason }),
            });
            if (!response.ok) throw new Error(await readError(response));
            const { product } = await response.json() as { product: InventoryProductView };
            setProducts((current) => current.map((item) => item.id === product.id ? product : item));
            setAdjusting(null); setNotice("Existencia ajustada y registrada en el historial.");
        } catch (error) { setNotice(error instanceof Error ? error.message : "No se pudo ajustar."); }
        finally { setLoading(false); }
    }

    async function importCsv() {
        const file = fileRef.current?.files?.[0];
        if (!file) return;
        setLoading(true); setNotice(null);
        try {
            const body = new FormData(); body.set("file", file);
            const response = await fetch("/api/inventory/import", { method: "POST", body });
            if (!response.ok) throw new Error(await readError(response));
            const { result } = await response.json();
            setNotice(`Importación terminada: ${result.insertedCount} altas, ${result.updatedCount} actualizaciones y ${result.deactivatedCount} desactivados.`);
            await search();
        } catch (error) { setNotice(error instanceof Error ? error.message : "No se pudo importar."); }
        finally { setLoading(false); if (fileRef.current) fileRef.current.value = ""; }
    }

    async function prepareSemanticSearch() {
        setLoading(true); setNotice(null);
        try {
            const response = await fetch("/api/inventory/embeddings", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ limit: 50 }) });
            if (!response.ok) throw new Error(await readError(response));
            const { updated } = await response.json(); setNotice(updated ? `Se prepararon ${updated} productos para búsqueda semántica.` : "No hay productos pendientes de preparar.");
        } catch (error) { setNotice(error instanceof Error ? error.message : "No se pudo preparar la búsqueda."); }
        finally { setLoading(false); }
    }

    async function saveSource(event: FormEvent) {
        event.preventDefault(); setLoading(true); setNotice(null);
        try {
            const response = await fetch("/api/inventory/sources", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: editingSource?.id, ...sourceForm }) });
            if (!response.ok) throw new Error(await readError(response));
            const { source } = await response.json() as { source: Source };
            setSources((current) => editingSource ? current.map((item) => item.id === source.id ? source : item) : [source, ...current]);
            setSourceOpen(false); setEditingSource(null); setSourceForm(blankSourceForm);
            setNotice(editingSource ? "Fuente actualizada." : "Fuente registrada. Usa su ID al configurar n8n.");
        } catch (error) { setNotice(error instanceof Error ? error.message : "No se pudo registrar la fuente."); }
        finally { setLoading(false); }
    }

    async function removeProduct(product: InventoryProductView) {
        const synchronized = product.source !== "manual";
        const sourceWarning = synchronized ? " También retíralo de la fuente sincronizada para evitar que vuelva a activarse." : "";
        if (!window.confirm(`¿Retirar “${product.name}” de la venta? Dejará de aparecer para la IA, pero se conservará su historial.${sourceWarning}`)) return;
        setLoading(true); setNotice(null);
        try {
            const response = await fetch(`/api/inventory/${product.id}`, { method: "DELETE" });
            if (!response.ok) throw new Error(await readError(response));
            setProducts((current) => current.filter((item) => item.id !== product.id));
            setNotice(synchronized
                ? "Producto retirado. Elimínalo o márcalo inactivo también en su fuente externa para que la sincronización no lo reactive."
                : "Producto retirado de la venta. Su historial se conservó.");
        } catch (error) { setNotice(error instanceof Error ? error.message : "No se pudo retirar el producto."); }
        finally { setLoading(false); }
    }

    function openNewSource() {
        setEditingSource(null); setSourceForm(blankSourceForm); setNotice(null); setSourceOpen(true);
    }

    function openEditSource(source: Source) {
        setEditingSource(source);
        setSourceForm({ name: source.name, type: source.type, sourceUri: source.sourceUri || "", isActive: source.isActive });
        setNotice(null); setSourceOpen(true);
    }

    async function setSourceActive(source: Source, isActive: boolean) {
        setLoading(true); setNotice(null);
        try {
            const response = await fetch("/api/inventory/sources", {
                method: "POST", headers: { "content-type": "application/json" },
                body: JSON.stringify({ id: source.id, name: source.name, type: source.type, sourceUri: source.sourceUri, isActive }),
            });
            if (!response.ok) throw new Error(await readError(response));
            const { source: updated } = await response.json() as { source: Source };
            setSources((current) => current.map((item) => item.id === updated.id ? updated : item));
            setNotice(isActive ? "Fuente activada." : "Fuente pausada. El CRM rechazará nuevas sincronizaciones hasta que la reactives.");
        } catch (error) { setNotice(error instanceof Error ? error.message : "No se pudo cambiar el estado de la fuente."); }
        finally { setLoading(false); }
    }

    async function removeSource(source: Source) {
        if (!window.confirm(`¿Eliminar la fuente “${source.name}”? Los productos y el historial se conservarán, pero su ID dejará de funcionar en n8n.`)) return;
        setLoading(true); setNotice(null);
        try {
            const response = await fetch(`/api/inventory/sources/${source.id}`, { method: "DELETE" });
            if (!response.ok) throw new Error(await readError(response));
            setSources((current) => current.filter((item) => item.id !== source.id));
            setNotice("Fuente eliminada. Los productos y el historial se conservaron; desactiva o actualiza su workflow en n8n.");
        } catch (error) { setNotice(error instanceof Error ? error.message : "No se pudo eliminar la fuente."); }
        finally { setLoading(false); }
    }

    return <div className="mx-auto w-full max-w-[1500px] space-y-5 pb-8">
        <section className="rounded-2xl border border-border bg-card p-5 shadow-soft">
            <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                <div>
                    <div className="flex items-center gap-2"><Boxes className="h-5 w-5 text-primary" /><h2 className="text-xl font-semibold">Inventario operativo</h2></div>
                    <p className="mt-1 max-w-3xl text-sm text-muted-foreground">Precio y existencia verificados para el equipo y para las respuestas de IA. La IA consulta estos datos antes que la base de conocimientos.</p>
                </div>
                <div className="flex flex-wrap gap-2">
                    <input ref={fileRef} type="file" accept=".csv,text/csv" className="hidden" onChange={importCsv} />
                    <Button asChild variant="outline"><a href="/examples/inventario-ejemplo.csv" download><Download /> CSV de ejemplo</a></Button>
                    <Button type="button" variant="outline" onClick={() => fileRef.current?.click()} disabled={loading}><FileUp /> Importar CSV</Button>
                    <Button type="button" variant="outline" onClick={prepareSemanticSearch} disabled={loading}><Sparkles /> Preparar RAG</Button>
                    {canManageSources ? <Button type="button" variant="outline" onClick={openNewSource}>Configurar fuente</Button> : null}
                    <Button type="button" onClick={openNewProduct}><PackagePlus /> Añadir producto</Button>
                </div>
            </div>
            {notice ? <p className="mt-4 rounded-lg border border-border bg-secondary/45 px-3 py-2 text-sm">{notice}</p> : null}
        </section>

        <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {[{ label: "Productos activos", value: stats.products, icon: Box }, { label: "Unidades disponibles", value: stats.unitsAvailable, icon: Boxes }, { label: "Stock bajo", value: stats.lowStock, icon: AlertTriangle }, { label: "Agotados", value: stats.outOfStock, icon: AlertTriangle }].map((card) => <div key={card.label} className="rounded-2xl border border-border bg-card p-4 shadow-soft"><div className="flex items-center justify-between text-muted-foreground"><span className="text-sm">{card.label}</span><card.icon className="h-4 w-4" /></div><p className="mt-2 text-2xl font-semibold">{card.value.toLocaleString("es-MX", { maximumFractionDigits: 3 })}</p></div>)}
        </section>

        <section className="rounded-2xl border border-border bg-card shadow-soft">
            <div className="flex flex-col gap-3 border-b border-border p-4 lg:flex-row lg:items-center">
                <form onSubmit={search} className="flex flex-1 gap-2"><Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Busca por SKU, nombre, marca o etiqueta" /><Button type="submit" variant="outline" disabled={loading}><Search /> Buscar</Button></form>
                <Select value={status} onValueChange={setStatus}><SelectTrigger className="w-full lg:w-[170px]"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">Todo el stock</SelectItem><SelectItem value="available">Disponible</SelectItem><SelectItem value="low">Stock bajo</SelectItem><SelectItem value="out">Agotado</SelectItem></SelectContent></Select>
            </div>
            <div className="overflow-x-auto"><Table><TableHeader><TableRow><TableHead>Producto</TableHead><TableHead>SKU</TableHead><TableHead>Precio venta</TableHead><TableHead>Disponible</TableHead><TableHead>Estado</TableHead><TableHead className="text-right">Acciones</TableHead></TableRow></TableHeader><TableBody>
                {visibleProducts.map((product) => <TableRow key={product.id}><TableCell><div className="font-medium">{product.name}</div><div className="text-xs text-muted-foreground">{product.category?.name || "Sin categoría"}</div></TableCell><TableCell className="font-mono text-xs">{product.sku}</TableCell><TableCell><div>{priceLabel(product)}</div>{product.priceTiers.length ? <div className="text-xs text-muted-foreground">Según cantidad · {product.priceTiers.length} rangos</div> : null}</TableCell><TableCell>{product.available.toLocaleString("es-MX", { maximumFractionDigits: 3 })} {product.unit}</TableCell><TableCell><Badge variant={product.stockStatus === "available" ? "secondary" : product.stockStatus === "low" ? "outline" : "destructive"}>{statusLabel(product.stockStatus)}</Badge></TableCell><TableCell className="text-right"><Button size="sm" variant="ghost" onClick={() => { setAdjusting(product); setNextOnHand(String(product.locations[0]?.onHand ?? product.onHand)); setReason(""); }}>Ajustar</Button><Button size="icon-xs" variant="ghost" onClick={() => openEditProduct(product)} aria-label={`Editar ${product.name}`}><Pencil /></Button><Button size="icon-xs" variant="ghost" className="text-destructive hover:text-destructive" onClick={() => removeProduct(product)} disabled={loading} aria-label={`Retirar ${product.name}`} title="Retirar producto"><Trash2 /></Button></TableCell></TableRow>)}
                {visibleProducts.length === 0 ? <TableRow><TableCell colSpan={6} className="py-10 text-center text-sm text-muted-foreground">No hay productos que coincidan con el filtro.</TableCell></TableRow> : null}
            </TableBody></Table></div>
        </section>

        <section className="rounded-2xl border border-border bg-card p-4 shadow-soft">
            <div className="flex items-center justify-between gap-3"><div><h3 className="font-semibold">Fuentes registradas</h3><p className="mt-1 text-xs text-muted-foreground">Administra la conexión sin borrar los productos ni su historial.</p></div>{canManageSources ? <Button type="button" size="sm" variant="outline" onClick={openNewSource}><Plus /> Nueva fuente</Button> : null}</div>
            {sources.length ? <div className="mt-3 space-y-2">{sources.map((source) => <div key={source.id} className="flex flex-col gap-3 rounded-lg border border-border px-3 py-3 text-sm sm:flex-row sm:items-center sm:justify-between"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><span className="font-medium">{source.name}</span><Badge variant={source.lastError ? "destructive" : source.isActive ? "secondary" : "outline"}>{source.lastError ? "Error" : source.isActive ? "Activa" : "Pausada"}</Badge></div><p className="mt-1 break-all text-xs text-muted-foreground">{source.type} · ID {source.id}</p>{source.sourceUri ? <p className="mt-1 truncate text-xs text-muted-foreground">{source.sourceUri}</p> : null}{source.lastError ? <p className="mt-1 text-xs text-destructive">{source.lastError}</p> : null}</div>{canManageSources ? <div className="flex shrink-0 flex-wrap gap-2"><Button type="button" size="sm" variant="outline" onClick={() => openEditSource(source)} disabled={loading}><Pencil /> Editar</Button><Button type="button" size="sm" variant="outline" onClick={() => setSourceActive(source, !source.isActive)} disabled={loading}>{source.isActive ? <PowerOff /> : <Power />}{source.isActive ? "Pausar" : "Activar"}</Button><Button type="button" size="icon-sm" variant="ghost" className="text-destructive hover:text-destructive" onClick={() => removeSource(source)} disabled={loading} aria-label={`Eliminar ${source.name}`}><Trash2 /></Button></div> : null}</div>)}</div> : <p className="mt-3 text-sm text-muted-foreground">{canManageSources ? "Registra una fuente para usar su ID al configurar n8n." : "Las fuentes solo las puede registrar un Super Admin."}</p>}
        </section>

        <Dialog open={formOpen} onOpenChange={setFormOpen}><DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl"><DialogHeader><DialogTitle>{editing ? "Editar producto" : "Añadir producto"}</DialogTitle><DialogDescription>Usa un precio fijo o agrega rangos por cantidad. Los rangos se validan para evitar traslapes y cotizaciones incorrectas.</DialogDescription></DialogHeader><form onSubmit={saveProduct} className="grid gap-4 sm:grid-cols-2"><Field label="SKU" value={form.sku} onChange={(value) => setForm({ ...form, sku: value })} required /><Field label="Nombre" value={form.name} onChange={(value) => setForm({ ...form, name: value })} required /><Field label="Categoría" value={form.category} onChange={(value) => setForm({ ...form, category: value })} list="inventory-categories" /><datalist id="inventory-categories">{categories.map((category) => <option key={category.id} value={category.name} />)}</datalist><Field label="Unidad" value={form.unit} onChange={(value) => setForm({ ...form, unit: value })} /><Field label="Precio fijo (MXN, opcional)" value={form.salePrice} onChange={(value) => setForm({ ...form, salePrice: value })} inputMode="decimal" required={form.priceTiers.length === 0} /><Field label="Existencia física" value={form.onHand} onChange={(value) => setForm({ ...form, onHand: value })} inputMode="decimal" required /><Field label="Stock mínimo" value={form.minimumStock} onChange={(value) => setForm({ ...form, minimumStock: value })} inputMode="decimal" required /><Field label="Etiquetas" value={form.tags} onChange={(value) => setForm({ ...form, tags: value })} placeholder="ej. rojo, oferta, 128gb" />
            <div className="space-y-3 rounded-xl border border-border bg-secondary/20 p-4 sm:col-span-2"><div className="flex items-start justify-between gap-3"><div><Label>Precios por cantidad</Label><p className="mt-1 text-xs text-muted-foreground">La cantidad máxima vacía significa “en adelante”. La IA calculará el subtotal con el rango exacto.</p></div><Button type="button" size="sm" variant="outline" onClick={() => setForm({ ...form, priceTiers: [...form.priceTiers, { minQuantity: "", maxQuantity: "", unitPrice: "" }] })}><Plus /> Agregar rango</Button></div>{form.priceTiers.length ? <div className="space-y-2">{form.priceTiers.map((tier, index) => <div key={index} className="grid grid-cols-[1fr_1fr_1fr_auto] items-end gap-2"><Field label={index === 0 ? "Desde" : ""} value={tier.minQuantity} onChange={(value) => setForm({ ...form, priceTiers: form.priceTiers.map((entry, position) => position === index ? { ...entry, minQuantity: value } : entry) })} inputMode="numeric" required /><Field label={index === 0 ? "Hasta" : ""} value={tier.maxQuantity} onChange={(value) => setForm({ ...form, priceTiers: form.priceTiers.map((entry, position) => position === index ? { ...entry, maxQuantity: value } : entry) })} inputMode="numeric" placeholder="Sin límite" /><Field label={index === 0 ? "Precio c/u" : ""} value={tier.unitPrice} onChange={(value) => setForm({ ...form, priceTiers: form.priceTiers.map((entry, position) => position === index ? { ...entry, unitPrice: value } : entry) })} inputMode="decimal" required /><Button type="button" size="icon" variant="ghost" className="text-destructive" onClick={() => setForm({ ...form, priceTiers: form.priceTiers.filter((_, position) => position !== index) })} aria-label={`Eliminar rango ${index + 1}`}><Trash2 /></Button></div>)}</div> : <p className="text-sm text-muted-foreground">Sin rangos: se usará el precio fijo.</p>}</div>
            <div className="sm:col-span-2"><Label htmlFor="inventory-description">Descripción</Label><Textarea id="inventory-description" value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} className="mt-1" /></div><DialogFooter className="sm:col-span-2"><Button type="submit" disabled={loading}>{loading ? <Loader2 className="animate-spin" /> : null} Guardar producto</Button></DialogFooter></form></DialogContent></Dialog>

        <Dialog open={Boolean(adjusting)} onOpenChange={(open) => { if (!open) setAdjusting(null); }}><DialogContent><DialogHeader><DialogTitle>Ajustar existencia</DialogTitle><DialogDescription>{adjusting?.name}. Se conservará un historial con la razón del cambio.</DialogDescription></DialogHeader><form onSubmit={saveAdjustment} className="space-y-4"><Field label="Nueva existencia física" value={nextOnHand} onChange={setNextOnHand} inputMode="decimal" required /><div><Label htmlFor="adjust-reason">Motivo</Label><Textarea id="adjust-reason" value={reason} onChange={(event) => setReason(event.target.value)} className="mt-1" placeholder="Conteo físico, merma, entrada…" /></div><DialogFooter><Button type="submit" disabled={loading}>{loading ? <Loader2 className="animate-spin" /> : <RefreshCw />} Confirmar ajuste</Button></DialogFooter></form></DialogContent></Dialog>

        <Dialog open={sourceOpen} onOpenChange={(open) => { setSourceOpen(open); if (!open) { setEditingSource(null); setSourceForm(blankSourceForm); } }}><DialogContent><DialogHeader><DialogTitle>{editingSource ? "Editar fuente de sincronización" : "Registrar fuente de sincronización"}</DialogTitle><DialogDescription>La fuente guarda su ubicación y estado; las credenciales permanecen en n8n.</DialogDescription></DialogHeader><form onSubmit={saveSource} className="space-y-4"><Field label="Nombre de la fuente" value={sourceForm.name} onChange={(name) => setSourceForm({ ...sourceForm, name })} required /><div><Label htmlFor="source-type">Tipo</Label><Select value={sourceForm.type} onValueChange={(type) => setSourceForm({ ...sourceForm, type })}><SelectTrigger id="source-type" className="mt-1"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="google_sheets">Google Sheets</SelectItem><SelectItem value="google_drive_xlsx">Google Drive XLSX</SelectItem><SelectItem value="pos_api">API de punto de venta</SelectItem></SelectContent></Select></div><Field label="URL o referencia" value={sourceForm.sourceUri} onChange={(sourceUri) => setSourceForm({ ...sourceForm, sourceUri })} placeholder="https://…" /><div><Label htmlFor="source-status">Estado</Label><Select value={sourceForm.isActive ? "active" : "paused"} onValueChange={(value) => setSourceForm({ ...sourceForm, isActive: value === "active" })}><SelectTrigger id="source-status" className="mt-1"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="active">Activa</SelectItem><SelectItem value="paused">Pausada</SelectItem></SelectContent></Select></div><DialogFooter><Button type="submit" disabled={loading}>{loading ? <Loader2 className="animate-spin" /> : null}{editingSource ? "Guardar cambios" : "Registrar fuente"}</Button></DialogFooter></form></DialogContent></Dialog>
    </div>;
}

function Field({ label, value, onChange, required, inputMode, placeholder, list }: { label: string; value: string; onChange: (value: string) => void; required?: boolean; inputMode?: "text" | "decimal" | "numeric"; placeholder?: string; list?: string }) {
    const id = `inventory-${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
    return <div><Label htmlFor={id}>{label}</Label><Input id={id} value={value} onChange={(event) => onChange(event.target.value)} required={required} inputMode={inputMode} placeholder={placeholder} list={list} className="mt-1" /></div>;
}
