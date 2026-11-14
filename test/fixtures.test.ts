/**
 * 2026-11-14에 실제 공공데이터포털에서 받은 응답(test/fixtures)으로 매핑을 확인한다.
 * 응답 형식이 바뀌면 이 테스트가 먼저 깨진다.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { renderPermit } from "../src/format.js";
import { getDevicePermit, normalizePermitNo, searchDevices } from "../src/sources/device.js";
import { getDrugPermit, lastEfficacyChange, searchDrugs } from "../src/sources/drug.js";
import { makeClient } from "./helpers.js";

const fixture = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");

describe("실제 응답: 의료기기", () => {
  it("품목명 검색 결과를 요약한다", async () => {
    const { client } = makeClient(() => ({ body: fixture("device-search-thermometer.json") }));
    const result = await searchDevices(client, "product", "체온계", 1, 3);
    expect(result.totalCount).toBeGreaterThan(100);
    expect(result.items).toHaveLength(3);
    for (const item of result.items) {
      expect(item.id).toMatch(/^[가-힣]{2} \d{2}-\d+ 호$/);
      expect(item.name).toContain("체온계");
      expect(item.active).toBe(true);
    }
  });

  it("붙여 쓴 허가번호로도 허가 원문을 찾는다", async () => {
    const { client, calls } = makeClient(() => ({ body: fixture("device-permit-ear-thermometer.json") }));
    const permit = await getDevicePermit(client, "수인26-4414호");
    expect(calls[0]!.url.searchParams.get("PRDUCT_PRMISN_NO")).toBe("수인 26-4414 호");
    expect(permit?.id).toBe("수인 26-4414 호");
    expect(permit?.basis.text).toContain("체온을 측정하기 위한 측정기");
  });
});

describe("실제 응답: 의약품", () => {
  it("영문 주성분 검색 결과를 요약한다", async () => {
    const { client } = makeClient(() => ({ body: fixture("drug-search-acetaminophen.json") }));
    const result = await searchDrugs(client, "ingredient", "Acetaminophen", 1, 3);
    expect(result.items).toHaveLength(3);
    expect(result.items[0]!.id).toMatch(/^\d{9}$/);
  });

  it("효능효과 XML을 평문으로 바꾸고 변경일과 PDF 링크를 붙인다", async () => {
    const { client } = makeClient(() => ({ body: fixture("drug-detail-198901273.json") }));
    const permit = await getDrugPermit(client, "198901273", true);
    expect(permit).not.toBeNull();
    expect(permit!.basis.text).toContain("1. 주효능·효과\n감기로 인한 발열 및 동통(통증)");
    expect(permit!.basis.text).not.toMatch(/<|CDATA/);
    expect(permit!.sections.map((s) => s.label)).toEqual(["용법용량", "사용상의 주의사항"]);
    expect(permit!.attributes).toContainEqual(["효능효과 최종 변경", "2014-03-07"]);
    expect(permit!.attributes.find(([k]) => k === "허가 원문 PDF")?.[1]).toMatch(/^HTTPS:\/\/NEDRUG\.MFDS\.GO\.KR/);
    expect(permit!.status).toBe("정상");
    expect(renderPermit(permit!)).toContain("<<<원문 시작>>>\n1. 주효능·효과");
  });
});

describe("normalizePermitNo", () => {
  it.each([
    ["수인26-4414호", "수인 26-4414 호"],
    ["수인 26-4414호", "수인 26-4414 호"],
    ["수인 26-4414 호", "수인 26-4414 호"],
    ["제허 00-000", "제허 00-000 호"],
    ["792", "792"],
  ])("%s → %s", (input, expected) => {
    expect(normalizePermitNo(input)).toBe(expected);
  });
});

describe("lastEfficacyChange", () => {
  it("가장 최근의 효능효과 변경일을 고른다", () => {
    expect(lastEfficacyChange("효능효과변경, 2007-11-16/용법용량변경, 2020-01-01/효능효과변경, 2014-03-07")).toBe("2014-03-07");
    expect(lastEfficacyChange(null)).toBeUndefined();
  });
});

describe("실제 응답: 용법용량 표", () => {
  it("표 한 행을 한 줄로 바꾼다", async () => {
    const { client } = makeClient(() => ({ body: fixture("drug-detail-198901273.json") }));
    const permit = await getDrugPermit(client, "198901273", false);
    const dosage = permit!.sections.find((s) => s.label === "용법용량")!.text;
    expect(dosage).toContain("연령 | 몸무게(kg) | 아세트아미노펜으로서 용량 | 1회용량");
    expect(dosage).toContain("만 12세 | 43kg 이상 | 640mg | 20ml");
  });
});
