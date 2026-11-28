// 2026-11-28 rev.1 — 신청 저장 담당 파일 처음 만듦 (index.html rev.5와 함께 사용)
// 하는 일: 신청 팝업에서 보낸 이름 · 연락처 · 이메일 · 소속 · 직위를 D1의 applicants 표에 저장
// 놓는 곳: 저장소에서 index.html 옆 functions 폴더 → api 폴더 → apply.js
// 주소: /api/apply (보내기(POST)만 받음)
// 필요한 설정: Cloudflare Pages 설정 → 바인딩에서 D1 데이터베이스를 변수 이름 DB로 연결
//            (코드에는 비밀번호 · 키가 없음)

// 칸마다 받을 수 있는 최대 글자 수 (팝업 입력 칸과 같음)
const LIMITS = { name: 50, phone: 30, email: 254, organization: 100, job_title: 50 };
const EMAIL_RULE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// 팝업에 결과를 돌려주는 모양
function reply(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
}

// 앞뒤 띄어쓰기 없애기 (글자가 아니면 빈칸으로)
function clean(value) {
  return typeof value === "string" ? value.trim() : "";
}

export async function onRequestPost({ request, env }) {
  // 1) DB가 연결돼 있는지 확인
  if (!env.DB) {
    console.log("DB 바인딩이 없습니다. Pages 설정 → 바인딩에서 변수 이름 DB로 D1을 연결하세요.");
    return reply(500, { ok: false, error: "no_db" });
  }

  // 2) 보낸 내용 읽기
  let data;
  try {
    data = await request.json();
  } catch {
    return reply(400, { ok: false, error: "bad_request" });
  }
  if (!data || typeof data !== "object") return reply(400, { ok: false, error: "bad_request" });

  const form = {
    name: clean(data.name),
    phone: clean(data.phone),
    email: clean(data.email),
    organization: clean(data.organization),
    job_title: clean(data.job_title),
  };

  // 3) 필수 칸 · 이메일 모양 · 글자 수 확인
  for (const field of ["name", "phone", "email"]) {
    if (!form[field]) return reply(400, { ok: false, error: "required", field });
  }
  if (!EMAIL_RULE.test(form.email)) return reply(400, { ok: false, error: "email_format", field: "email" });
  for (const field of Object.keys(LIMITS)) {
    if (form[field].length > LIMITS[field]) return reply(400, { ok: false, error: "too_long", field });
  }

  // 4) 저장 (신청 번호 · 신청 시간은 표가 자동으로 기록, 비운 소속 · 직위는 빈칸으로 저장)
  try {
    await env.DB.prepare(
      "INSERT INTO applicants (name, organization, job_title, phone, email) VALUES (?1, ?2, ?3, ?4, ?5)"
    )
      .bind(form.name, form.organization || null, form.job_title || null, form.phone, form.email)
      .run();
  } catch (err) {
    const message = String((err && err.message) || err);
    // 같은 이메일이 이미 있음 (대문자 · 소문자가 달라도 같은 이메일)
    if (message.includes("UNIQUE")) return reply(409, { ok: false, error: "duplicate", field: "email" });
    console.log("applicants 저장 실패:", message);
    return reply(500, { ok: false, error: "save_failed" });
  }

  // 5) 저장 성공: 저장한 정보를 돌려줌 (팝업 완료 화면에 표시)
  return reply(200, { ok: true, applicant: form });
}
