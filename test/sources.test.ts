import { describe, expect, it } from "vitest";
import { renderPermit, renderSearch } from "../src/format.js";
import { getDevicePermit, searchDevices } from "../src/sources/device.js";
import { getDrugPermit, searchDrugs } from "../src/sources/drug.js";
import { deviceRow, drugDetailRow, drugListRow, makeClient, okJson } from "./helpers.js";

describe("의료기기", () => {
  it("검색 결과를 허가번호별로 묶고 모델명을 모은다", async () => {
    const rows = [
      deviceRow({ TYPE_NAME: "EX-100" }),
      deviceRow({ TYPE_NAME: "EX-200" }),
      deviceRow({ PRDUCT_PRMISN_NO: "제허 00-001호", TYPE_NAME: "ZZ-1" }),
    ];
    const { client, calls } = makeClient(() => ({ body: okJson(rows) }));
    const result = await searchDevices(client, "model", "EX", 1, 10);
    expect(calls[0]!.url.searchParams.get("TYPE_NAME")).toBe("EX");
    expect(result.items).toHaveLength(2);
    expect(result.items[0]!.details).toContainEqual(["모델명", "EX-100, EX-200"]);
  });

  it("허가 원문은 허가번호가 정확히 같은 행만 쓰고 사용목적 중복을 없앤다", async () => {
    const rows = [deviceRow(), deviceRow({ TYPE_NAME: "EX-200" }), deviceRow({ PRDUCT_PRMISN_NO: "제허 00-0000호" })];
    const { client } = makeClient(() => ({ body: okJson(rows) }));
    const permit = await getDevicePermit(client, "제허 00-000호");
    expect(permit).not.toBeNull();
    expect(permit!.basis.text).toBe("적외선을 이용하여 귀 또는 이마에서 체온을 측정하는 기구");
    expect(permit!.attributes).toContainEqual(["모델명", "EX-100, EX-200"]);
    expect(permit!.warnings).toEqual([]);
  });

  it("취소·취하 상태면 경고를 붙인다", async () => {
    const { client } = makeClient(() => ({ body: okJson([deviceRow({ RTRCN_DSCTN_DT: "20240101" })]) }));
    const permit = await getDevicePermit(client, "제허 00-000호");
    expect(permit!.active).toBe(false);
    expect(permit!.warnings.join()).toContain("광고할 수 없습니다");
  });

  it("일치하는 허가번호가 없으면 null", async () => {
    const { client } = makeClient(() => ({ body: okJson([deviceRow({ PRDUCT_PRMISN_NO: "다른 번호" })]) }));
    expect(await getDevicePermit(client, "제허 00-000호")).toBeNull();
  });
});

describe("의약품", () => {
  it("목록 검색은 ITEM_SEQ를 식별자로 쓴다", async () => {
    const { client, calls } = makeClient(() => ({ body: okJson([drugListRow()]) }));
    const result = await searchDrugs(client, "ingredient", "아세트아미노펜", 1, 10);
    expect(calls[0]!.url.searchParams.get("item_ingr_name")).toBe("아세트아미노펜");
    expect(result.items[0]!.id).toBe("202000001");
    expect(result.items[0]!.status).toBe("정상");
  });

  it("효능효과를 근거로, 용법용량을 함께 돌려준다", async () => {
    const { client } = makeClient(() => ({ body: okJson([drugDetailRow()]) }));
    const permit = await getDrugPermit(client, "202000001", false);
    expect(permit!.basis).toEqual({ label: "효능효과", text: "1. 다음 질환의 증상 완화\n두통, 치통, 생리통\n2. 발열" });
    expect(permit!.sections.map((s) => s.label)).toEqual(["용법용량"]);
    expect(permit!.warnings).toEqual([]);
  });

  it("include_precautions면 주의사항을 넣는다", async () => {
    const { client } = makeClient(() => ({ body: okJson([drugDetailRow()]) }));
    const permit = await getDrugPermit(client, "202000001", true);
    expect(permit!.sections.map((s) => s.label)).toEqual(["용법용량", "사용상의 주의사항"]);
  });

  it("전문의약품이면 약사법 제68조 제6항 경고를 붙인다", async () => {
    const { client } = makeClient(() => ({ body: okJson([drugDetailRow({ ETC_OTC_CODE: "전문의약품" })]) }));
    const permit = await getDrugPermit(client, "202000001", false);
    expect(permit!.warnings.join()).toContain("약사법 제68조 제6항");
  });

  it("취소된 품목이면 상태와 경고에 반영한다", async () => {
    const { client } = makeClient(() => ({
      body: okJson([drugDetailRow({ CANCEL_NAME: "취소", CANCEL_DATE: "20230510" })]),
    }));
    const permit = await getDrugPermit(client, "202000001", false);
    expect(permit!.status).toBe("취소 2023-05-10");
    expect(permit!.active).toBe(false);
  });
});

describe("출력 형식", () => {
  it("허가 원문을 원문 표시로 감싸고 출처를 붙인다", async () => {
    const { client } = makeClient(() => ({ body: okJson([drugDetailRow()]) }));
    const text = renderPermit((await getDrugPermit(client, "202000001", false))!);
    expect(text).toContain("<<<원문 시작>>>\n1. 다음 질환의 증상 완화");
    expect(text).toMatch(/출처: 식품의약품안전처, 공공데이터포털 「식품의약품안전처_의약품 제품 허가정보」 · 조회 \d{4}-\d{2}-\d{2} \d{2}:\d{2} KST/);
  });

  it("검색 결과 0건은 [NOT_FOUND]와 다른 검색 기준을 안내한다", () => {
    const text = renderSearch("device", "product", "브랜드명", { items: [], totalCount: 0, pageNo: 1 }, 10);
    expect(text.startsWith("[NOT_FOUND]")).toBe(true);
    expect(text).toContain("by를 model");
  });

  it("남은 결과가 있으면 다음 페이지를 안내한다", async () => {
    const { client } = makeClient(() => ({ body: okJson([drugListRow()], 25) }));
    const result = await searchDrugs(client, "name", "예시", 1, 10);
    expect(renderSearch("drug", "name", "예시", result, 10)).toContain("page=2");
  });
});
