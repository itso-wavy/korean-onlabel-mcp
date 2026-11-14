import type { SourceType } from "../errors.js";

export interface ProductSummary {
  type: SourceType;
  /** 의료기기: 품목허가번호, 의약품: 품목기준코드(ITEM_SEQ). get_permit의 id로 쓴다. */
  id: string;
  name: string;
  company: string;
  permitDate?: string | undefined;
  status: string;
  active: boolean;
  details: Array<[label: string, value: string]>;
}

export interface PermitDetail {
  type: SourceType;
  id: string;
  name: string;
  company: string;
  permitDate?: string | undefined;
  changeDate?: string | undefined;
  status: string;
  active: boolean;
  /** 광고 문구를 대조할 근거 원문 */
  basis: { label: string; text: string };
  /** 근거 외에 함께 보여줄 원문 */
  sections: Array<{ label: string; text: string }>;
  attributes: Array<[label: string, value: string]>;
  warnings: string[];
}

export interface SearchResult {
  items: ProductSummary[];
  totalCount: number;
  pageNo: number;
}

export function str(v: unknown): string {
  if (v === undefined || v === null) return "";
  return String(v).trim();
}

/** "20190131" → "2019-01-31" */
export function ymd(v: unknown): string | undefined {
  const s = str(v).replace(/[^0-9]/g, "");
  if (s.length >= 8) return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
  return str(v) || undefined;
}
