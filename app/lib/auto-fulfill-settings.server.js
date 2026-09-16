import db from "../db.server";

function envEnabled(name, defaultValue = false) {
  const value = process.env[name];
  if (value == null || value === "") return defaultValue;
  return ["1", "true", "yes", "on"].includes(String(value).trim().toLowerCase());
}

export async function getAutoFulfillSettings(shop) {
  const saved = await db.autoFulfillSettings.findUnique({ where: { shop } });
  if (saved) return saved;

  // Safe fallback for the first deploy: disabled unless explicitly enabled by env.
  return {
    shop,
    enabled: envEnabled("AUTO_FULFILL_ENABLED", false),
    includeNavidium: envEnabled("AUTO_FULFILL_NAVIDIUM", true),
    includeDropship: envEnabled("AUTO_FULFILL_DROPSHIP", true),
    lastRunAt: null,
    lastOrderName: null,
    lastStatus: null,
  };
}

export async function saveAutoFulfillSettings(shop, values) {
  return db.autoFulfillSettings.upsert({
    where: { shop },
    create: { shop, ...values },
    update: values,
  });
}

export async function recordAutoFulfillRun({
  shop,
  orderId = null,
  orderName = null,
  status,
  fulfilled = 0,
  skipped = 0,
  errors = 0,
  exceptions = 0,
  message = null,
}) {
  const now = new Date();

  await db.$transaction([
    db.autoFulfillLog.create({
      data: {
        shop, orderId, orderName, status, fulfilled, skipped, errors, exceptions, message,
      },
    }),
    db.autoFulfillSettings.upsert({
      where: { shop },
      create: {
        shop,
        enabled: envEnabled("AUTO_FULFILL_ENABLED", false),
        includeNavidium: envEnabled("AUTO_FULFILL_NAVIDIUM", true),
        includeDropship: envEnabled("AUTO_FULFILL_DROPSHIP", true),
        lastRunAt: now,
        lastOrderName: orderName,
        lastStatus: status,
      },
      update: {
        lastRunAt: now,
        lastOrderName: orderName,
        lastStatus: status,
      },
    }),
  ]);
}

export async function getRecentAutoFulfillLogs(shop, take = 20) {
  return db.autoFulfillLog.findMany({
    where: { shop },
    orderBy: { createdAt: "desc" },
    take,
  });
}
