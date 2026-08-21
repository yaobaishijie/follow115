import { AppError } from "@follow115/contracts";

export interface ProxyConnectionTester {
  test(): Promise<void>;
}

export class DisabledProxyConnectionTester implements ProxyConnectionTester {
  async test(): Promise<void> {
    throw new AppError("NOT_IMPLEMENTED", "Proxy connectivity testing is not configured.");
  }
}

/**
 * Tests the exact runtime transport used for public Telegram reads.  It is
 * called only from the authenticated settings action, never at startup.
 */
export class ExternalProxyConnectionTester implements ProxyConnectionTester {
  constructor(
    private readonly transport: { get(url: string, options: { timeoutMs: number }): Promise<{ status: number }> },
    private readonly probeUrl = "https://t.me/"
  ) {}

  async test(): Promise<void> {
    try {
      const response = await this.transport.get(this.probeUrl, { timeoutMs: 10_000 });
      if (response.status < 200 || response.status >= 400) throw new Error(`Probe returned HTTP ${response.status}.`);
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError("EXTERNAL_UNAVAILABLE", "Proxy connection could not reach the Telegram public endpoint.", true);
    }
  }
}
