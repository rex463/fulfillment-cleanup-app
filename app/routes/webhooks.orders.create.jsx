import { authenticate } from "../shopify.server";
import { autoFulfillOrder } from "../lib/fulfillment-cleanup.server";
import { getAutoFulfillSettings, recordAutoFulfillRun } from "../lib/auto-fulfill-settings.server";

function orderGidFromPayload(payload) {
  if (payload?.admin_graphql_api_id) return payload.admin_graphql_api_id;
  if (payload?.id) return `gid://shopify/Order/${payload.id}`;
  return null;
}

export const action = async ({ request }) => {
  const { admin, payload, session, shop, topic } = await authenticate.webhook(request);
  console.log(`[auto-fulfill] Received ${topic} for ${shop}`);

  if (!session || !admin) {
    console.warn("[auto-fulfill] No active session/admin client; skipping.");
    return new Response();
  }

  const settings = await getAutoFulfillSettings(shop);
  if (!settings.enabled) {
    console.log("[auto-fulfill] Disabled in app settings.");
    return new Response();
  }

  const orderId = orderGidFromPayload(payload);
  const orderName = payload?.name || null;

  if (!orderId) {
    console.error("[auto-fulfill] Webhook payload did not contain an order ID.");
    await recordAutoFulfillRun({
      shop, orderName, status: "ERROR", message: "Webhook payload did not contain an order ID.", errors: 1,
    });
    return new Response();
  }

  try {
    const result = await autoFulfillOrder(admin, orderId, {
      includeNavidium: settings.includeNavidium,
      includeDropship: settings.includeDropship,
    });

    const status = result.summary.errors > 0 ? "ERROR" : result.summary.fulfilled > 0 ? "SUCCESS" : "NO_MATCH";
    const message = result.summary.fulfilled > 0
      ? `${result.summary.fulfilled} target line item(s) fulfilled.`
      : "No actionable target line items found.";

    await recordAutoFulfillRun({
      shop,
      orderId,
      orderName: result.order.name,
      status,
      fulfilled: result.summary.fulfilled,
      skipped: result.summary.skipped,
      errors: result.summary.errors,
      exceptions: result.summary.exceptions,
      message,
    });

    console.log(`[auto-fulfill] ${result.order.name}: ${result.summary.fulfilled} fulfilled, ${result.summary.skipped} skipped, ${result.summary.errors} errors, ${result.summary.exceptions} exceptions.`);

    for (const item of result.results) {
      console.log(`[auto-fulfill] ${result.order.name} ${item.sku}: ${item.result} - ${item.message}`);
    }
    for (const item of result.exceptions) {
      console.warn(`[auto-fulfill] ${result.order.name} ${item.sku}: not actionable (FO ${item.fulfillmentOrderStatus}, remaining ${item.remainingQuantity}, fulfillable ${item.fulfillableQuantity}).`);
    }
  } catch (error) {
    console.error(`[auto-fulfill] Failed for ${orderId}:`, error);
    await recordAutoFulfillRun({
      shop, orderId, orderName, status: "ERROR", errors: 1, message: error?.message || "Unknown automation error",
    });
  }

  return new Response();
};
