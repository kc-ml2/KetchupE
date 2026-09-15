import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { AgentError } from "./contracts.ts";

const MARU_ENDPOINT = new URL("https://maru.ml2-alpha.com/mcp");

export class MaruClient {
  constructor(private readonly token: string, private readonly appVersion: string) {}

  async call(tool: "browse_storage" | "find_storage", args: Record<string, unknown>, signal: AbortSignal): Promise<unknown> {
    const client = new Client({ name: "ketchupe", version: this.appVersion });
    const transport = new StreamableHTTPClientTransport(MARU_ENDPOINT, {
      requestInit: { headers: { Authorization: `Bearer ${this.token}` } },
    });
    try {
      await client.connect(transport, { signal });
      const result = await client.callTool({ name: tool, arguments: args }, undefined, { signal });
      if (result.isError) throw new AgentError("TOOL_UNAVAILABLE", `MARU ${tool} returned an error`);
      return result.structuredContent ?? result.content;
    } catch (error) {
      if (signal.aborted) throw new AgentError("CANCELLED", "cancelled");
      if (error instanceof AgentError) throw error;
      throw new AgentError("TOOL_UNAVAILABLE", `MARU ${tool} call failed`);
    } finally {
      await client.close().catch(() => undefined);
    }
  }
}
