import { describe, expect, it } from "vitest";
import { DataGoKrClient, maskKey, normalizeServiceKey } from "../src/client.js";
import { OnlabelError } from "../src/errors.js";
import { gatewayXml, makeClient, mockFetch, okJson } from "./helpers.js";

const PATH = "/Svc/getOp";

async function errorOf(p: Promise<unknown>): Promise<OnlabelError> {
  try {
    await p;
  } catch (err) {
    expect(err).toBeInstanceOf(OnlabelError);
    return err as OnlabelError;
  }
  throw new Error("오류가 나야 하는데 성공했다");
}

describe("normalizeServiceKey", () => {
  it("Encoding 키(%XX 포함)를 Decoding 키로 바꾼다", () => {
    expect(normalizeServiceKey("abc%2Bdef%3D%3D")).toBe("abc+def==");
  });
  it("Decoding 키는 그대로 둔다", () => {
    expect(normalizeServiceKey("abc+def==")).toBe("abc+def==");
  });
  it("빈 값과 공백은 undefined", () => {
    expect(normalizeServiceKey(undefined)).toBeUndefined();
    expect(normalizeServiceKey("   ")).toBeUndefined();
  });
});

describe("maskKey", () => {
  it("원문 키와 URL 인코딩된 키를 모두 가린다", () => {
    const key = "abc+def==";
    const masked = maskKey(`url?serviceKey=${encodeURIComponent(key)} raw=${key}`, key);
    expect(masked).not.toContain(key);
    expect(masked).not.toContain(encodeURIComponent(key));
    expect(masked).toContain("***");
  });
});

