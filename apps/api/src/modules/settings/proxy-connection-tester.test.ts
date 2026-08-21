import assert from "node:assert/strict";
import test from "node:test";
import { AppError } from "@follow115/contracts";
import { ExternalProxyConnectionTester } from "./proxy-connection-tester.js";

test("proxy test uses the same read-only Telegram transport and maps failure safely", async () => {
  const calls: string[] = [];
  const tester = new ExternalProxyConnectionTester({ async get(url) { calls.push(url); return { status: 200 }; } });
  await tester.test();
  assert.deepEqual(calls, ["https://t.me/"]);

  await assert.rejects(
    () => new ExternalProxyConnectionTester({ async get() { throw new Error("proxy unavailable"); } }).test(),
    (error: unknown) => error instanceof AppError && error.code === "EXTERNAL_UNAVAILABLE"
  );
});
