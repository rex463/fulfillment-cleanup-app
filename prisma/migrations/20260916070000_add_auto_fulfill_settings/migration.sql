-- CreateTable
CREATE TABLE "AutoFulfillSettings" (
    "shop" TEXT NOT NULL PRIMARY KEY,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "includeNavidium" BOOLEAN NOT NULL DEFAULT true,
    "includeDropship" BOOLEAN NOT NULL DEFAULT true,
    "lastRunAt" DATETIME,
    "lastOrderName" TEXT,
    "lastStatus" TEXT,
    "updatedAt" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "AutoFulfillLog" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "shop" TEXT NOT NULL,
    "orderId" TEXT,
    "orderName" TEXT,
    "status" TEXT NOT NULL,
    "fulfilled" INTEGER NOT NULL DEFAULT 0,
    "skipped" INTEGER NOT NULL DEFAULT 0,
    "errors" INTEGER NOT NULL DEFAULT 0,
    "exceptions" INTEGER NOT NULL DEFAULT 0,
    "message" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE INDEX "AutoFulfillLog_shop_createdAt_idx" ON "AutoFulfillLog"("shop", "createdAt");