describe("DataGoKrClient.get", () => {
  it("키가 없으면 호출하지 않고 KEY_MISSING", async () => {
    const { client, calls } = makeClient(() => ({ body: okJson([]) }), null);
    const err = await errorOf(client.get("device", PATH, {}, 1000));
    expect(err.code).toBe("KEY_MISSING");
    expect(err.message).toContain("15057456");
    expect(calls).toHaveLength(0);
  });

  it("Encoding 키를 넣어도 URL에는 한 번만 인코딩되어 나간다", async () => {
    const { fetch, calls } = mockFetch(() => ({ body: okJson([]) }));
    const client = new DataGoKrClient({ serviceKey: "abc%2Bdef%3D%3D", fetchImpl: fetch, retries: 0 });
    await client.get("device", PATH, { PRDUCT: "체온계" }, 1000);
    const url = calls[0]!.url;
    expect(url.searchParams.get("serviceKey")).toBe("abc+def==");
    expect(url.search).toContain("serviceKey=abc%2Bdef%3D%3D");
    expect(url.searchParams.get("type")).toBe("json");
    expect(url.searchParams.get("PRDUCT")).toBe("체온계");
  });

  it.each([
    ["30", "SERVICE KEY IS NOT REGISTERED ERROR.", "KEY_NOT_REGISTERED"],
    ["20", "SERVICE ACCESS DENIED ERROR.", "SERVICE_NOT_APPLIED"],
    ["22", "LIMITED NUMBER OF SERVICE REQUESTS EXCEEDS ERROR.", "QUOTA_EXCEEDED"],
    ["99", "UNKNOWN ERROR", "UPSTREAM_ERROR"],
  ])("게이트웨이 XML 코드 %s → 마커", async (code, msg, expected) => {
    const { client } = makeClient(() => ({ body: gatewayXml(code, msg) }));
    const err = await errorOf(client.get("drug", PATH, {}, 1000));
    expect(err.code).toBe(expected);
  });

  it("미신청 오류는 해당 API의 신청 페이지를 알려준다", async () => {
    const { client } = makeClient(() => ({ body: gatewayXml("20", "SERVICE ACCESS DENIED ERROR.") }));
    const err = await errorOf(client.get("drug", PATH, {}, 1000));
    expect(err.message).toContain("15095677");
  });

  it("HTTP 401 → KEY_NOT_REGISTERED, 429 → QUOTA_EXCEEDED", async () => {
    const a = makeClient(() => ({ status: 401, body: "Unauthorized" }));
    expect((await errorOf(a.client.get("device", PATH, {}, 1000))).code).toBe("KEY_NOT_REGISTERED");
    const b = makeClient(() => ({ status: 429, body: "Too Many" }));
    expect((await errorOf(b.client.get("device", PATH, {}, 1000))).code).toBe("QUOTA_EXCEEDED");
  });

  it("5xx는 재시도한 뒤 UPSTREAM_ERROR", async () => {
    const { fetch, calls } = mockFetch(() => ({ status: 503, body: "busy" }));
    const client = new DataGoKrClient({ serviceKey: "k", fetchImpl: fetch, retries: 1 });
    const err = await errorOf(client.get("device", PATH, {}, 1000));
    expect(err.code).toBe("UPSTREAM_ERROR");
    expect(calls).toHaveLength(2);
  });

  it("타임아웃은 TIMEOUT", async () => {
    const { client } = makeClient(() => {
      const e = new Error("timed out");
      e.name = "TimeoutError";
      throw e;
    });
    expect((await errorOf(client.get("device", PATH, {}, 1000))).code).toBe("TIMEOUT");
  });

  it("연결 오류 메시지에 키가 섞여 있으면 가린다", async () => {
    const { client } = makeClient(() => {
      throw new Error("connect failed: https://x?serviceKey=secret-key-123");
    }, "secret-key-123");
    const err = await errorOf(client.get("device", PATH, {}, 1000));
    expect(err.message).not.toContain("secret-key-123");
  });

  it("items 네 가지 형태를 모두 행 배열로 정리한다", async () => {
    const row = { A: "1" };
    for (const items of [[row], { item: [row] }, { item: row }, [{ item: row }]]) {
      const { client } = makeClient(() => ({ body: okJson(items, 1) }));
      const page = await client.get("device", PATH, {}, 1000);
      expect(page.items).toEqual([row]);
    }
  });

  it("response 래퍼가 있어도 읽는다", async () => {
    const body = JSON.stringify({ response: JSON.parse(okJson([{ A: "1" }])) });
    const { client } = makeClient(() => ({ body }));
    expect((await client.get("device", PATH, {}, 1000)).items).toHaveLength(1);
  });

  it("resultCode 03은 빈 결과", async () => {
    const body = JSON.stringify({ header: { resultCode: "03", resultMsg: "NODATA_ERROR" }, body: {} });
    const { client } = makeClient(() => ({ body }));
    const page = await client.get("device", PATH, {}, 1000);
    expect(page.items).toEqual([]);
    expect(page.totalCount).toBe(0);
  });

  it("같은 요청은 캐시에서 돌려준다", async () => {
    const { client, calls } = makeClient(() => ({ body: okJson([{ A: "1" }]) }));
    await client.get("device", PATH, { q: "a" }, 60_000);
    await client.get("device", PATH, { q: "a" }, 60_000);
    await client.get("device", PATH, { q: "b" }, 60_000);
    expect(calls).toHaveLength(2);
  });
});

describe("게이트웨이 JSON 오류", () => {
  it("JSON으로 온 returnReasonCode도 마커로 바꾼다", async () => {
    const body = JSON.stringify({
      OpenAPI_ServiceResponse: {
        cmmMsgHeader: { errMsg: "NO_OPENAPI_SERVICE_ERROR", returnAuthMsg: "해당 오픈API 서비스가 없거나 폐기됨", returnReasonCode: "12" },
      },
    });
    const { client } = makeClient(() => ({ status: 400, body }));
    const err = await errorOf(client.get("drug", PATH, {}, 1000));
    expect(err.code).toBe("UPSTREAM_ERROR");
    expect(err.message).toContain("경로를 찾지 못했습니다");
  });
});
