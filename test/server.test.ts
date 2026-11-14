import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";
import { createServer } from "../src/server.js";
import { deviceRow, drugDetailRow, gatewayXml, makeClient, okJson } from "./helpers.js";

type Reply = { status?: number; body: string };

async function connect(responder: (url: URL) => Reply, serviceKey: string | null = "test-key") {
  const { client: api, calls } = makeClient(responder, serviceKey);
  const server = createServer(api);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test", version: "0.0.0" });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return { client, calls };
}

function textOf(result: Awaited<ReturnType<Client["callTool"]>>): string {
  const content = result.content as Array<{ type: string; text?: string }>;
  return content.map((c) => c.text ?? "").join("\n");
}

describe("MCP 서버", () => {
  it("도구 3개와 프롬프트 1개, instructions를 노출한다", async () => {
    const { client } = await connect(() => ({ body: okJson([]) }));
    const tools = await client.listTools();
    expect(tools.tools.map((t) => t.name).sort()).toEqual(["compare_products", "get_permit", "search_products"]);
    for (const tool of tools.tools) expect(tool.annotations?.readOnlyHint).toBe(true);
    const prompts = await client.listPrompts();
    expect(prompts.prompts.map((p) => p.name)).toEqual(["review_ad_copy"]);
    expect(client.getInstructions()).toContain("<<<원문 시작>>>");
  });

  it("키가 없으면 isError와 설정 안내를 돌려준다", async () => {
    const { client } = await connect(() => ({ body: okJson([]) }), null);
    const result = await client.callTool({ name: "search_products", arguments: { type: "device", query: "체온계" } });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toMatch(/^\[KEY_MISSING\]/);
  });

  it("미신청 API는 SERVICE_NOT_APPLIED로 구분한다", async () => {
    const { client } = await connect(() => ({ body: gatewayXml("20", "SERVICE ACCESS DENIED ERROR.") }));
    const result = await client.callTool({ name: "get_permit", arguments: { type: "drug", id: "202000001" } });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain("[SERVICE_NOT_APPLIED]");
  });

  it("종류에 맞지 않는 검색 기준은 INVALID_INPUT", async () => {
    const { client, calls } = await connect(() => ({ body: okJson([]) }));
    const result = await client.callTool({
      name: "search_products",
      arguments: { type: "device", query: "타이레놀", by: "ingredient" },
    });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain("[INVALID_INPUT]");
    expect(calls).toHaveLength(0);
  });

  it("search_products 기본 기준은 의료기기 product, 의약품 name", async () => {
    const { client, calls } = await connect(() => ({ body: okJson([]) }));
    await client.callTool({ name: "search_products", arguments: { type: "device", query: "체온계" } });
    await client.callTool({ name: "search_products", arguments: { type: "drug", query: "예시정" } });
    expect(calls[0]!.url.searchParams.get("PRDUCT")).toBe("체온계");
    expect(calls[1]!.url.searchParams.get("item_name")).toBe("예시정");
  });

  it("결과가 없으면 isError 없이 [NOT_FOUND]", async () => {
    const { client } = await connect(() => ({ body: okJson([]) }));
    const result = await client.callTool({ name: "get_permit", arguments: { type: "device", id: "제허 99-999호" } });
    expect(result.isError).toBeFalsy();
    expect(textOf(result)).toMatch(/^\[NOT_FOUND\]/);
  });

  it("get_permit은 허가 원문을 원문 표시로 감싸 돌려준다", async () => {
    const { client } = await connect(() => ({ body: okJson([deviceRow()]) }));
    const result = await client.callTool({ name: "get_permit", arguments: { type: "device", id: "제허 00-000호" } });
    const text = textOf(result);
    expect(text).toContain("### 사용목적");
    expect(text).toContain("<<<원문 시작>>>\n적외선을 이용하여");
  });

  it("compare_products는 제품마다 원문을 나란히 보여 주고 없는 식별자는 표시한다", async () => {
    const { client } = await connect((url) => {
      const seq = url.searchParams.get("item_seq");
      return { body: okJson(seq === "202000001" ? [drugDetailRow()] : []) };
    });
    const result = await client.callTool({
      name: "compare_products",
      arguments: { type: "drug", ids: ["202000001", "999999999"] },
    });
    const text = textOf(result);
    expect(text).toContain("## 예시정500밀리그램");
    expect(text).toContain('[NOT_FOUND] 의약품 품목기준코드 "999999999"');
  });

  it("review_ad_copy 프롬프트는 문구와 제품을 담은 사용자 메시지를 만든다", async () => {
    const { client } = await connect(() => ({ body: okJson([]) }));
    const prompt = await client.getPrompt({
      name: "review_ad_copy",
      arguments: { copy_text: "열을 1초 만에 잡아 줍니다", product: "EX-100", type: "device" },
    });
    const message = prompt.messages[0]!;
    expect(message.role).toBe("user");
    const body = (message.content as { text: string }).text;
    expect(body).toContain("열을 1초 만에 잡아 줍니다");
    expect(body).toContain("제품 종류: 의료기기");
    expect(body).toContain("| # | 문구 | 판정 |");
    expect(body).toContain("원문과 충돌");
    expect(body).toContain("include_precautions=true");
  });
});
