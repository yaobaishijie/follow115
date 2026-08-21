import { AppError } from "@follow115/contracts";
import { BTBTLA_BROWSER_USER_AGENT, BTBTLA_TIMEOUT_MS } from "./btbtla-search-adapter.js";

export interface BtbtlaConnectionTester {
  test(): Promise<void>;
}

export class DisabledBtbtlaConnectionTester implements BtbtlaConnectionTester {
  async test(): Promise<void> {
    throw new AppError("NOT_IMPLEMENTED", "btbtla connection testing is not configured.");
  }
}

/** PRD §22.7: only the known page structures count as a successful test. */
export class HomepageBtbtlaConnectionTester implements BtbtlaConnectionTester {
  constructor(
    private readonly http: { get(url: string, options: { timeoutMs: number; headers: Readonly<Record<string, string>> }): Promise<{ status: number; body: string }> },
    private readonly homepage = "https://www.btbtla.com/"
  ) {}

  async test(): Promise<void> {
    try {
      const response = await this.http.get(this.homepage, { timeoutMs: BTBTLA_TIMEOUT_MS, headers: { "user-agent": BTBTLA_BROWSER_USER_AGENT } });
      if (response.status < 200 || response.status >= 400 || !isCompatibleBtbtlaHomepage(response.body)) {
        throw new Error("btbtla homepage does not expose a recognized search structure.");
      }
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError("EXTERNAL_UNAVAILABLE", "btbtla 暂时不可访问。", true);
    }
  }
}

export function isCompatibleBtbtlaHomepage(html: string): boolean {
  return /\/detail\/[^"'\s<>]+/iu.test(html) || /<form\b[^>]*(?:\baction\s*=|\bmethod\s*=)[^>]*>/iu.test(html);
}
