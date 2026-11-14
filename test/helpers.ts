import { DataGoKrClient, type FetchLike } from "../src/client.js";

export interface MockCall {
  url: URL;
}

type Reply = { status?: number; body: string };
type Responder = (url: URL) => Reply | Promise<Reply>;

/** 호출 URL을 기록하고 responder가 정한 응답을 돌려주는 fetch 대역 */
export function mockFetch(responder: Responder): { fetch: FetchLike; calls: MockCall[] } {
  const calls: MockCall[] = [];
  const fetch: FetchLike = async (input) => {
    const url = new URL(input);
    calls.push({ url });
    const { status = 200, body } = await responder(url);
    return { ok: status >= 200 && status < 300, status, text: async () => body };
  };
  return { fetch, calls };
}

export function okJson(items: unknown, totalCount?: number, pageNo = 1): string {
  const count = totalCount ?? (Array.isArray(items) ? items.length : 1);
  return JSON.stringify({
    header: { resultCode: "00", resultMsg: "NORMAL SERVICE." },
    body: { pageNo, totalCount: count, numOfRows: 10, items },
  });
}

export function gatewayXml(reasonCode: string, authMsg: string): string {
  return `<OpenAPI_ServiceResponse><cmmMsgHeader><errMsg>SERVICE ERROR</errMsg><returnAuthMsg>${authMsg}</returnAuthMsg><returnReasonCode>${reasonCode}</returnReasonCode></cmmMsgHeader></OpenAPI_ServiceResponse>`;
}

export function makeClient(responder: Responder, serviceKey: string | null = "test-key") {
  const { fetch, calls } = mockFetch(responder);
  const client = new DataGoKrClient({ serviceKey: serviceKey ?? undefined, fetchImpl: fetch, retries: 0, timeoutMs: 1000 });
  return { client, calls };
}

/** 의료기기 Item 오퍼레이션 응답 행 (가상의 제품) */
export function deviceRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    PRDUCT_PRMISN_NO: "제허 00-000호",
    PRDUCT: "적외선체온계",
    ENTRPS: "예시메디칼",
    PRMISN_DT: "20200115",
    CHG_DT: "20230301",
    GRADE: "2",
    MEA_CLASS_NO: "A00000.00",
    TYPE_NAME: "EX-100",
    USE_PURPS: "적외선을 이용하여 귀 또는 이마에서 체온을 측정하는 기구",
    MANUF_NM: "",
    MNFT_CLNT_NM: "",
    RTRCN_DSCTN_DIVS_CD: "",
    RTRCN_DSCTN_DT: "",
    ...overrides,
  };
}

export const EE_DOC =
  '<DOC title="효능효과" type="EE"><SECTION title=""><ARTICLE title="1. 다음 질환의 증상 완화"><PARAGRAPH tagName="p" textIndent="" marginLeft=""><![CDATA[두통, 치통, 생리통]]></PARAGRAPH></ARTICLE><ARTICLE title="2. 발열"/></SECTION></DOC>';

export const UD_DOC =
  '<DOC title="용법용량" type="UD"><SECTION title=""><ARTICLE title=""><PARAGRAPH tagName="p"><![CDATA[성인 1회 1정, 1일 3회 복용한다.]]></PARAGRAPH></ARTICLE></SECTION></DOC>';

export const NB_DOC =
  '<DOC title="사용상의 주의사항" type="NB"><SECTION title=""><ARTICLE title="1. 경고"><PARAGRAPH tagName="p"><![CDATA[매일 세 잔 이상 술을 마시는 사람은 의사와 상의한다.]]></PARAGRAPH></ARTICLE></SECTION></DOC>';

/** 의약품 상세 오퍼레이션 응답 행 (가상의 제품) */
export function drugDetailRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    ITEM_SEQ: "202000001",
    ITEM_NAME: "예시정500밀리그램",
    ENTP_NAME: "예시제약(주)",
    ITEM_PERMIT_DATE: "20200102",
    CHANGE_DATE: "20240501",
    ETC_OTC_CODE: "일반의약품",
    PERMIT_KIND_NAME: "허가",
    MAIN_ITEM_INGR: "[M000001]아세트아미노펜",
    CHART: "흰색의 장방형 정제",
    CNSGN_MANUF: "",
    CANCEL_NAME: "정상",
    CANCEL_DATE: "",
    EE_DOC_DATA: EE_DOC,
    UD_DOC_DATA: UD_DOC,
    NB_DOC_DATA: NB_DOC,
    ...overrides,
  };
}

export function drugListRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    ITEM_SEQ: "202000001",
    ITEM_NAME: "예시정500밀리그램",
    ENTP_NAME: "예시제약(주)",
    ITEM_PERMIT_DATE: "20200102",
    SPCLTY_PBLC: "일반의약품",
    ITEM_INGR_NAME: "아세트아미노펜",
    PRDUCT_TYPE: "[01140]해열.진통.소염제",
    CANCEL_NAME: "정상",
    CANCEL_DATE: "",
    ...overrides,
  };
}
