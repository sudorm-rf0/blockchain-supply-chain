-- CreateTable
CREATE TABLE "supply_chain_suppliers" (
    "id" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "pda" TEXT NOT NULL,
    "authorizedAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "supply_chain_suppliers_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "supply_chain_suppliers_address_key" ON "supply_chain_suppliers"("address");

-- CreateIndex
CREATE UNIQUE INDEX "supply_chain_suppliers_pda_key" ON "supply_chain_suppliers"("pda");

-- CreateIndex
CREATE INDEX "supply_chain_suppliers_revokedAt_idx" ON "supply_chain_suppliers"("revokedAt");

-- CreateTable
CREATE TABLE "supply_chain_products" (
    "id" TEXT NOT NULL,
    "owner" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "units" BIGINT NOT NULL,
    "pda" TEXT NOT NULL,
    "txSignature" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "supply_chain_products_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "supply_chain_products_pda_key" ON "supply_chain_products"("pda");

-- CreateIndex
CREATE UNIQUE INDEX "supply_chain_products_owner_sku_key" ON "supply_chain_products"("owner", "sku");

-- CreateIndex
CREATE INDEX "supply_chain_products_owner_idx" ON "supply_chain_products"("owner");
