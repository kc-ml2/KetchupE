// Prints the raw MARU MCP handshake and tool responses, exactly as the harness would receive them.
// Usage: npm run probe:maru            (reads MARU_API_TOKEN from .env)
//        npm run probe:maru -- find_storage '{"query":"연차"}'
import "dotenv/config";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";

const token = process.env.MARU_API_TOKEN?.trim();
if (!token) {
  console.error("MARU_API_TOKEN is required (.env 또는 환경변수)");
  process.exit(2);
}

const [tool = "browse_storage", rawArgs = "{}"] = process.argv.slice(2);
const args = JSON.parse(rawArgs) as Record<string, unknown>;
const endpoint = new URL(process.env.MARU_MCP_ENDPOINT ?? "https://maru.ml2-alpha.com/mcp");

const client = new Client({ name: "ketchupe-probe", version: "0.0.0" });
const transport = new StreamableHTTPClientTransport(endpoint, {
  authProvider: { token: async () => token },
});

const dump = (label: string, value: unknown) => console.log(`\n=== ${label} ===\n${JSON.stringify(value, null, 2)}`);

try {
  console.log("endpoint:", endpoint.href);
  await client.connect(transport);
  dump("서버 정보 (initialize 응답)", { serverInfo: client.getServerVersion(), capabilities: client.getServerCapabilities() });
  dump("tools/list", await client.listTools());

  console.log(`\n>>> tools/call  ${tool}  ${JSON.stringify(args)}`);
  const result = await client.callTool({ name: tool, arguments: args });
  dump("tools/call 원응답", result);

  // 이것이 harness의 MaruClient.call()이 실제로 돌려주는 값이다.
  dump("harness가 받는 값 (structuredContent ?? content)", result.structuredContent ?? result.content);
} catch (error) {
  console.error("\n=== 실패 ===");
  console.error(error);
  process.exitCode = 1;
} finally {
  await client.close().catch(() => undefined);
}
