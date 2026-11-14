#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { DataGoKrClient } from "./client.js";
import { createServer } from "./server.js";

// 로컬 개발용: 현재 폴더의 .env가 있으면 읽는다. MCP 클라이언트는 보통 env 설정으로 키를 넘긴다.
try {
  process.loadEnvFile();
} catch {
  // .env가 없으면 무시
}

const client = new DataGoKrClient({ serviceKey: process.env.DATA_GO_KR_SERVICE_KEY });
const server = createServer(client);
await server.connect(new StdioServerTransport());

if (!client.serviceKey) {
  console.error("[korean-onlabel-mcp] DATA_GO_KR_SERVICE_KEY가 없습니다. 도구를 호출하면 설정 방법을 안내합니다.");
}
