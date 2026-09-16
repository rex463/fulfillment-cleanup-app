import { Form, useActionData, useLoaderData, useNavigation } from "react-router";
import { authenticate } from "../shopify.server";
import {
  getAutoFulfillSettings,
  getRecentAutoFulfillLogs,
  saveAutoFulfillSettings,
} from "../lib/auto-fulfill-settings.server";

export async function loader({ request }) {
  const { session } = await authenticate.admin(request);
  const settings = await getAutoFulfillSettings(session.shop);
  const logs = await getRecentAutoFulfillLogs(session.shop, 20);

  return {
    settings: {
      ...settings,
      lastRunAt: settings.lastRunAt?.toISOString?.() || null,
    },
    logs: logs.map((log) => ({
      ...log,
      createdAt: log.createdAt.toISOString(),
    })),
  };
}

export async function action({ request }) {
  const { session } = await authenticate.admin(request);
  const formData = await request.formData();

  const enabled = formData.get("enabled") === "on";
  const includeNavidium = formData.get("includeNavidium") === "on";
  const includeDropship = formData.get("includeDropship") === "on";

  if (enabled && !includeNavidium && !includeDropship) {
    return { error: "Enable Navidium, Drop Ship, or both before turning automation on." };
  }

  await saveAutoFulfillSettings(session.shop, {
    enabled,
    includeNavidium,
    includeDropship,
  });

  return { saved: true, message: enabled ? "Auto Fulfill is enabled." : "Auto Fulfill is disabled." };
}

function formatDate(value) {
  if (!value) return "Never";
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function StatusPill({ status }) {
  const good = status === "SUCCESS";
  const bad = status === "ERROR";
  return (
    <span style={{
      display: "inline-block",
      padding: "3px 8px",
      borderRadius: 999,
      fontSize: 12,
      fontWeight: 600,
      background: good ? "#e3f1df" : bad ? "#fee2e2" : "#eee",
      color: good ? "#1f5c2e" : bad ? "#8a1c1c" : "#444",
    }}>
      {status}
    </span>
  );
}

export default function AutoFulfill() {
  const { settings, logs } = useLoaderData();
  const actionData = useActionData();
  const navigation = useNavigation();
  const saving = navigation.state === "submitting";

  return (
    <s-page heading="Auto Fulfill">
      <s-section heading="Automation settings">
        <s-paragraph>
          Automatically fulfills only approved Navidium Package Assurance and Drop Ship fee line items when a new order is created. Regular merchandise is left unfulfilled. Customer fulfillment notifications remain off.
        </s-paragraph>

        <Form method="post">
          <div style={{ display: "grid", gap: 16, marginTop: 18, maxWidth: 680 }}>
            <label style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
              <input name="enabled" type="checkbox" defaultChecked={settings.enabled} style={{ marginTop: 4 }} />
              <span><strong>Enable Auto Fulfill</strong><br/><span style={{ color: "#616161" }}>Process matching line items automatically on new orders.</span></span>
            </label>

            <div style={{ borderTop: "1px solid #ddd", paddingTop: 16 }}>
              <div style={{ fontWeight: 600, marginBottom: 10 }}>Target SKU groups</div>
              <label style={{ display: "flex", gap: 10, marginBottom: 10 }}>
                <input name="includeNavidium" type="checkbox" defaultChecked={settings.includeNavidium} />
                <span>Navidium — SKUs beginning with <code>NVDPROTECTION</code></span>
              </label>
              <label style={{ display: "flex", gap: 10 }}>
                <input name="includeDropship" type="checkbox" defaultChecked={settings.includeDropship} />
                <span>Drop Ship fees — approved <code>DROP-SHIP-FEE</code> SKUs</span>
              </label>
            </div>

            {actionData?.error && <div style={{ padding: 12, background: "#fee2e2", borderRadius: 8 }}>{actionData.error}</div>}
            {actionData?.saved && <div style={{ padding: 12, background: "#e3f1df", borderRadius: 8 }}>{actionData.message}</div>}

            <div>
              <s-button type="submit" variant="primary" {...(saving ? { loading: true } : {})}>Save settings</s-button>
            </div>
          </div>
        </Form>
      </s-section>

      <s-section heading="Current status">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12 }}>
          <div><div style={{ color: "#616161", fontSize: 13 }}>Automation</div><strong>{settings.enabled ? "ON" : "OFF"}</strong></div>
          <div><div style={{ color: "#616161", fontSize: 13 }}>Last processed order</div><strong>{settings.lastOrderName || "None yet"}</strong></div>
          <div><div style={{ color: "#616161", fontSize: 13 }}>Last run</div><strong>{formatDate(settings.lastRunAt)}</strong></div>
          <div><div style={{ color: "#616161", fontSize: 13 }}>Last status</div><strong>{settings.lastStatus || "—"}</strong></div>
        </div>
      </s-section>

      <s-section heading="Recent automation activity">
        {logs.length === 0 ? (
          <s-paragraph>No automated orders have been processed yet.</s-paragraph>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
              <thead>
                <tr style={{ textAlign: "left", borderBottom: "1px solid #ddd" }}>
                  <th style={{ padding: "10px 8px" }}>Time</th>
                  <th style={{ padding: "10px 8px" }}>Order</th>
                  <th style={{ padding: "10px 8px" }}>Status</th>
                  <th style={{ padding: "10px 8px" }}>Fulfilled</th>
                  <th style={{ padding: "10px 8px" }}>Skipped</th>
                  <th style={{ padding: "10px 8px" }}>Errors</th>
                  <th style={{ padding: "10px 8px" }}>Notes</th>
                </tr>
              </thead>
              <tbody>
                {logs.map((log) => (
                  <tr key={log.id} style={{ borderBottom: "1px solid #eee" }}>
                    <td style={{ padding: "10px 8px", whiteSpace: "nowrap" }}>{formatDate(log.createdAt)}</td>
                    <td style={{ padding: "10px 8px" }}>{log.orderName || "—"}</td>
                    <td style={{ padding: "10px 8px" }}><StatusPill status={log.status} /></td>
                    <td style={{ padding: "10px 8px" }}>{log.fulfilled}</td>
                    <td style={{ padding: "10px 8px" }}>{log.skipped}</td>
                    <td style={{ padding: "10px 8px" }}>{log.errors}</td>
                    <td style={{ padding: "10px 8px" }}>{log.message || (log.exceptions ? `${log.exceptions} exception(s)` : "—")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </s-section>

      <s-section heading="Safety notes">
        <s-unordered-list>
          <s-list-item>Only exact approved target SKUs are fulfilled.</s-list-item>
          <s-list-item>Normal merchandise on the same order remains unfulfilled.</s-list-item>
          <s-list-item>The app re-verifies the fulfillment-order line before fulfilling it.</s-list-item>
          <s-list-item>Turning Auto Fulfill off stops future webhook processing; the manual Cleanup page still works.</s-list-item>
        </s-unordered-list>
      </s-section>
    </s-page>
  );
}
