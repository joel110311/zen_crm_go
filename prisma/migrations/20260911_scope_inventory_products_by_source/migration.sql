ALTER TABLE "InventoryProduct"
ADD COLUMN "inventorySourceId" TEXT;

ALTER TABLE "InventoryProduct"
ADD CONSTRAINT "InventoryProduct_inventorySourceId_fkey"
FOREIGN KEY ("inventorySourceId") REFERENCES "InventorySource"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "InventoryProduct_inventorySourceId_isActive_idx"
ON "InventoryProduct"("inventorySourceId", "isActive");

-- Safely attribute legacy synchronized products when only one registered source
-- exists for their source type. Ambiguous legacy rows remain unassigned.
UPDATE "InventoryProduct" AS product
SET "inventorySourceId" = source.id
FROM "InventorySource" AS source
WHERE product.source = source.type
  AND product.source <> 'manual'
  AND (
      SELECT COUNT(*)
      FROM "InventorySource" AS candidate
      WHERE candidate.type = product.source
  ) = 1;
