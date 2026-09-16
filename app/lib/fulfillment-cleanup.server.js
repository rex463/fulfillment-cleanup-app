import crypto from "node:crypto";

// ======================================================
// TARGET SKU RULES
// ======================================================

const APPROVED_DROPSHIP_SKUS = new Set([
  "DROP-SHIP-FEE",
  "DROP-SHIP-FEE-5",
  "DROP-SHIP-FEE-10",
  "DROP-SHIP-FEE-20",
]);

export function classifySku(rawSku = "") {
  const sku = String(rawSku)
    .trim()
    .toUpperCase();

  if (sku.startsWith("NVDPROTECTION")) {
    return "NAVIDIUM";
  }

  if (APPROVED_DROPSHIP_SKUS.has(sku)) {
    return "DROPSHIP";
  }

  return null;
}


// ======================================================
// SCAN A SINGLE ORDER (AUTOMATION)
// ======================================================

export async function scanOrderTargets(
  admin,
  orderId,
  {
    includeNavidium = true,
    includeDropship = true,
  } = {}
) {
  const eligible = [];
  const exceptions = [];

  const response =
    await admin.graphql(
      `#graphql
        query ScanCleanupOrder(
          $id: ID!
        ) {
          order(id: $id) {
            id
            name
            createdAt

            fulfillmentOrders(first: 25) {
              nodes {
                id
                status

                lineItems(first: 100) {
                  nodes {
                    id
                    remainingQuantity

                    lineItem {
                      id
                      name
                      sku
                      currentQuantity
                      fulfillableQuantity
                    }
                  }
                }
              }
            }
          }
        }
      `,
      {
        variables: {
          id: orderId,
        },
      }
    );

  const json =
    await response.json();

  if (json.errors) {
    throw new Error(
      JSON.stringify(json.errors)
    );
  }

  const order =
    json.data?.order;

  if (!order) {
    throw new Error(
      `Order not found: ${orderId}`
    );
  }

  for (
    const fo
    of order.fulfillmentOrders.nodes
  ) {
    for (
      const item
      of fo.lineItems.nodes
    ) {
      const sku =
        item.lineItem?.sku || "";

      const type =
        classifySku(sku);

      if (!type) {
        continue;
      }

      if (
        type === "NAVIDIUM" &&
        !includeNavidium
      ) {
        continue;
      }

      if (
        type === "DROPSHIP" &&
        !includeDropship
      ) {
        continue;
      }

      if (
        item.remainingQuantity <= 0
      ) {
        continue;
      }

      const record = {
        type,
        orderId: order.id,
        orderName: order.name,
        createdAt: order.createdAt,
        fulfillmentOrderId: fo.id,
        fulfillmentOrderStatus:
          fo.status,
        fulfillmentLineItemId:
          item.id,
        itemName:
          item.lineItem?.name || "",
        sku,
        remainingQuantity:
          item.remainingQuantity,
        currentQuantity:
          item.lineItem
            ?.currentQuantity ?? 0,
        fulfillableQuantity:
          item.lineItem
            ?.fulfillableQuantity ?? 0,
      };

      const actionableStatus =
        fo.status === "OPEN" ||
        fo.status === "IN_PROGRESS";

      const actionableQuantity =
        record.currentQuantity > 0 &&
        record.fulfillableQuantity > 0;

      if (
        actionableStatus &&
        actionableQuantity
      ) {
        eligible.push({
          ...record,
          classification: "ELIGIBLE",
        });
      } else {
        exceptions.push({
          ...record,
          classification:
            "AUTOMATION_EXCEPTION",
        });
      }
    }
  }

  return {
    order: {
      id: order.id,
      name: order.name,
      createdAt: order.createdAt,
    },
    eligible,
    exceptions,
  };
}

// ======================================================
// PROCESS A SINGLE ORDER (AUTOMATION)
// ======================================================

export async function autoFulfillOrder(
  admin,
  orderId,
  {
    includeNavidium = true,
    includeDropship = true,
  } = {}
) {
  const scan =
    await scanOrderTargets(
      admin,
      orderId,
      {
        includeNavidium,
        includeDropship,
      }
    );

  const results = [];

  for (
    const target
    of scan.eligible
  ) {
    const verification =
      await verifyTarget(
        admin,
        target
      );

    if (!verification.ok) {
      results.push({
        ...target,
        result: "SKIPPED",
        message:
          verification.reason,
      });
      continue;
    }

    const fulfillment =
      await fulfillTarget(
        admin,
        target,
        verification.quantity
      );

    if (fulfillment.success) {
      results.push({
        ...target,
        itemName:
          verification.itemName,
        sku: verification.sku,
        quantity:
          verification.quantity,
        result: "FULFILLED",
        fulfillmentId:
          fulfillment.fulfillmentId,
        message:
          "Automatically fulfilled.",
      });
    } else {
      results.push({
        ...target,
        quantity:
          verification.quantity,
        result: "ERROR",
        message:
          fulfillment.error,
      });
    }

    // Keep mutations comfortably separated.
    await new Promise(
      (resolve) =>
        setTimeout(resolve, 250)
    );
  }

  return {
    order: scan.order,
    results,
    exceptions: scan.exceptions,
    summary: {
      eligible:
        scan.eligible.length,
      fulfilled:
        results.filter(
          (item) =>
            item.result === "FULFILLED"
        ).length,
      skipped:
        results.filter(
          (item) =>
            item.result === "SKIPPED"
        ).length,
      errors:
        results.filter(
          (item) =>
            item.result === "ERROR"
        ).length,
      exceptions:
        scan.exceptions.length,
    },
  };
}

