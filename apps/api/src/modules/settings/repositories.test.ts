import assert from "node:assert/strict";
import test from "node:test";
import { PostgresSearchSourceProxySettingsStore } from "./repositories.js";

test("search source proxy store reads and writes one non-sensitive app_settings record", async () => {
  const calls: Array<{ text: string; values: readonly unknown[] | undefined }> = [];
  const pool = { async query(text: string, values?: readonly unknown[]) { calls.push({ text, values }); return { rows: [{ value: { btbtlaEnabled: true, isProxyEnabled: false, httpProxyHost: "127.0.0.1", httpProxyPort: 7890 } }] }; } };
  const store = new PostgresSearchSourceProxySettingsStore(pool as never);
  assert.deepEqual(await store.getSearchSourceProxySettings(), { btbtlaEnabled: true, isProxyEnabled: false, httpProxyHost: "127.0.0.1", httpProxyPort: 7890 });
  await store.saveSearchSourceProxySettings({ btbtlaEnabled: false, isProxyEnabled: true, httpProxyHost: "proxy", httpProxyPort: 1080 });
  assert.match(calls[0]!.text, /app_settings/);
  assert.match(calls[1]!.text, /is_sensitive\) VALUES \('search_source_proxy_settings', \$1::jsonb, false\)/);
  assert.deepEqual(calls[1]!.values, [JSON.stringify({ btbtlaEnabled: false, isProxyEnabled: true, httpProxyHost: "proxy", httpProxyPort: 1080 })]);
});
