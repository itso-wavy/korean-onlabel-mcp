import type { DataGoKrClient } from "../client.js";
import { OnlabelError } from "../errors.js";
import { str, ymd, type PermitDetail, type ProductSummary, type SearchResult } from "./types.js";

/**
 * 의료기기 품목허가 정보 (data.go.kr 15057456)
 * 목록 오퍼레이션은 모델명 검색을 지원하지 않아서, 검색과 상세 모두 상세(Item) 오퍼레이션을 쓴다.
 */
const ITEM_PATH = "/MdlpPrdlstPrmisnInfoService06/getMdlpPrdlstPrmisnItem05";

export const DEVICE_SEARCH_FIELDS = {
  product: "PRDUCT",
  model: "TYPE_NAME",
  company: "ENTRPS",
  permit_no: "PRDUCT_PRMISN_NO",
} as const;
export type DeviceSearchBy = keyof typeof DEVICE_SEARCH_FIELDS;

const HOUR = 3_600_000;

type Row = Record<string, unknown>;

function status(row: Row): { status: string; active: boolean } {
  const code = str(row.RTRCN_DSCTN_DIVS_CD);
  const date = ymd(row.RTRCN_DSCTN_DT);
  if (code || date) return { status: `취소·취하${code ? ` (구분 ${code})` : ""}${date ? ` ${date}` : ""}`, active: false };
  return { status: "유효", active: true };
}

function groupByPermit(rows: Row[]): Map<string, Row[]> {
  const groups = new Map<string, Row[]>();
  for (const row of rows) {
    const id = str(row.PRDUCT_PRMISN_NO) || str(row.MDEQ_PRDLST_SN);
    const list = groups.get(id) ?? [];
    list.push(row);
    groups.set(id, list);
  }
  return groups;
}

function models(rows: Row[]): string {
  const names = [...new Set(rows.map((r) => str(r.TYPE_NAME)).filter(Boolean))];
  if (names.length <= 5) return names.join(", ");
  return `${names.slice(0, 5).join(", ")} 외 ${names.length - 5}개`;
}

export async function searchDevices(
  client: DataGoKrClient,
  by: DeviceSearchBy,
  query: string,
  pageNo: number,
  limit: number,
): Promise<SearchResult> {
  const page = await client.get("device", ITEM_PATH, { [DEVICE_SEARCH_FIELDS[by]]: query, pageNo, numOfRows: limit }, HOUR);
  const items: ProductSummary[] = [];
  for (const [id, rows] of groupByPermit(page.items)) {
    const first = rows[0]!;
    const st = status(first);
    items.push({
      type: "device",
      id,
      name: str(first.PRDUCT),
      company: str(first.ENTRPS),
      permitDate: ymd(first.PRMISN_DT),
      ...st,
      details: [
        ["등급", str(first.GRADE)],
        ["모델명", models(rows)],
      ],
    });
  }
  return { items, totalCount: page.totalCount, pageNo: page.pageNo };
}

export async function getDevicePermit(client: DataGoKrClient, permitNo: string): Promise<PermitDetail | null> {
  const page = await client.get("device", ITEM_PATH, { PRDUCT_PRMISN_NO: permitNo, pageNo: 1, numOfRows: 100 }, 24 * HOUR);
  const rows = page.items.filter((r) => str(r.PRDUCT_PRMISN_NO) === permitNo.trim());
  if (rows.length === 0) return null;
  const first = rows[0]!;
  const purposes = [...new Set(rows.map((r) => str(r.USE_PURPS)).filter(Boolean))];
  if (purposes.length === 0) {
    throw new OnlabelError("UPSTREAM_ERROR", `허가번호 ${permitNo}의 응답에 사용목적(USE_PURPS)이 없습니다.`);
  }
  const st = status(first);
  const warnings: string[] = [];
  if (!st.active) warnings.push(`이 허가는 ${st.status} 상태입니다. 취소·취하된 제품은 광고할 수 없습니다.`);
  if (page.totalCount > rows.length && page.totalCount > 100) {
    warnings.push(`모델이 ${page.totalCount}건이라 앞의 100건만 반영했습니다.`);
  }
  return {
    type: "device",
    id: str(first.PRDUCT_PRMISN_NO),
    name: str(first.PRDUCT),
    company: str(first.ENTRPS),
    permitDate: ymd(first.PRMISN_DT),
    changeDate: ymd(first.CHG_DT),
    ...st,
    basis: { label: "사용목적", text: purposes.join("\n\n") },
    sections: [],
    attributes: [
      ["등급", str(first.GRADE)],
      ["분류번호", str(first.MEA_CLASS_NO)],
      ["모델명", models(rows)],
      ["제조자", str(first.MANUF_NM)],
      ["제조의뢰자", str(first.MNFT_CLNT_NM)],
    ],
    warnings,
  };
}