// ======================================================
// SIGNED PREVIEW TOKEN
// ======================================================

function getSigningSecret() {
  return (
    process.env.SHOPIFY_API_SECRET ||
    process.env.SHOPIFY_API_KEY ||
    "dev-only-fallback"
  );
}

export function createPreviewToken(rows) {
  const payload = Buffer.from(
    JSON.stringify(rows)
  ).toString("base64url");

  const signature = crypto
    .createHmac(
      "sha256",
      getSigningSecret()
    )
    .update(payload)
    .digest("base64url");

  return `${payload}.${signature}`;
}

export function readPreviewToken(token) {
  if (
    !token ||
    !token.includes(".")
  ) {
    throw new Error(
      "Invalid or missing preview token."
    );
  }

  const [payload, signature] =
    token.split(".");

  const expectedSignature = crypto
    .createHmac(
      "sha256",
      getSigningSecret()
    )
    .update(payload)
    .digest("base64url");

  const actualBuffer =
    Buffer.from(signature);

  const expectedBuffer =
    Buffer.from(expectedSignature);

  if (
    actualBuffer.length !==
      expectedBuffer.length ||
    !crypto.timingSafeEqual(
      actualBuffer,
      expectedBuffer
    )
  ) {
    throw new Error(
      "Preview verification failed."
    );
  }

  const json = Buffer.from(
    payload,
    "base64url"
  ).toString("utf8");

  return JSON.parse(json);
}

// ======================================================
// SCAN TARGETS
// ======================================================

export async function scanTargets(
  admin,
  {
    startDate,
    endDate,
    includeNavidium = true,
    includeDropship = true,
  }
) {
  const eligible = [];
  const exceptions = [];

  let cursor = null;
  let hasNextPage = true;

  const queryString =
    `created_at:>=${startDate} created_at:<${endDate}`;

  while (hasNextPage) {
    const response =
      await admin.graphql(
        `#graphql
          query ScanCleanupOrders(
            $after: String
            $query: String!
          ) {
            orders(
              first: 50
              after: $after
              query: $query
              sortKey: CREATED_AT
            ) {
              nodes {
                id
                name
                createdAt

                fulfillmentOrders(first: 25) {
                  nodes {
                    id
                    status

                    lineItems(first: 100) {
                      nodes {
                        id
                        remainingQuantity

                        lineItem {
                          id
                          name
                          sku
                          currentQuantity
                          fulfillableQuantity
                        }
                      }
                    }
                  }
                }
              }

              pageInfo {
                hasNextPage
                endCursor
              }
            }
          }
        `,
        {
          variables: {
            after: cursor,
            query: queryString,
          },
        }
      );

    const json =
      await response.json();

    if (json.errors) {
      throw new Error(
        JSON.stringify(
          json.errors
        )
      );
    }

    const orders =
      json.data.orders;

    for (
      const order
      of orders.nodes
    ) {
      for (
        const fo
        of order.fulfillmentOrders.nodes
      ) {
        for (
          const item
          of fo.lineItems.nodes
        ) {
          const sku =
            item.lineItem?.sku || "";

          const type =
            classifySku(sku);

          if (!type) {
            continue;
          }

          if (
            type === "NAVIDIUM" &&
            !includeNavidium
          ) {
            continue;
          }

          if (
            type === "DROPSHIP" &&
            !includeDropship
          ) {
            continue;
          }

          if (
            item.remainingQuantity <= 0
          ) {
            continue;
          }

          const record = {
            type,

            orderId:
              order.id,

            orderName:
              order.name,

            createdAt:
              order.createdAt,

            fulfillmentOrderId:
              fo.id,

            fulfillmentOrderStatus:
              fo.status,

            fulfillmentLineItemId:
              item.id,

            itemName:
              item.lineItem?.name || "",

            sku,

            remainingQuantity:
              item.remainingQuantity,

            currentQuantity:
              item.lineItem
                ?.currentQuantity ?? 0,

            fulfillableQuantity:
              item.lineItem
                ?.fulfillableQuantity ?? 0,
          };

          const actionableStatus =
            fo.status === "OPEN" ||
            fo.status ===
              "IN_PROGRESS";

          const actionableQuantity =
            record.currentQuantity > 0 &&
            record.fulfillableQuantity > 0;

          if (
            actionableStatus &&
            actionableQuantity
          ) {
            eligible.push({
              ...record,
              classification:
                "ELIGIBLE",
            });
          } else {
            exceptions.push({
              ...record,
              classification:
                "LEGACY_EXCEPTION",
            });
          }
        }
      }
    }

    hasNextPage =
      orders.pageInfo.hasNextPage;

    cursor =
      orders.pageInfo.endCursor;
  }

  return {
    eligible,
    exceptions,
  };
}

