import {
  Form,
  useActionData,
  useNavigation,
} from "react-router";

import {
  authenticate,
} from "../shopify.server";

import {
  scanTargets,
  verifyTarget,
  fulfillTarget,
  createPreviewToken,
  readPreviewToken,
} from "../lib/fulfillment-cleanup.server";

// ======================================================
// ACTION
// ======================================================

export async function action({
  request,
}) {
  const { admin } =
    await authenticate.admin(
      request
    );

  const formData =
    await request.formData();

  const intent =
    formData.get("intent");

  // ====================================================
  // SCAN
  // ====================================================

  if (intent === "scan") {
    const startDate =
      formData.get(
        "startDate"
      );

    const endDate =
      formData.get(
        "endDate"
      );

    const includeNavidium =
      formData.get(
        "includeNavidium"
      ) === "on";

    const includeDropship =
      formData.get(
        "includeDropship"
      ) === "on";

    if (
      !startDate ||
      !endDate
    ) {
      return {
        error:
          "Please select both a start and end date.",
      };
    }

    if (
      !includeNavidium &&
      !includeDropship
    ) {
      return {
        error:
          "Select Navidium, Dropship, or both.",
      };
    }

    if (
      new Date(startDate) >
      new Date(endDate)
    ) {
      return {
        error:
          "The start date must be before the end date.",
      };
    }

    const exclusiveEnd =
      new Date(
        `${endDate}T00:00:00Z`
      );

    exclusiveEnd.setUTCDate(
      exclusiveEnd.getUTCDate() +
        1
    );

    const queryEndDate =
      exclusiveEnd
        .toISOString()
        .slice(0, 10);

    const result =
      await scanTargets(
        admin,
        {
          startDate,
          endDate:
            queryEndDate,
          includeNavidium,
          includeDropship,
        }
      );

    const previewToken =
      result.eligible.length
        ? createPreviewToken(
            result.eligible
          )
        : null;

    return {
      mode: "scan",

      filters: {
        startDate,
        endDate,
        includeNavidium,
        includeDropship,
      },

      eligible:
        result.eligible,

      exceptions:
        result.exceptions,

      previewToken,

      summary: {
        eligible:
          result.eligible.length,

        navidium:
          result.eligible.filter(
            (item) =>
              item.type ===
              "NAVIDIUM"
          ).length,

        dropship:
          result.eligible.filter(
            (item) =>
              item.type ===
              "DROPSHIP"
          ).length,

        exceptions:
          result.exceptions.length,
      },
    };
  }

  // ====================================================
  // FULFILL SELECTED REVIEWED TARGETS
  // ====================================================

  if (
    intent ===
    "fulfill"
  ) {
    const previewToken =
      formData.get(
        "previewToken"
      );

    let reviewedTargets;

    try {
      reviewedTargets =
        readPreviewToken(
          previewToken
        );
    } catch (error) {
      return {
        error:
          error.message ||
          "Could not verify preview.",
      };
    }

    if (
      !Array.isArray(
        reviewedTargets
      ) ||
      !reviewedTargets.length
    ) {
      return {
        error:
          "There are no reviewed targets to fulfill.",
      };
    }

    const selectedIds =
      formData.getAll(
        "selectedTarget"
      );

    if (
      !selectedIds.length
    ) {
      return {
        error:
          "Select at least one item to fulfill.",
      };
    }

    const selectedTargets =
      reviewedTargets.filter(
        (target) =>
          selectedIds.includes(
            target
              .fulfillmentLineItemId
          )
      );

    if (
      !selectedTargets.length
    ) {
      return {
        error:
          "None of the selected items matched the reviewed preview.",
      };
    }

    const results = [];

    for (
      const target
      of selectedTargets
    ) {
      const verification =
        await verifyTarget(
          admin,
          target
        );

      if (
        !verification.ok
      ) {
        results.push({
          ...target,

          result:
            "SKIPPED",

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

      if (
        fulfillment.success
      ) {
        results.push({
          ...target,

          itemName:
            verification.itemName,

          sku:
            verification.sku,

          quantity:
            verification.quantity,

          result:
            "FULFILLED",

          fulfillmentId:
            fulfillment
              .fulfillmentId,

          message:
            "Successfully fulfilled.",
        });
      } else {
        results.push({
          ...target,

          quantity:
            verification.quantity,

          result:
            "ERROR",

          message:
            fulfillment.error,
        });
      }

      await new Promise(
        (resolve) =>
          setTimeout(
            resolve,
            500
          )
      );
    }

    return {
      mode:
        "fulfill",

      results,

      summary: {
        reviewed:
          reviewedTargets.length,

        selected:
          selectedTargets.length,

        fulfilled:
          results.filter(
            (item) =>
              item.result ===
              "FULFILLED"
          ).length,

        skipped:
          results.filter(
            (item) =>
              item.result ===
              "SKIPPED"
          ).length,

        errors:
          results.filter(
            (item) =>
              item.result ===
              "ERROR"
          ).length,
      },
    };
  }

  return {
    error:
      "Unknown action.",
  };
}

// ======================================================
// PAGE
// ======================================================

export default function CleanupPage() {
  const data =
    useActionData();

  const navigation =
    useNavigation();

  const loading =
    navigation.state !==
    "idle";

  const eligible =
    data?.eligible || [];

  const exceptions =
    data?.exceptions || [];

  const results =
    data?.results || [];

  return (
    <s-page
      heading="Historical Fulfillment Cleanup"
    >
      <div
        style={{
          display: "grid",
          gap: "20px",
        }}
      >
        {/* =========================================== */}
        {/* INTRO */}
        {/* =========================================== */}

        <s-section>
          <div
            style={{
              display: "flex",
              justifyContent:
                "space-between",
              alignItems:
                "flex-start",
              gap: "24px",
              flexWrap: "wrap",
            }}
          >
            <div>
              <s-heading>
                Clean up historical fulfillment items
              </s-heading>

              <s-paragraph>
                Scan a date range for Navidium / ROAM Shipping Assurance
                and approved Dropship Fee line items.
              </s-paragraph>

              <div
                style={{
                  marginTop: "10px",
                }}
              >
                <small>
                  Normal merchandise is ignored and is never included in
                  cleanup fulfillment.
                </small>
              </div>
            </div>

            <Badge
              label="Review-first workflow"
              tone="info"
            />
          </div>
        </s-section>

        {/* =========================================== */}
        {/* SCAN FORM */}
        {/* =========================================== */}

        <s-section>
          <s-heading>
            Scan orders
          </s-heading>

          <div
            style={{
              marginTop: "16px",
            }}
          >
            <Form method="post">
              <input
                type="hidden"
                name="intent"
                value="scan"
              />

              <div
                style={{
                  display: "grid",
                  gridTemplateColumns:
                    "repeat(auto-fit, minmax(220px, 1fr))",
                  gap: "16px",
                }}
              >
                <FieldCard
                  label="From date"
                >
                  <input
                    type="date"
                    name="startDate"
                    defaultValue={
                      data?.filters
                        ?.startDate ||
                      "2026-01-01"
                    }
                    required
                    style={
                      inputStyle
                    }
                  />
                </FieldCard>

                <FieldCard
                  label="To date"
                >
                  <input
                    type="date"
                    name="endDate"
                    defaultValue={
                      data?.filters
                        ?.endDate ||
                      "2026-08-31"
                    }
                    required
                    style={
                      inputStyle
                    }
                  />
                </FieldCard>
              </div>

              <div
                style={{
                  marginTop:
                    "18px",
                  display:
                    "grid",
                  gap:
                    "10px",
                }}
              >
                <CheckboxRow
                  name="includeNavidium"
                  label="Navidium / ROAM Shipping Assurance"
                  defaultChecked={
                    data?.filters
                      ?.includeNavidium ??
                    true
                  }
                />

                <CheckboxRow
                  name="includeDropship"
                  label="Dropship Fees"
                  defaultChecked={
                    data?.filters
                      ?.includeDropship ??
                    true
                  }
                />
              </div>

              <div
                style={{
                  marginTop:
                    "20px",
                }}
              >
                <PrimaryButton
                  type="submit"
                  disabled={
                    loading
                  }
                >
                  {loading
                    ? "Scanning..."
                    : "Scan Orders"}
                </PrimaryButton>
              </div>
            </Form>
          </div>
        </s-section>

        {/* =========================================== */}
        {/* ERROR */}
        {/* =========================================== */}

        {data?.error && (
          <s-section>
            <div
              style={
                alertStyle
              }
            >
              <strong>
                Something needs attention
              </strong>

              <div
                style={{
                  marginTop:
                    "6px",
                }}
              >
                {
                  data.error
                }
              </div>
            </div>
          </s-section>
        )}

        {/* =========================================== */}
        {/* SCAN SUMMARY */}
        {/* =========================================== */}

        {data?.mode ===
          "scan" &&
          data?.summary && (
            <s-section>
              <s-heading>
                Scan Summary
              </s-heading>

              <div
                style={{
                  display:
                    "grid",
                  gridTemplateColumns:
                    "repeat(auto-fit, minmax(150px, 1fr))",
                  gap:
                    "12px",
                  marginTop:
                    "16px",
                }}
              >
                <SummaryCard
                  label="Eligible"
                  value={
                    data.summary
                      .eligible
                  }
                  tone="success"
                />

                <SummaryCard
                  label="Navidium"
                  value={
                    data.summary
                      .navidium
                  }
                />

                <SummaryCard
                  label="Dropship"
                  value={
                    data.summary
                      .dropship
                  }
                />

                <SummaryCard
                  label="Legacy / Closed"
                  value={
                    data.summary
                      .exceptions
                  }
                  tone="warning"
                />
              </div>

              <div
                style={{
                  marginTop:
                    "18px",
                }}
              >
                <SecondaryButton
                  type="button"
                  onClick={() =>
                    downloadCsv(
                      [
                        ...eligible,
                        ...exceptions,
                      ],
                      "fulfillment-cleanup-scan.csv"
                    )
                  }
                >
                  Export Scan CSV
                </SecondaryButton>
              </div>
            </s-section>
          )}

        {/* =========================================== */}
        {/* ELIGIBLE ITEMS */}
        {/* =========================================== */}

        {eligible.length >
          0 && (
          <s-section>
            <div
              style={{
                display:
                  "flex",
                justifyContent:
                  "space-between",
                alignItems:
                  "center",
                gap:
                  "16px",
                flexWrap:
                  "wrap",
              }}
            >
              <div>
                <s-heading>
                  Eligible Items
                </s-heading>

                <s-paragraph>
                  Select the exact reviewed items you want to fulfill.
                </s-paragraph>
              </div>

              <Badge
                label={`${eligible.length} eligible`}
                tone="success"
              />
            </div>

            <div
              style={{
                marginTop:
                  "16px",
                padding:
                  "14px 16px",
                border:
                  "1px solid #e3e3e3",
                borderRadius:
                  "10px",
                background:
                  "#fafafa",
              }}
            >
              <strong>
                Safety rule
              </strong>

              <div
                style={{
                  marginTop:
                    "4px",
                }}
              >
                Only selected Navidium / Dropship lines can be fulfilled.
                Normal product merchandise is ignored.
              </div>
            </div>

            <Form
              method="post"
              onSubmit={(
                event
              ) => {
                const form =
                  event.currentTarget;

                const selectedCount =
                  form.querySelectorAll(
                    'input[name="selectedTarget"]:checked'
                  ).length;

                if (
                  selectedCount ===
                  0
                ) {
                  event.preventDefault();

                  window.alert(
                    "Select at least one item to fulfill."
                  );

                  return;
                }

                const confirmed =
                  window.confirm(
                    `Fulfill ${selectedCount} selected reviewed item${selectedCount === 1 ? "" : "s"}?\n\nOnly the selected Navidium / Dropship line items will be fulfilled. Normal merchandise will not be included.`
                  );

                if (
                  !confirmed
                ) {
                  event.preventDefault();
                }
              }}
            >
              <input
                type="hidden"
                name="intent"
                value="fulfill"
              />

              <input
                type="hidden"
                name="previewToken"
                value={
                  data.previewToken
                }
              />

              <div
                style={{
                  marginTop:
                    "16px",
                }}
              >
                <SelectableResultsTable
                  rows={
                    eligible
                  }
                />
              </div>

              <div
                style={{
                  marginTop:
                    "18px",
                  display:
                    "flex",
                  gap:
                    "10px",
                  flexWrap:
                    "wrap",
                }}
              >
                <PrimaryButton
                  type="submit"
                  disabled={
                    loading
                  }
                >
                  {loading
                    ? "Processing..."
                    : "Fulfill Selected Items"}
                </PrimaryButton>

                <SecondaryButton
                  type="button"
                  onClick={() =>
                    setAllCheckboxes(
                      true
                    )
                  }
                >
                  Select All
                </SecondaryButton>

                <SecondaryButton
                  type="button"
                  onClick={() =>
                    setAllCheckboxes(
                      false
                    )
                  }
                >
                  Deselect All
                </SecondaryButton>
              </div>
            </Form>
          </s-section>
        )}

        {/* =========================================== */}
        {/* LEGACY EXCEPTIONS */}
        {/* =========================================== */}

        {exceptions.length >
          0 && (
          <ResultsTable
            title="Legacy / Closed Exceptions"
            rows={
              exceptions
            }
            tone="warning"
          />
        )}

        {/* =========================================== */}
        {/* FULFILLMENT SUMMARY */}
        {/* =========================================== */}

        {data?.mode ===
          "fulfill" &&
          data?.summary && (
            <s-section>
              <s-heading>
                Fulfillment Summary
              </s-heading>

              <div
                style={{
                  display:
                    "grid",
                  gridTemplateColumns:
                    "repeat(auto-fit, minmax(150px, 1fr))",
                  gap:
                    "12px",
                  marginTop:
                    "16px",
                }}
              >
                <SummaryCard
                  label="Reviewed"
                  value={
                    data.summary
                      .reviewed
                  }
                />

                <SummaryCard
                  label="Selected"
                  value={
                    data.summary
                      .selected
                  }
                />

                <SummaryCard
                  label="Fulfilled"
                  value={
                    data.summary
                      .fulfilled
                  }
                  tone="success"
                />

                <SummaryCard
                  label="Skipped"
                  value={
                    data.summary
                      .skipped
                  }
                  tone="warning"
                />

                <SummaryCard
                  label="Errors"
                  value={
                    data.summary
                      .errors
                  }
                  tone={
                    data.summary
                      .errors >
                    0
                      ? "critical"
                      : "neutral"
                  }
                />
              </div>

              {results.length >
                0 && (
                <div
                  style={{
                    marginTop:
                      "18px",
                  }}
                >
                  <SecondaryButton
                    type="button"
                    onClick={() =>
                      downloadCsv(
                        results,
                        "fulfillment-cleanup-results.csv"
                      )
                    }
                  >
                    Export Results CSV
                  </SecondaryButton>
                </div>
              )}
            </s-section>
          )}

        {/* =========================================== */}
        {/* RESULTS */}
        {/* =========================================== */}

        {results.length >
          0 && (
          <ResultsTable
            title="Fulfillment Results"
            rows={
              results
            }
          />
        )}
      </div>
    </s-page>
  );
}

// ======================================================
// UI HELPERS
// ======================================================

function SummaryCard({
  label,
  value,
  tone = "neutral",
}) {
  const styles = {
    neutral: {
      background:
        "#f7f7f7",
      border:
        "#dedede",
    },

    success: {
      background:
        "#f1f8f4",
      border:
        "#b7dfc4",
    },

    warning: {
      background:
        "#fff8e6",
      border:
        "#f0d48a",
    },

    critical: {
      background:
        "#fff1f0",
      border:
        "#efb4ae",
    },
  };

  const selected =
    styles[tone] ||
    styles.neutral;

  return (
    <div
      style={{
        padding:
          "14px 16px",

        border:
          `1px solid ${selected.border}`,

        borderRadius:
          "10px",

        background:
          selected.background,
      }}
    >
      <div
        style={{
          fontSize:
            "13px",

          opacity:
            0.7,
        }}
      >
        {label}
      </div>

      <div
        style={{
          marginTop:
            "4px",

          fontSize:
            "24px",

          fontWeight:
            700,
        }}
      >
        {value}
      </div>
    </div>
  );
}

function Badge({
  label,
  tone = "neutral",
}) {
  const tones = {
    neutral: {
      background:
        "#eeeeee",
      color:
        "#303030",
    },

    info: {
      background:
        "#eaf3ff",
      color:
        "#174ea6",
    },

    success: {
      background:
        "#e6f4ea",
      color:
        "#166534",
    },

    warning: {
      background:
        "#fff3cd",
      color:
        "#7a5200",
    },

    critical: {
      background:
        "#fde8e7",
      color:
        "#a61b1b",
    },
  };

  const selected =
    tones[tone] ||
    tones.neutral;

  return (
    <span
      style={{
        display:
          "inline-block",

        padding:
          "5px 9px",

        borderRadius:
          "999px",

        background:
          selected.background,

        color:
          selected.color,

        fontSize:
          "12px",

        fontWeight:
          600,
      }}
    >
      {label}
    </span>
  );
}

function FieldCard({
  label,
  children,
}) {
  return (
    <label>
      <div
        style={{
          fontWeight:
            600,

          marginBottom:
            "6px",
        }}
      >
        {label}
      </div>

      {children}
    </label>
  );
}

function CheckboxRow({
  name,
  label,
  defaultChecked,
}) {
  return (
    <label
      style={{
        display:
          "flex",

        alignItems:
          "center",

        gap:
          "8px",
      }}
    >
      <input
        type="checkbox"
        name={name}
        defaultChecked={
          defaultChecked
        }
      />

      <span>
        {label}
      </span>
    </label>
  );
}

function PrimaryButton({
  children,
  ...props
}) {
  return (
    <button
      {...props}
      style={{
        appearance:
          "none",

        border:
          "1px solid #1f1f1f",

        borderRadius:
          "8px",

        padding:
          "9px 14px",

        background:
          "#1f1f1f",

        color:
          "#ffffff",

        fontWeight:
          600,

        cursor:
          props.disabled
            ? "not-allowed"
            : "pointer",

        opacity:
          props.disabled
            ? 0.6
            : 1,
      }}
    >
      {children}
    </button>
  );
}

function SecondaryButton({
  children,
  ...props
}) {
  return (
    <button
      {...props}
      style={{
        appearance:
          "none",

        border:
          "1px solid #c7c7c7",

        borderRadius:
          "8px",

        padding:
          "9px 14px",

        background:
          "#ffffff",

        color:
          "#202020",

        fontWeight:
          600,

        cursor:
          "pointer",
      }}
    >
      {children}
    </button>
  );
}

// ======================================================
// CSV DOWNLOAD
// ======================================================

function downloadCsv(
  rows,
  filename
) {
  if (
    !rows ||
    rows.length === 0
  ) {
    window.alert(
      "There are no rows to export."
    );

    return;
  }

  const headers = [
    "Result",
    "Classification",
    "Type",
    "Order",
    "Order Date",
    "Item",
    "SKU",
    "Fulfillment Order Status",
    "Remaining Quantity",
    "Current Quantity",
    "Fulfillable Quantity",
    "Fulfillment Order ID",
    "Fulfillment Line Item ID",
    "Fulfillment ID",
    "Message",
  ];

  function escapeCsv(
    value
  ) {
    if (
      value === null ||
      value === undefined
    ) {
      return "";
    }

    const text =
      String(value);

    if (
      text.includes(",") ||
      text.includes('"') ||
      text.includes("\n")
    ) {
      return `"${text.replace(
        /"/g,
        '""'
      )}"`;
    }

    return text;
  }

  const lines = [
    headers.join(","),

    ...rows.map(
      (row) =>
        [
          row.result ||
            "",

          row.classification ||
            "",

          row.type ||
            "",

          row.orderName ||
            "",

          row.createdAt ||
            "",

          row.itemName ||
            "",

          row.sku ||
            "",

          row.fulfillmentOrderStatus ||
            "",

          row.remainingQuantity ??
            "",

          row.currentQuantity ??
            "",

          row.fulfillableQuantity ??
            "",

          row.fulfillmentOrderId ||
            "",

          row.fulfillmentLineItemId ||
            "",

          row.fulfillmentId ||
            "",

          row.message ||
            "",
        ]
          .map(
            escapeCsv
          )
          .join(",")
    ),
  ];

  const csv =
    lines.join("\n");

  const blob =
    new Blob(
      [csv],
      {
        type:
          "text/csv;charset=utf-8;",
      }
    );

  const url =
    URL.createObjectURL(
      blob
    );

  const link =
    document.createElement(
      "a"
    );

  link.href =
    url;

  link.download =
    filename;

  document.body.appendChild(
    link
  );

  link.click();

  document.body.removeChild(
    link
  );

  URL.revokeObjectURL(
    url
  );
}

// ======================================================
// CHECKBOX HELPERS
// ======================================================

function setAllCheckboxes(
  checked
) {
  const checkboxes =
    document.querySelectorAll(
      'input[name="selectedTarget"]'
    );

  checkboxes.forEach(
    (checkbox) => {
      checkbox.checked =
        checked;
    }
  );
}

// ======================================================
// SELECTABLE TABLE
// ======================================================

function SelectableResultsTable({
  rows,
}) {
  return (
    <div
      style={{
        overflowX:
          "auto",
      }}
    >
      <table
        style={
          tableStyle
        }
      >
        <thead>
          <tr>
            <th
              style={
                thStyle
              }
            >
              Select
            </th>

            <th
              style={
                thStyle
              }
            >
              Order
            </th>

            <th
              style={
                thStyle
              }
            >
              Date
            </th>

            <th
              style={
                thStyle
              }
            >
              Type
            </th>

            <th
              style={
                thStyle
              }
            >
              SKU
            </th>

            <th
              style={
                thStyle
              }
            >
              Item
            </th>

            <th
              style={
                thStyle
              }
            >
              FO Status
            </th>

            <th
              style={
                thStyle
              }
            >
              Remaining
            </th>

            <th
              style={
                thStyle
              }
            >
              Fulfillable
            </th>
          </tr>
        </thead>

        <tbody>
          {rows.map(
            (row) => (
              <tr
                key={
                  row
                    .fulfillmentLineItemId
                }
              >
                <td
                  style={
                    tdStyle
                  }
                >
                  <input
                    type="checkbox"
                    name="selectedTarget"
                    value={
                      row
                        .fulfillmentLineItemId
                    }
                    defaultChecked
                  />
                </td>

                <td
                  style={
                    tdStyle
                  }
                >
                  <strong>
                    {
                      row.orderName
                    }
                  </strong>
                </td>

                <td
                  style={
                    tdStyle
                  }
                >
                  {
                    row.createdAt
                      ?.slice(
                        0,
                        10
                      )
                  }
                </td>

                <td
                  style={
                    tdStyle
                  }
                >
                  <Badge
                    label={
                      row.type
                    }

                    tone={
                      row.type ===
                      "NAVIDIUM"
                        ? "info"
                        : "warning"
                    }
                  />
                </td>

                <td
                  style={
                    tdStyle
                  }
                >
                  <code>
                    {
                      row.sku
                    }
                  </code>
                </td>

                <td
                  style={
                    tdStyle
                  }
                >
                  {
                    row.itemName
                  }
                </td>

                <td
                  style={
                    tdStyle
                  }
                >
                  <Badge
                    label={
                      row
                        .fulfillmentOrderStatus
                    }

                    tone="success"
                  />
                </td>

                <td
                  style={
                    tdStyle
                  }
                >
                  {
                    row
                      .remainingQuantity
                  }
                </td>

                <td
                  style={
                    tdStyle
                  }
                >
                  {
                    row
                      .fulfillableQuantity
                  }
                </td>
              </tr>
            )
          )}
        </tbody>
      </table>
    </div>
  );
}

// ======================================================
// STANDARD TABLE
// ======================================================

function ResultsTable({
  title,
  rows,
}) {
  return (
    <s-section>
      <s-heading>
        {title}
      </s-heading>

      <div
        style={{
          overflowX:
            "auto",

          marginTop:
            "16px",
        }}
      >
        <table
          style={
            tableStyle
          }
        >
          <thead>
            <tr>
              <th
                style={
                  thStyle
                }
              >
                Order
              </th>

              <th
                style={
                  thStyle
                }
              >
                Date
              </th>

              <th
                style={
                  thStyle
                }
              >
                Type
              </th>

              <th
                style={
                  thStyle
                }
              >
                SKU
              </th>

              <th
                style={
                  thStyle
                }
              >
                Item
              </th>

              <th
                style={
                  thStyle
                }
              >
                FO Status
              </th>

              <th
                style={
                  thStyle
                }
              >
                Remaining
              </th>

              <th
                style={
                  thStyle
                }
              >
                Fulfillable
              </th>

              <th
                style={
                  thStyle
                }
              >
                Result
              </th>
            </tr>
          </thead>

          <tbody>
            {rows.map(
              (
                row,
                index
              ) => (
                <tr
                  key={
                    row
                      .fulfillmentLineItemId ||
                    `${row.orderName}-${index}`
                  }
                >
                  <td
                    style={
                      tdStyle
                    }
                  >
                    <strong>
                      {
                        row.orderName
                      }
                    </strong>
                  </td>

                  <td
                    style={
                      tdStyle
                    }
                  >
                    {
                      row.createdAt
                        ?.slice(
                          0,
                          10
                        )
                    }
                  </td>

                  <td
                    style={
                      tdStyle
                    }
                  >
                    <Badge
                      label={
                        row.type
                      }

                      tone={
                        row.type ===
                        "NAVIDIUM"
                          ? "info"
                          : "warning"
                      }
                    />
                  </td>

                  <td
                    style={
                      tdStyle
                    }
                  >
                    <code>
                      {
                        row.sku
                      }
                    </code>
                  </td>

                  <td
                    style={
                      tdStyle
                    }
                  >
                    {
                      row.itemName
                    }
                  </td>

                  <td
                    style={
                      tdStyle
                    }
                  >
                    {
                      row
                        .fulfillmentOrderStatus
                    }
                  </td>

                  <td
                    style={
                      tdStyle
                    }
                  >
                    {
                      row
                        .remainingQuantity
                    }
                  </td>

                  <td
                    style={
                      tdStyle
                    }
                  >
                    {
                      row
                        .fulfillableQuantity
                    }
                  </td>

                  <td
                    style={
                      tdStyle
                    }
                  >
                    <Badge
                      label={
                        row.result ||
                        row.classification ||
                        "-"
                      }

                      tone={
                        row.result ===
                        "FULFILLED"
                          ? "success"
                          : row.result ===
                              "ERROR"
                            ? "critical"
                            : row.classification ===
                                "LEGACY_EXCEPTION"
                              ? "warning"
                              : "neutral"
                      }
                    />

                    {row.message && (
                      <div
                        style={{
                          marginTop:
                            "5px",

                          fontSize:
                            "12px",

                          opacity:
                            0.75,
                        }}
                      >
                        {
                          row.message
                        }
                      </div>
                    )}
                  </td>
                </tr>
              )
            )}
          </tbody>
        </table>
      </div>
    </s-section>
  );
}

// ======================================================
// STYLES
// ======================================================

const inputStyle = {
  width: "100%",
  boxSizing:
    "border-box",
  padding:
    "9px 10px",
  border:
    "1px solid #c9c9c9",
  borderRadius:
    "8px",
  background:
    "#ffffff",
};

const alertStyle = {
  padding:
    "14px 16px",
  border:
    "1px solid #efb4ae",
  borderRadius:
    "10px",
  background:
    "#fff1f0",
  color:
    "#8a1c17",
};

const tableStyle = {
  width:
    "100%",
  borderCollapse:
    "separate",
  borderSpacing:
    0,
  border:
    "1px solid #e3e3e3",
  borderRadius:
    "10px",
  overflow:
    "hidden",
};

const thStyle = {
  textAlign:
    "left",
  padding:
    "11px 12px",
  borderBottom:
    "1px solid #e3e3e3",
  background:
    "#f7f7f7",
  fontSize:
    "13px",
  whiteSpace:
    "nowrap",
};

const tdStyle = {
  padding:
    "12px",
  borderBottom:
    "1px solid #eeeeee",
  verticalAlign:
    "top",
};