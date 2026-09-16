import { authenticate } from "../shopify.server";
import { autoFulfillOrder } from "../lib/fulfillment-cleanup.server";

function envEnabled(name, defaultValue = false) {
  const value = process.env[name];

  if (value == null || value === "") {
    return defaultValue;
  }

  return ["1", "true", "yes", "on"].includes(
    String(value).trim().toLowerCase()
  );
}

function orderGidFromPayload(payload) {
  if (payload?.admin_graphql_api_id) {
    return payload.admin_graphql_api_id;
  }

  if (payload?.id) {
    return `gid://shopify/Order/${payload.id}`;
  }

  return null;
}

export const action = async ({ request }) => {
  const {
    admin,
    payload,
    session,
    shop,
    topic,
  } = await authenticate.webhook(request);

  console.log(
    `[auto-fulfill] Received ${topic} for ${shop}`
  );

  // Safety switch: deploy first, then explicitly enable in Render.
  if (!envEnabled("AUTO_FULFILL_ENABLED", false)) {
    console.log(
      "[auto-fulfill] Disabled by AUTO_FULFILL_ENABLED."
    );
    return new Response();
  }

  // Shopify can deliver webhooks after uninstall; in that case no Admin API
  // client/session is available and there is nothing safe to process.
  if (!session || !admin) {
    console.warn(
      "[auto-fulfill] No active session/admin client; skipping."
    );
    return new Response();
  }

  const orderId =
    orderGidFromPayload(payload);

  if (!orderId) {
    console.error(
      "[auto-fulfill] Webhook payload did not contain an order ID."
    );
    return new Response();
  }

  const includeNavidium =
    envEnabled(
      "AUTO_FULFILL_NAVIDIUM",
      true
    );

  const includeDropship =
    envEnabled(
      "AUTO_FULFILL_DROPSHIP",
      true
    );

  try {
    const result =
      await autoFulfillOrder(
        admin,
        orderId,
        {
          includeNavidium,
          includeDropship,
        }
      );

    console.log(
      `[auto-fulfill] ${result.order.name}: ` +
        `${result.summary.fulfilled} fulfilled, ` +
        `${result.summary.skipped} skipped, ` +
        `${result.summary.errors} errors, ` +
        `${result.summary.exceptions} exceptions.`
    );

    for (const item of result.results) {
      console.log(
        `[auto-fulfill] ${result.order.name} ${item.sku}: ` +
          `${item.result} - ${item.message}`
      );
    }

    for (const item of result.exceptions) {
      console.warn(
        `[auto-fulfill] ${result.order.name} ${item.sku}: ` +
          `not actionable (FO ${item.fulfillmentOrderStatus}, ` +
          `remaining ${item.remainingQuantity}, ` +
          `fulfillable ${item.fulfillableQuantity}).`
      );
    }
  } catch (error) {
    // Return 200 so Shopify does not repeatedly retry a fulfillment that may
    // already have partially succeeded. The error remains visible in Render.
    console.error(
      `[auto-fulfill] Failed for ${orderId}:`,
      error
    );
  }

  return new Response();
};
