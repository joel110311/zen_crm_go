-- Inventory is additive: existing channels, conversations and orders remain untouched.
CREATE TABLE "InventoryCategory" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "color" TEXT DEFAULT '#64748B',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "InventoryCategory_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "InventoryLocation" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "InventoryLocation_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "InventorySource" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'manual',
    "name" TEXT NOT NULL,
    "sourceUri" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastSyncAt" TIMESTAMP(3),
    "lastSuccessfulSyncAt" TIMESTAMP(3),
    "lastError" TEXT,
    "config" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "InventorySource_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "InventoryProduct" (
    "id" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "brand" TEXT,
    "categoryId" TEXT,
    "unit" TEXT NOT NULL DEFAULT 'pieza',
    "salePrice" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "internalCost" DECIMAL(12,2),
    "tags" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "imageUrl" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "source" TEXT NOT NULL DEFAULT 'manual',
    "sourceHash" TEXT,
    "embeddingHash" TEXT,
    "embedding" vector(1536),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "InventoryProduct_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "InventoryStock" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "onHand" DECIMAL(14,3) NOT NULL DEFAULT 0,
    "reserved" DECIMAL(14,3) NOT NULL DEFAULT 0,
    "minimumStock" DECIMAL(14,3) NOT NULL DEFAULT 0,
    "sourceUpdatedAt" TIMESTAMP(3),
    "syncedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "InventoryStock_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "InventoryAdjustment" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "locationId" TEXT,
    "previousOnHand" DECIMAL(14,3) NOT NULL,
    "nextOnHand" DECIMAL(14,3) NOT NULL,
    "delta" DECIMAL(14,3) NOT NULL,
    "reason" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'manual',
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "InventoryAdjustment_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "InventorySyncRun" (
    "id" TEXT NOT NULL,
    "sourceId" TEXT,
    "mode" TEXT NOT NULL DEFAULT 'incremental',
    "status" TEXT NOT NULL DEFAULT 'staging',
    "idempotencyKey" TEXT,
    "receivedCount" INTEGER NOT NULL DEFAULT 0,
    "insertedCount" INTEGER NOT NULL DEFAULT 0,
    "updatedCount" INTEGER NOT NULL DEFAULT 0,
    "unchangedCount" INTEGER NOT NULL DEFAULT 0,
    "deactivatedCount" INTEGER NOT NULL DEFAULT 0,
    "errorCount" INTEGER NOT NULL DEFAULT 0,
    "errorSummary" JSONB,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    CONSTRAINT "InventorySyncRun_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "InventorySyncStage" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "locationName" TEXT NOT NULL DEFAULT 'Principal',
    "payload" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "InventorySyncStage_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "CustomerOrderItem" ADD COLUMN "productId" TEXT;

CREATE UNIQUE INDEX "InventoryCategory_name_key" ON "InventoryCategory"("name");
CREATE INDEX "InventoryCategory_isActive_sortOrder_idx" ON "InventoryCategory"("isActive", "sortOrder");
CREATE UNIQUE INDEX "InventoryLocation_name_key" ON "InventoryLocation"("name");
CREATE INDEX "InventoryLocation_isActive_isDefault_idx" ON "InventoryLocation"("isActive", "isDefault");
CREATE INDEX "InventorySource_type_isActive_idx" ON "InventorySource"("type", "isActive");
CREATE UNIQUE INDEX "InventoryProduct_sku_key" ON "InventoryProduct"("sku");
CREATE INDEX "InventoryProduct_categoryId_isActive_idx" ON "InventoryProduct"("categoryId", "isActive");
CREATE INDEX "InventoryProduct_isActive_updatedAt_idx" ON "InventoryProduct"("isActive", "updatedAt" DESC);
CREATE INDEX "InventoryProduct_brand_idx" ON "InventoryProduct"("brand");
CREATE UNIQUE INDEX "InventoryStock_productId_locationId_key" ON "InventoryStock"("productId", "locationId");
CREATE INDEX "InventoryStock_locationId_updatedAt_idx" ON "InventoryStock"("locationId", "updatedAt" DESC);
CREATE INDEX "InventoryAdjustment_productId_createdAt_idx" ON "InventoryAdjustment"("productId", "createdAt" DESC);
CREATE INDEX "InventoryAdjustment_locationId_createdAt_idx" ON "InventoryAdjustment"("locationId", "createdAt" DESC);
CREATE UNIQUE INDEX "InventorySyncRun_idempotencyKey_key" ON "InventorySyncRun"("idempotencyKey");
CREATE INDEX "InventorySyncRun_status_startedAt_idx" ON "InventorySyncRun"("status", "startedAt" DESC);
CREATE INDEX "InventorySyncRun_sourceId_startedAt_idx" ON "InventorySyncRun"("sourceId", "startedAt" DESC);
CREATE UNIQUE INDEX "InventorySyncStage_runId_sku_locationName_key" ON "InventorySyncStage"("runId", "sku", "locationName");
CREATE INDEX "InventorySyncStage_runId_idx" ON "InventorySyncStage"("runId");
CREATE INDEX "CustomerOrderItem_productId_idx" ON "CustomerOrderItem"("productId");

ALTER TABLE "InventoryProduct" ADD CONSTRAINT "InventoryProduct_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "InventoryCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "InventoryStock" ADD CONSTRAINT "InventoryStock_productId_fkey" FOREIGN KEY ("productId") REFERENCES "InventoryProduct"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "InventoryStock" ADD CONSTRAINT "InventoryStock_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "InventoryLocation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "InventoryAdjustment" ADD CONSTRAINT "InventoryAdjustment_productId_fkey" FOREIGN KEY ("productId") REFERENCES "InventoryProduct"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "InventorySyncRun" ADD CONSTRAINT "InventorySyncRun_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "InventorySource"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "InventorySyncStage" ADD CONSTRAINT "InventorySyncStage_runId_fkey" FOREIGN KEY ("runId") REFERENCES "InventorySyncRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CustomerOrderItem" ADD CONSTRAINT "CustomerOrderItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "InventoryProduct"("id") ON DELETE SET NULL ON UPDATE CASCADE;
