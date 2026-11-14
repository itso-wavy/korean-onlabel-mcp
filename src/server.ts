import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { maskKey, type DataGoKrClient } from "./client.js";
import { OnlabelError, type SourceType } from "./errors.js";
import { renderNotFound, renderPermit, renderSearch } from "./format.js";
import { SERVER_INSTRUCTIONS, reviewAdCopyPrompt } from "./prompts.js";
import { DEVICE_SEARCH_FIELDS, getDevicePermit, searchDevices, type DeviceSearchBy } from "./sources/device.js";
import { DRUG_SEARCH_FIELDS, getDrugPermit, searchDrugs, type DrugSearchBy } from "./sources/drug.js";
import type { PermitDetail } from "./sources/types.js";
import { VERSION } from "./version.js";

const typeSchema = z
  .enum(["device", "drug"])
  .describe("device = 의료기기(사용목적 기준), drug = 의약품(효능효과 기준)");

const READ_ONLY = { readOnlyHint: true, idempotentHint: true, openWorldHint: true } as const;

function text(body: string, isError = false): CallToolResult {
  return { content: [{ type: "text", text: body }], ...(isError ? { isError: true } : {}) };
}

export function createServer(client: DataGoKrClient): McpServer {
  const server = new McpServer({ name: "korean-onlabel-mcp", version: VERSION }, { instructions: SERVER_INSTRUCTIONS });

  async function guard(run: () => Promise<CallToolResult>): Promise<CallToolResult> {
    try {
      return await run();
    } catch (err) {
      if (err instanceof OnlabelError) return text(err.message, true);
      const message = maskKey(err instanceof Error ? err.message : String(err), client.serviceKey);
      return text(`[UPSTREAM_ERROR] 예상하지 못한 오류: ${message}`, true);
    }
  }

  function fetchPermit(type: SourceType, id: string, includePrecautions = false): Promise<PermitDetail | null> {
    return type === "device" ? getDevicePermit(client, id) : getDrugPermit(client, id, includePrecautions);
  }

  server.registerTool(
    "search_products",
    {
      title: "식약처 허가 제품 검색",
      description: [
        "식약처 허가를 받은 의료기기·의약품을 찾아 식별자(get_permit의 id)를 돌려준다.",
        "의료기기 by: product(품목명, 분류 이름 예: 체온계) / model(모델명, 대소문자 구분) / company(업체명) / permit_no(품목허가번호 예: 수인 26-4414 호). 기본 product.",
        "의약품 by: name(제품명) / company(업체명) / ingredient(주성분 영문명 예: Acetaminophen) / permit_no(품목허가번호). 기본 name.",
        "모두 부분 일치로 찾는다. 의료기기를 브랜드로 찾을 때는 model이나 company를 쓴다.",
        "의약품 주성분은 영문명으로 저장되어 있다. 한글 성분명은 by=name으로 찾으면 제품명에 성분명이 들어간 제품이 나온다.",
        "식약처 API 응답이 10~20초 걸릴 수 있다.",
      ].join("\n"),
      inputSchema: {
        type: typeSchema,
        query: z.string().trim().min(1).max(100).describe("검색어"),
        by: z
          .enum(["product", "model", "company", "permit_no", "name", "ingredient"])
          .optional()
          .describe("검색 기준. 종류별 허용 값은 도구 설명 참조"),
        page: z.number().int().min(1).max(100).optional().describe("페이지 번호, 기본 1"),
        limit: z.number().int().min(1).max(20).optional().describe("페이지당 건수, 기본 10"),
      },
      annotations: { title: "식약처 허가 제품 검색", ...READ_ONLY },
    },
    ({ type, query, by, page, limit }) =>
      guard(async () => {
        const pageNo = page ?? 1;
        const size = limit ?? 10;
        if (type === "device") {
          const field = (by ?? "product") as DeviceSearchBy;
          if (!(field in DEVICE_SEARCH_FIELDS)) {
            throw new OnlabelError("INVALID_INPUT", `의료기기 검색 기준은 ${Object.keys(DEVICE_SEARCH_FIELDS).join(", ")} 중 하나입니다.`);
          }
          return text(renderSearch(type, field, query, await searchDevices(client, field, query, pageNo, size), size));
        }
        const field = (by ?? "name") as DrugSearchBy;
        if (!(field in DRUG_SEARCH_FIELDS)) {
          throw new OnlabelError("INVALID_INPUT", `의약품 검색 기준은 ${Object.keys(DRUG_SEARCH_FIELDS).join(", ")} 중 하나입니다.`);
        }
        return text(renderSearch(type, field, query, await searchDrugs(client, field, query, pageNo, size), size));
      }),
  );

  server.registerTool(
    "get_permit",
    {
      title: "허가 원문 조회",
      description: [
        "제품 하나의 식약처 허가 원문을 자르지 않고 가져온다. 광고 문구를 대조할 근거로 쓴다.",
        "의료기기: 사용목적, 등급, 모델명. id는 품목허가번호.",
        "의약품: 효능효과, 용법용량(선택: 사용상의 주의사항), 전문/일반 구분. id는 품목기준코드(ITEM_SEQ).",
        "취소·취하 상태나 전문의약품이면 경고를 함께 준다.",
      ].join("\n"),
      inputSchema: {
        type: typeSchema,
        id: z.string().trim().min(1).max(50).describe("search_products가 돌려준 식별자"),
        include_precautions: z.boolean().optional().describe("의약품 사용상의 주의사항 포함 여부, 기본 false"),
      },
      annotations: { title: "허가 원문 조회", ...READ_ONLY },
    },
    ({ type, id, include_precautions }) =>
      guard(async () => {
        const permit = await fetchPermit(type, id, include_precautions ?? false);
        return permit ? text(renderPermit(permit)) : text(renderNotFound(type, id));
      }),
  );

  server.registerTool(
    "compare_products",
    {
      title: "허가 범위 비교",
      description:
        "같은 종류의 제품 2~5개의 허가 원문(의료기기 사용목적, 의약품 효능효과)을 나란히 가져온다. 자사·경쟁 제품의 허가 범위 차이를 볼 때 쓴다.",
      inputSchema: {
        type: typeSchema,
        ids: z.array(z.string().trim().min(1).max(50)).min(2).max(5).describe("search_products가 돌려준 식별자 목록"),
      },
      annotations: { title: "허가 범위 비교", ...READ_ONLY },
    },
    ({ type, ids }) =>
      guard(async () => {
        const unique = [...new Set(ids)];
        const results = await Promise.all(unique.map((id) => fetchPermit(type, id)));
        const parts = results.map((permit, i) => (permit ? renderPermit(permit) : renderNotFound(type, unique[i]!)));
        return text(parts.join("\n\n---\n\n"));
      }),
  );

  server.registerPrompt(
    "review_ad_copy",
    {
      title: "광고 문구 허가 범위 점검",
      description: "광고·안내 문구를 제품의 식약처 허가 원문과 문장 단위로 대조해 근거 있음/근거 없음/판단 보류로 판정한다.",
      argsSchema: {
        copy_text: z.string().describe("점검할 광고 문구"),
        product: z.string().describe("제품명, 모델명 또는 허가번호"),
        type: z.string().optional().describe("device(의료기기) 또는 drug(의약품). 비우면 모델이 판단"),
      },
    },
    (args) => ({
      messages: [{ role: "user", content: { type: "text", text: reviewAdCopyPrompt(args) } }],
    }),
  );

  return server;
}
