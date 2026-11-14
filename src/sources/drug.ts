import type { DataGoKrClient } from "../client.js";
import { docToText } from "../docxml.js";
import { OnlabelError } from "../errors.js";
import { str, ymd, type PermitDetail, type ProductSummary, type SearchResult } from "./types.js";

/** 의약품 제품 허가정보 (data.go.kr 15095677) */
const LIST_PATH = "/DrugPrdtPrmsnInfoService08/getDrugPrdtPrmsnInq08";
const DETAIL_PATH = "/DrugPrdtPrmsnInfoService08/getDrugPrdtPrmsnDtlInq08";

export const DRUG_SEARCH_FIELDS = {
  name: "item_name",
  company: "entp_name",
  ingredient: "item_ingr_name",
  permit_no: "prduct_prmisn_no",
} as const;
export type DrugSearchBy = keyof typeof DRUG_SEARCH_FIELDS;

const HOUR = 3_600_000;

type Row = Record<string, unknown>;

function status(row: Row): { status: string; active: boolean } {
  const name = str(row.CANCEL_NAME);
  const date = ymd(row.CANCEL_DATE);
  if (date || (name && name !== "정상")) {
    return { status: `${name || "취소·취하"}${date ? ` ${date}` : ""}`, active: false };
  }
  return { status: "정상", active: true };
}

function isPrescription(value: string): boolean {
  return value.includes("전문");
}

export async function searchDrugs(
  client: DataGoKrClient,
  by: DrugSearchBy,
  query: string,
  pageNo: number,
  limit: number,
): Promise<SearchResult> {
  const page = await client.get("drug", LIST_PATH, { [DRUG_SEARCH_FIELDS[by]]: query, pageNo, numOfRows: limit }, HOUR);
  const items: ProductSummary[] = page.items.map((row) => ({
    type: "drug",
    id: str(row.ITEM_SEQ),
    name: str(row.ITEM_NAME),
    company: str(row.ENTP_NAME),
    permitDate: ymd(row.ITEM_PERMIT_DATE),
    ...status(row),
    details: [
      ["전문/일반", str(row.SPCLTY_PBLC)],
      ["주성분", str(row.ITEM_INGR_NAME)],
      ["분류", str(row.PRDUCT_TYPE)],
    ],
  }));
  return { items, totalCount: page.totalCount, pageNo: page.pageNo };
}

export async function getDrugPermit(
  client: DataGoKrClient,
  itemSeq: string,
  includePrecautions: boolean,
): Promise<PermitDetail | null> {
  const page = await client.get("drug", DETAIL_PATH, { item_seq: itemSeq, pageNo: 1, numOfRows: 5 }, 24 * HOUR);
  const row = page.items.find((r) => str(r.ITEM_SEQ) === itemSeq.trim());
  if (!row) return null;

  const efficacy = docToText(row.EE_DOC_DATA);
  if (!efficacy) {
    throw new OnlabelError("UPSTREAM_ERROR", `품목기준코드 ${itemSeq}의 응답에 효능효과(EE_DOC_DATA)가 없습니다.`);
  }
  const kind = str(row.ETC_OTC_CODE);
  const st = status(row);
  const warnings: string[] = [];
  if (!st.active) warnings.push(`이 허가는 ${st.status} 상태입니다. 취소·취하된 제품은 광고할 수 없습니다.`);
  if (isPrescription(kind)) {
    warnings.push(
      "전문의약품입니다. 의약 전문가 대상 매체가 아닌 곳(일반 소비자 대상 광고·문자·SNS)에는 광고할 수 없습니다(약사법 제68조 제6항). 조문 원문은 법령 MCP 등으로 확인하세요.",
    );
  }

  const sections = [{ label: "용법용량", text: docToText(row.UD_DOC_DATA) }];
  if (includePrecautions) sections.push({ label: "사용상의 주의사항", text: docToText(row.NB_DOC_DATA) });

  return {
    type: "drug",
    id: str(row.ITEM_SEQ),
    name: str(row.ITEM_NAME),
    company: str(row.ENTP_NAME),
    permitDate: ymd(row.ITEM_PERMIT_DATE),
    changeDate: ymd(row.CHANGE_DATE),
    ...st,
    basis: { label: "효능효과", text: efficacy },
    sections: sections.filter((s) => s.text),
    attributes: [
      ["전문/일반", kind],
      ["허가/신고", str(row.PERMIT_KIND_NAME)],
      ["유효성분", str(row.MAIN_ITEM_INGR)],
      ["성상", str(row.CHART)],
      ["위탁제조업체", str(row.CNSGN_MANUF)],
    ],
    warnings,
  };
}
