import {
  OnlabelError,
  SERVICE_NAMES,
  SERVICE_PAGES,
  keyMissingError,
  type SourceType,
} from "./errors.js";

export type FetchLike = (input: string, init?: { signal?: AbortSignal }) => Promise<{
  ok: boolean;
  status: number;
  text(): Promise<string>;
}>;

export interface ClientOptions {
  serviceKey?: string | undefined;
  fetchImpl?: FetchLike;
  timeoutMs?: number;
  retries?: number;
  now?: () => number;
}

export interface Page<T> {
  items: T[];
  totalCount: number;
  pageNo: number;
  numOfRows: number;
}

type Row = Record<string, unknown>;

const BASE = "https://apis.data.go.kr/1471000";

/**
 * 공공데이터포털은 같은 키를 Encoding/Decoding 두 형태로 보여준다.
 * URLSearchParams가 다시 인코딩하므로 원문(Decoding) 키로 맞춰 둔다.
 */
export function normalizeServiceKey(raw: string | undefined): string | undefined {
  const key = raw?.trim();
  if (!key) return undefined;
  if (/%[0-9A-Fa-f]{2}/.test(key)) {
    try {
      return decodeURIComponent(key);
    } catch {
      return key;
    }
  }
  return key;
}

export function maskKey(text: string, key: string | undefined): string {
  if (!key) return text;
  let out = text;
  for (const variant of new Set([key, encodeURIComponent(key)])) {
    out = out.split(variant).join("***");
  }
  return out;
}

class TtlCache {
  private store = new Map<string, { value: unknown; expires: number }>();
  constructor(
    private readonly max: number,
    private readonly now: () => number,
  ) {}

  get<T>(key: string): T | undefined {
    const hit = this.store.get(key);
    if (!hit) return undefined;
    if (hit.expires <= this.now()) {
      this.store.delete(key);
      return undefined;
    }
    this.store.delete(key);
    this.store.set(key, hit);
    return hit.value as T;
  }

  set(key: string, value: unknown, ttlMs: number): void {
    if (this.store.size >= this.max) {
      const oldest = this.store.keys().next().value;
      if (oldest !== undefined) this.store.delete(oldest);
    }
    this.store.set(key, { value, expires: this.now() + ttlMs });
  }
}

/** data.go.kr 게이트웨이 오류(XML 또는 JSON)의 returnReasonCode → 마커 */
function gatewayError(body: string, source: SourceType): OnlabelError | undefined {
  const reason =
    body.match(/<returnReasonCode>\s*(\d+)\s*<\/returnReasonCode>/)?.[1] ??
    body.match(/"returnReasonCode"\s*:\s*"?(\d+)"?/)?.[1];
  const auth =
    body.match(/<returnAuthMsg>\s*([^<]+?)\s*<\/returnAuthMsg>/)?.[1] ??
    body.match(/"returnAuthMsg"\s*:\s*"([^"]*)"/)?.[1];
  if (!reason && !auth) return undefined;
  const page = `${SERVICE_NAMES[source]} ${SERVICE_PAGES[source]}`;
  switch (reason) {
    case "30":
      return new OnlabelError(
        "KEY_NOT_REGISTERED",
        `등록되지 않은 인증키입니다. 키를 다시 복사했는지 확인하세요. 활용신청 직후라면 승인 반영까지 시간이 걸릴 수 있습니다. (${page})`,
      );
    case "20":
      return new OnlabelError(
        "SERVICE_NOT_APPLIED",
        `이 API에 대한 활용신청이 없습니다. 다음 페이지에서 활용신청하세요: ${page}`,
      );
    case "12":
      return new OnlabelError(
        "UPSTREAM_ERROR",
        `공공데이터포털이 이 API 경로를 찾지 못했습니다(서비스 폐기 또는 버전 변경). 서버를 최신 버전으로 업데이트하세요. (${page})`,
      );
    case "22":
      return new OnlabelError(
        "QUOTA_EXCEEDED",
        "오늘 호출 한도를 넘었습니다. 자정 이후 다시 시도하거나 공공데이터포털에서 트래픽 증설을 신청하세요.",
      );
    default:
      return new OnlabelError("UPSTREAM_ERROR", `공공데이터포털 오류 (코드 ${reason ?? "?"}: ${auth ?? "알 수 없음"})`);
  }
}

/** 식약처 API는 items가 배열이거나 {item: [...]}, {item: {...}} 로 온다. */
function extractRows(items: unknown): Row[] {
  if (!items) return [];
  if (Array.isArray(items)) {
    return items.flatMap((it) => (it && typeof it === "object" && "item" in it ? extractRows((it as Row).item) : [it as Row]));
  }
  if (typeof items === "object") {
    const inner = (items as Row).item;
    if (inner === undefined) return [items as Row];
    return Array.isArray(inner) ? (inner as Row[]) : [inner as Row];
  }
  return [];
}

