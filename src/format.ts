import { SERVICE_NAMES, type SourceType } from "./errors.js";
import type { PermitDetail, SearchResult } from "./sources/types.js";

const TYPE_LABEL: Record<SourceType, string> = { device: "의료기기", drug: "의약품" };
const ID_LABEL: Record<SourceType, string> = { device: "품목허가번호", drug: "품목기준코드" };

function kstNow(now: Date): string {
  const kst = new Date(now.getTime() + 9 * 3_600_000);
  return `${kst.toISOString().slice(0, 16).replace("T", " ")} KST`;
}

export function sourceLine(type: SourceType, now: Date = new Date()): string {
  return `출처: 식품의약품안전처, 공공데이터포털 「${SERVICE_NAMES[type]}」 · 조회 ${kstNow(now)}`;
}

function attrs(pairs: Array<[string, string]>): string {
  return pairs
    .filter(([, v]) => v)
    .map(([k, v]) => `${k}: ${v}`)
    .join(" · ");
}

export function renderSearch(type: SourceType, by: string, query: string, result: SearchResult, limit: number): string {
  if (result.items.length === 0) {
    const hint =
      type === "device"
        ? "의료기기 품목명은 브랜드가 아니라 분류 이름입니다(예: 체온계). by를 model(모델명)이나 company(업체명)로 바꿔 다시 검색하세요."
        : "제품명 일부만 넣거나 by를 company(업체명), ingredient(주성분)로 바꿔 다시 검색하세요.";
    return `[NOT_FOUND] ${TYPE_LABEL[type]} ${by}="${query}" 검색 결과가 0건입니다. 조회 실패가 아니라 결과가 없는 것입니다.\n${hint}`;
  }
  const lines = [
    `${TYPE_LABEL[type]} 검색: ${by}="${query}" · 전체 ${result.totalCount}건 중 ${result.pageNo}페이지`,
    "",
  ];
  result.items.forEach((it, i) => {
    lines.push(
      `${i + 1}. ${it.name} (${it.company})`,
      `   ${ID_LABEL[type]}: ${it.id} · 허가일: ${it.permitDate ?? "-"} · 상태: ${it.status}`,
    );
    const extra = attrs(it.details);
    if (extra) lines.push(`   ${extra}`);
  });
  if (result.totalCount > result.pageNo * limit) {
    lines.push("", `다음 결과는 page=${result.pageNo + 1}로 조회하세요.`);
  }
  lines.push("", `허가 원문(${type === "device" ? "사용목적" : "효능효과"})은 get_permit에 ${ID_LABEL[type]}를 넣어 조회하세요.`);
  lines.push(sourceLine(type));
  return lines.join("\n");
}

export function renderPermit(p: PermitDetail): string {
  const lines = [
    `## ${p.name} (${p.company})`,
    `${ID_LABEL[p.type]}: ${p.id} · 허가일: ${p.permitDate ?? "-"} · 최종 변경일: ${p.changeDate ?? "-"} · 상태: ${p.status}`,
  ];
  const extra = attrs(p.attributes);
  if (extra) lines.push(extra);
  for (const w of p.warnings) lines.push(`⚠ ${w}`);
  lines.push(
    "",
    `### ${p.basis.label} (허가 원문, 광고 문구 대조 기준)`,
    "<<<원문 시작>>>",
    p.basis.text,
    "<<<원문 끝>>>",
  );
  for (const s of p.sections) {
    lines.push("", `### ${s.label} (허가 원문)`, "<<<원문 시작>>>", s.text, "<<<원문 끝>>>");
  }
  lines.push("", sourceLine(p.type));
  return lines.join("\n");
}

export function renderNotFound(type: SourceType, id: string): string {
  return `[NOT_FOUND] ${TYPE_LABEL[type]} ${ID_LABEL[type]} "${id}"에 해당하는 허가 정보가 없습니다. 조회 실패가 아니라 결과가 없는 것입니다. search_products로 식별자를 먼저 확인하세요.`;
}
