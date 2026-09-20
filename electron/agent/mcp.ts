import {
  Client,
  StreamableHTTPClientTransport,
  type CallToolResult,
  type Tool,
} from "@modelcontextprotocol/client";
import { AgentError } from "./contracts.ts";

export type McpServerConfig = {
  id: string;
  endpoint: URL;
  clientName: string;
  clientVersion: string;
  token?: () => Promise<string>;
  allowedTools?: readonly string[];
};

/** One isolated MCP client per server. Transport/session details stay here; server semantics stay in adapters such as MARU. */
export class McpConnection {
  private client: Client | undefined;
  private transport: StreamableHTTPClientTransport | undefined;
  private connecting: Promise<Client> | undefined;
  private tools = new Map<string, Tool>();

  constructor(private readonly config: McpServerConfig) {}

  async callTool(name: string, args: Record<string, unknown>, signal: AbortSignal): Promise<CallToolResult> {
    if (this.config.allowedTools && !this.config.allowedTools.includes(name)) {
      throw new AgentError("TOOL_UNAVAILABLE", `${this.config.id} tool is not allowed: ${name}`);
    }
    try {
      const client = await this.connect(signal);
      const tool = this.tools.get(name);
      if (!tool) throw new AgentError("TOOL_UNAVAILABLE", `${this.config.id} does not provide tool: ${name}`);
      return await client.callTool({ name, arguments: args }, { signal, toolDefinition: tool });
    } catch (error) {
      if (signal.aborted) throw new AgentError("CANCELLED", "cancelled");
      if (error instanceof AgentError) throw error;
      await this.reset();
      throw new AgentError("TOOL_UNAVAILABLE", `${this.config.id} ${name} call failed`);
    }
  }

  async close(): Promise<void> {
    await this.reset();
  }

  private async connect(signal: AbortSignal): Promise<Client> {
    if (this.client) return this.client;
    if (this.connecting) return this.connecting;
    this.connecting = this.open(signal);
    try {
      this.client = await this.connecting;
      return this.client;
    } finally {
      this.connecting = undefined;
    }
  }

  private async open(signal: AbortSignal): Promise<Client> {
    const client = new Client({ name: this.config.clientName, version: this.config.clientVersion });
    const transport = new StreamableHTTPClientTransport(this.config.endpoint, {
      ...(this.config.token ? { authProvider: { token: this.config.token } } : {}),
    });
    try {
      await client.connect(transport, { signal });
      const listed = await client.listTools(undefined, { signal, cacheMode: "refresh" });
      this.tools = new Map(listed.tools.map((tool) => [tool.name, tool]));
      this.transport = transport;
      return client;
    } catch (error) {
      await client.close().catch(() => undefined);
      throw error;
    }
  }

  private async reset(): Promise<void> {
    const client = this.client;
    const transport = this.transport;
    this.client = undefined;
    this.transport = undefined;
    this.tools.clear();
    await transport?.terminateSession().catch(() => undefined);
    await client?.close().catch(() => undefined);
  }
}
