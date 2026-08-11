import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { DevDigestClient } from "./api-client.js";
import { registerTools } from "./tools.js";

const apiUrl = process.env["DEVDIGEST_API_URL"] ?? "http://localhost:3001";

const client = new DevDigestClient(apiUrl);
const server = new McpServer({ name: "devdigest", version: "0.1.0" });

registerTools(server, client);

const transport = new StdioServerTransport();

async function main() {
  await server.connect(transport);

  const shutdown = async () => {
    await server.close();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