// ======================================================
// VERIFY EXACT REVIEWED TARGET
// ======================================================

export async function verifyTarget(
  admin,
  target
) {
  const response =
    await admin.graphql(
      `#graphql
        query VerifyCleanupTarget(
          $id: ID!
        ) {
          fulfillmentOrder(
            id: $id
          ) {
            id
            status

            order {
              id
              name
              createdAt
            }

            lineItems(first: 100) {
              nodes {
                id
                remainingQuantity

                lineItem {
                  id
                  name
                  sku
                  currentQuantity
                  fulfillableQuantity
                }
              }
            }
          }
        }
      `,
      {
        variables: {
          id:
            target.fulfillmentOrderId,
        },
      }
    );

  const json =
    await response.json();

  if (json.errors) {
    return {
      ok: false,
      reason:
        JSON.stringify(
          json.errors
        ),
    };
  }

  const fo =
    json.data.fulfillmentOrder;

  if (!fo) {
    return {
      ok: false,
      reason:
        "Fulfillment order no longer exists.",
    };
  }

  if (
    fo.order?.id !==
    target.orderId
  ) {
    return {
      ok: false,
      reason:
        "Order verification failed.",
    };
  }

  if (
    fo.status !== "OPEN" &&
    fo.status !==
      "IN_PROGRESS"
  ) {
    return {
      ok: false,
      reason:
        `Fulfillment order is ${fo.status}.`,
    };
  }

  const line =
    fo.lineItems.nodes.find(
      (item) =>
        item.id ===
        target.fulfillmentLineItemId
    );

  if (!line) {
    return {
      ok: false,
      reason:
        "Reviewed fulfillment line no longer exists.",
    };
  }

  const sku =
    line.lineItem?.sku || "";

  const type =
    classifySku(sku);

  if (!type) {
    return {
      ok: false,
      reason:
        `SKU is no longer approved: ${sku}`,
    };
  }

  if (
    type !== target.type
  ) {
    return {
      ok: false,
      reason:
        "Target type changed since preview.",
    };
  }

  if (
    sku
      .trim()
      .toUpperCase() !==
    String(target.sku)
      .trim()
      .toUpperCase()
  ) {
    return {
      ok: false,
      reason:
        "SKU changed since preview.",
    };
  }

  if (
    line.remainingQuantity <= 0
  ) {
    return {
      ok: false,
      reason:
        "Nothing remains to fulfill.",
    };
  }

  if (
    line.lineItem
      ?.currentQuantity <= 0
  ) {
    return {
      ok: false,
      reason:
        "Current quantity is zero.",
    };
  }

  if (
    line.lineItem
      ?.fulfillableQuantity <= 0
  ) {
    return {
      ok: false,
      reason:
        "Fulfillable quantity is zero.",
    };
  }

  const quantity =
    Math.min(
      line.remainingQuantity,
      line.lineItem
        .fulfillableQuantity,
      target.remainingQuantity || 1
    );

  if (quantity <= 0) {
    return {
      ok: false,
      reason:
        "No valid quantity remains.",
    };
  }

  return {
    ok: true,

    quantity,

    type,

    sku,

    itemName:
      line.lineItem?.name || "",

    fulfillmentOrderStatus:
      fo.status,
  };
}

// ======================================================
// FULFILL EXACT LINE ITEM
// ======================================================

export async function fulfillTarget(
  admin,
  target,
  quantity
) {
  const response =
    await admin.graphql(
      `#graphql
        mutation FulfillCleanupTarget(
          $fulfillment: FulfillmentInput!
        ) {
          fulfillmentCreate(
            fulfillment:
              $fulfillment
          ) {
            fulfillment {
              id
              status
              createdAt
            }

            userErrors {
              field
              message
            }
          }
        }
      `,
      {
        variables: {
          fulfillment: {
            notifyCustomer:
              false,

            lineItemsByFulfillmentOrder:
              [
                {
                  fulfillmentOrderId:
                    target
                      .fulfillmentOrderId,

                  fulfillmentOrderLineItems:
                    [
                      {
                        id:
                          target
                            .fulfillmentLineItemId,

                        quantity,
                      },
                    ],
                },
              ],
          },
        },
      }
    );

  const json =
    await response.json();

  if (json.errors) {
    return {
      success: false,
      error:
        JSON.stringify(
          json.errors
        ),
    };
  }

  const payload =
    json.data.fulfillmentCreate;

  if (
    payload.userErrors?.length
  ) {
    return {
      success: false,

      error:
        payload.userErrors
          .map(
            (error) =>
              error.message
          )
          .join("; "),
    };
  }

  if (
    !payload.fulfillment?.id
  ) {
    return {
      success: false,

      error:
        "Shopify did not return a fulfillment.",
    };
  }

  return {
    success: true,

    fulfillmentId:
      payload.fulfillment.id,

    fulfillmentStatus:
      payload.fulfillment.status,
  };
}