export class DataGoKrClient {
  readonly serviceKey: string | undefined;
  private readonly fetchImpl: FetchLike;
  private readonly timeoutMs: number;
  private readonly retries: number;
  private readonly cache: TtlCache;

  constructor(opts: ClientOptions = {}) {
    this.serviceKey = normalizeServiceKey(opts.serviceKey);
    this.fetchImpl = opts.fetchImpl ?? (globalThis.fetch as unknown as FetchLike);
    // 식약처 API는 상세 조회에 20초 넘게 걸릴 때가 있다(2026-11 실측 4~22초).
    this.timeoutMs = opts.timeoutMs ?? 40_000;
    this.retries = opts.retries ?? 1;
    this.cache = new TtlCache(500, opts.now ?? Date.now);
  }

  async get(
    source: SourceType,
    path: string,
    params: Record<string, string | number | undefined>,
    ttlMs: number,
  ): Promise<Page<Row>> {
    if (!this.serviceKey) throw keyMissingError();

    const query = new URLSearchParams({ serviceKey: this.serviceKey, type: "json" });
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== "") query.set(k, String(v));
    }
    const url = `${BASE}${path}?${query.toString()}`;
    const cacheKey = `${path}?${[...query.entries()].filter(([k]) => k !== "serviceKey").map((e) => e.join("=")).join("&")}`;
    const cached = this.cache.get<Page<Row>>(cacheKey);
    if (cached) return cached;

    const body = await this.fetchText(url, source);
    const page = this.parse(body, source);
    this.cache.set(cacheKey, page, ttlMs);
    return page;
  }

  private async fetchText(url: string, source: SourceType): Promise<string> {
    let lastError: unknown;
    for (let attempt = 0; attempt <= this.retries; attempt++) {
      try {
        const res = await this.fetchImpl(url, { signal: AbortSignal.timeout(this.timeoutMs) });
        const text = await res.text();
        if (res.ok) return text;
        const gw = gatewayError(text, source);
        if (gw) throw gw;
        if (res.status === 401 || res.status === 403) {
          throw new OnlabelError(
            "KEY_NOT_REGISTERED",
            `인증 실패(HTTP ${res.status}). 키와 활용신청 상태를 확인하세요: ${SERVICE_PAGES[source]}`,
          );
        }
        if (res.status === 429) {
          throw new OnlabelError("QUOTA_EXCEEDED", "호출 한도를 넘었습니다. 잠시 후 다시 시도하세요.");
        }
        lastError = new OnlabelError("UPSTREAM_ERROR", `공공데이터포털 HTTP ${res.status}`);
        if (res.status < 500) break;
      } catch (err) {
        if (err instanceof OnlabelError) throw err;
        lastError = err;
      }
      if (attempt < this.retries) await new Promise((r) => setTimeout(r, 300 * 2 ** attempt));
    }
    if (lastError instanceof OnlabelError) throw lastError;
    const name = (lastError as Error | undefined)?.name;
    if (name === "TimeoutError" || name === "AbortError") {
      throw new OnlabelError("TIMEOUT", `공공데이터포털 응답이 ${this.timeoutMs / 1000}초 안에 오지 않았습니다. 잠시 후 다시 시도하세요.`);
    }
    const detail = maskKey(String((lastError as Error | undefined)?.message ?? lastError), this.serviceKey);
    throw new OnlabelError("UPSTREAM_ERROR", `공공데이터포털 연결 실패: ${detail}`);
  }

  private parse(body: string, source: SourceType): Page<Row> {
    const trimmed = body.trim();
    const gw = gatewayError(trimmed, source);
    if (gw) throw gw;
    if (!trimmed.startsWith("{")) {
      throw new OnlabelError("UPSTREAM_ERROR", `JSON이 아닌 응답을 받았습니다: ${maskKey(trimmed.slice(0, 200), this.serviceKey)}`);
    }
    let json: Row;
    try {
      json = JSON.parse(trimmed) as Row;
    } catch {
      throw new OnlabelError("UPSTREAM_ERROR", "응답 JSON을 해석하지 못했습니다.");
    }
    const root = ((json.response as Row | undefined) ?? json) as Row;
    const header = (root.header ?? {}) as Row;
    const code = String(header.resultCode ?? "00");
    if (code === "03") return { items: [], totalCount: 0, pageNo: 1, numOfRows: 0 };
    if (code !== "00") {
      throw new OnlabelError("UPSTREAM_ERROR", `식약처 API 오류 (코드 ${code}: ${String(header.resultMsg ?? "")})`);
    }
    const bodyNode = (root.body ?? {}) as Row;
    return {
      items: extractRows(bodyNode.items),
      totalCount: Number(bodyNode.totalCount ?? 0),
      pageNo: Number(bodyNode.pageNo ?? 1),
      numOfRows: Number(bodyNode.numOfRows ?? 0),
    };
  }
}
