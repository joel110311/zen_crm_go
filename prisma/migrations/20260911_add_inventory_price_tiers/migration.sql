CREATE TABLE "InventoryPriceTier" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "minQuantity" INTEGER NOT NULL,
    "maxQuantity" INTEGER,
    "unitPrice" DECIMAL(12,2) NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InventoryPriceTier_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "InventoryPriceTier_productId_minQuantity_key"
ON "InventoryPriceTier"("productId", "minQuantity");

CREATE INDEX "InventoryPriceTier_productId_sortOrder_idx"
ON "InventoryPriceTier"("productId", "sortOrder");

ALTER TABLE "InventoryPriceTier"
ADD CONSTRAINT "InventoryPriceTier_productId_fkey"
FOREIGN KEY ("productId") REFERENCES "InventoryProduct"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Conserva la tabla de precios que el negocio ya usa para GlowSync. Si el
-- producto todavía no existe, podrá configurarse después desde Inventario.
INSERT INTO "InventoryPriceTier" ("id", "productId", "minQuantity", "maxQuantity", "unitPrice", "sortOrder", "createdAt", "updatedAt")
SELECT CONCAT('tier_', MD5(p."id" || ':' || tier.min_quantity::text)), p."id", tier.min_quantity, tier.max_quantity, tier.unit_price, tier.sort_order, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "InventoryProduct" p
CROSS JOIN (VALUES
  (100, 150, 70.00, 0),
  (151, 200, 67.00, 1),
  (201, 250, 64.00, 2),
  (251, 500, 61.00, 3),
  (501, 1000, 58.00, 4),
  (1001, NULL, 55.00, 5)
) AS tier(min_quantity, max_quantity, unit_price, sort_order)
WHERE LOWER(p."name") LIKE '%glowsync%'
ON CONFLICT ("productId", "minQuantity") DO UPDATE SET
  "maxQuantity" = EXCLUDED."maxQuantity",
  "unitPrice" = EXCLUDED."unitPrice",
  "sortOrder" = EXCLUDED."sortOrder",
  "updatedAt" = CURRENT_TIMESTAMP;

UPDATE "InventoryProduct"
SET "salePrice" = 70.00, "updatedAt" = CURRENT_TIMESTAMP
WHERE LOWER("name") LIKE '%glowsync%';
