import { describe, expect, it } from "vitest";
import { decodeEntities, docToText } from "../src/docxml.js";
import { EE_DOC } from "./helpers.js";

describe("docToText", () => {
  it("ARTICLE 제목과 PARAGRAPH 본문을 문서 순서대로 뽑는다", () => {
    expect(docToText(EE_DOC)).toBe("1. 다음 질환의 증상 완화\n두통, 치통, 생리통\n2. 발열");
  });

  it("이스케이프된 XML도 처리한다", () => {
    const escaped = EE_DOC.replace(/</g, "&lt;").replace(/>/g, "&gt;");
    expect(docToText(escaped)).toBe(docToText(EE_DOC));
  });

  it("문단 안의 표와 줄바꿈을 평문으로 바꾼다", () => {
    const doc =
      '<DOC><SECTION><ARTICLE title="표"><PARAGRAPH><![CDATA[<table><tr><td>성인</td><td>1정</td></tr><tr><td>소아</td><td>반 정</td></tr></table>]]></PARAGRAPH></ARTICLE></SECTION></DOC>';
    expect(docToText(doc)).toBe("표\n성인 | 1정\n소아 | 반 정");
  });

  it("URL이면 링크 문구를 돌려준다", () => {
    expect(docToText("https://nedrug.mfds.go.kr/pbp/cmn/pdfDownload/1")).toContain("원문 문서 링크");
  });

  it("문자열이 아니거나 비어 있으면 빈 문자열", () => {
    expect(docToText(undefined)).toBe("");
    expect(docToText("  ")).toBe("");
  });

  it("DOC 구조가 없는 평문도 정리한다", () => {
    expect(docToText("감기<br/>몸살")).toBe("감기\n몸살");
  });
});

describe("decodeEntities", () => {
  it("이름·10진·16진 엔티티를 푼다", () => {
    expect(decodeEntities("&lt;a&gt; &amp; &#44032; &#xAC00;")).toBe("<a> & 가 가");
  });
});
