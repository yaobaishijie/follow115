import assert from "node:assert/strict";
import test from "node:test";
import { AppError } from "@follow115/contracts";
import { HomepageBtbtlaConnectionTester, isCompatibleBtbtlaHomepage } from "./btbtla-connection-tester.js";

test("btbtla test accepts only the PRD-confirmed homepage structures", async () => {
  assert.equal(isCompatibleBtbtlaHomepage('<a href="/detail/1.html">x</a>'), true);
  assert.equal(isCompatibleBtbtlaHomepage('<form action="/search"></form>'), true);
  assert.equal(isCompatibleBtbtlaHomepage("<main>unrelated</main>"), false);
  await new HomepageBtbtlaConnectionTester({ async get() { return { status: 200, body: '<form action="/search"></form>' }; } }).test();
  await assert.rejects(
    () => new HomepageBtbtlaConnectionTester({ async get() { return { status: 200, body: "no form" }; } }).test(),
    (error: unknown) => error instanceof AppError && error.code === "EXTERNAL_UNAVAILABLE"
  );
});
