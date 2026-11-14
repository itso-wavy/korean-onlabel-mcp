/**
 * 실제 공공데이터포털을 호출하는 테스트. .env에 DATA_GO_KR_SERVICE_KEY가 있을 때만 돈다.
 *   npm run test:live
 */
import { describe, expect, it } from "vitest";
import { DataGoKrClient } from "../src/client.js";
import { getDevicePermit, searchDevices } from "../src/sources/device.js";
import { getDrugPermit, searchDrugs } from "../src/sources/drug.js";

try {
  process.loadEnvFile();
} catch {
  // .env 없음
}

const key = process.env.DATA_GO_KR_SERVICE_KEY;

describe.skipIf(!key)("실제 API", () => {
  const client = new DataGoKrClient({ serviceKey: key });

  it("의료기기: 품목명 검색 → 허가 원문", async () => {
    const result = await searchDevices(client, "product", "체온계", 1, 5);
    expect(result.items.length).toBeGreaterThan(0);
    const permit = await getDevicePermit(client, result.items[0]!.id);
    expect(permit?.basis.text.length).toBeGreaterThan(0);
  }, 90_000);

  it("의료기기: 모델명 검색이 동작한다", async () => {
    const first = await searchDevices(client, "product", "체온계", 1, 1);
    const model = first.items[0]!.details.find(([k]) => k === "모델명")?.[1].split(",")[0]?.trim();
    expect(model).toBeTruthy();
    const byModel = await searchDevices(client, "model", model!, 1, 5);
    expect(byModel.items.length).toBeGreaterThan(0);
  }, 90_000);

  it("의약품: 주성분 검색 → 효능효과", async () => {
    const result = await searchDrugs(client, "ingredient", "Acetaminophen", 1, 5);
    expect(result.items.length).toBeGreaterThan(0);
    const permit = await getDrugPermit(client, result.items[0]!.id, false);
    expect(permit?.basis.text.length).toBeGreaterThan(0);
  }, 90_000);
});
