/**
 * 오류는 대괄호 마커로 시작한다. 모델이 "결과 없음"과 "조회 실패"를 구분할 수 있어야
 * 조회 실패를 "허가 사항 없음"으로 잘못 답하지 않는다.
 */
export type ErrorCode =
  | "KEY_MISSING"
  | "KEY_NOT_REGISTERED"
  | "SERVICE_NOT_APPLIED"
  | "QUOTA_EXCEEDED"
  | "UPSTREAM_ERROR"
  | "TIMEOUT"
  | "INVALID_INPUT";

export class OnlabelError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
  ) {
    super(`[${code}] ${message}`);
    this.name = "OnlabelError";
  }
}

export const SERVICE_PAGES = {
  device: "https://www.data.go.kr/data/15057456/openapi.do",
  drug: "https://www.data.go.kr/data/15095677/openapi.do",
} as const;

export const SERVICE_NAMES = {
  device: "식품의약품안전처_의료기기 품목허가 정보",
  drug: "식품의약품안전처_의약품 제품 허가정보",
} as const;

export type SourceType = keyof typeof SERVICE_PAGES;

export function keyMissingError(): OnlabelError {
  return new OnlabelError(
    "KEY_MISSING",
    [
      "공공데이터포털 인증키가 설정되지 않았습니다.",
      "1) https://www.data.go.kr 에 가입한 뒤 아래 두 API를 각각 '활용신청'하세요.",
      `   - ${SERVICE_NAMES.device}: ${SERVICE_PAGES.device}`,
      `   - ${SERVICE_NAMES.drug}: ${SERVICE_PAGES.drug}`,
      "2) 마이페이지의 일반 인증키를 MCP 클라이언트 설정의 환경변수 DATA_GO_KR_SERVICE_KEY 에 넣으세요.",
      "   Encoding 키와 Decoding 키 중 어느 것을 넣어도 됩니다.",
    ].join("\n"),
  );
}
