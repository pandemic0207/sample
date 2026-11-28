// 2026-11-28 rev.1 — 관리자 API 처음 만듦 (admin.html rev.1과 함께 사용)
// 하는 일: 관리자 비밀번호 확인 → 신청자 목록 보기 · 수정 · 삭제
// 놓는 곳: 저장소에서 index.html 옆 functions 폴더 → api 폴더 → admin.js
// 주소: /api/admin
//   · 목록 보기  GET    /api/admin
//   · 수정       PUT    /api/admin?id=신청번호   (보내는 내용: 이름 · 소속 · 직위 · 연락처 · 이메일)
//   · 삭제       DELETE /api/admin?id=신청번호
// 잠금: 모든 요청마다 X-Admin-Password 값을 Cloudflare Secret ADMIN_PASSWORD와 비교
//       (코드에는 비밀번호가 없음)
// 필요한 설정: Pages 설정 → 바인딩에 D1(변수 이름 DB), 변수 및 비밀(Variables and Secrets)에 ADMIN_PASSWORD

const LIMITS = { name: 50, phone: 30, email: 254, organization: 100, job_title: 50 };
const EMAIL_RULE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// 관리자 화면에 결과를 돌려주는 모양
function reply(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
}

function clean(value) {
  return typeof value === "string" ? value.trim() : "";
}

// 비밀번호 비교 (글자 수나 순서로 정답을 짐작하지 못하게, 둘 다 같은 길이의 지문으로 바꾼 뒤 끝까지 비교)
async function samePassword(given, secret) {
  const encoder = new TextEncoder();
  const a = new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(given)));
  const b = new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(secret)));
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

// 소속 · 직위 칸 이름 알아내기
// (이 창에서 만든 표는 organization · job_title, 강의 자료 표는 company · position — 둘 다 지원)
async function getColumns(db) {
  const { results } = await db.prepare("PRAGMA table_info(applicants)").all();
  const names = (results || []).map((col) => col.name);
  if (names.includes("company")) return { org: "company", job: "position" };
  return { org: "organization", job: "job_title" };
}

// 주소의 ?id= 값을 숫자로 (잘못된 값이면 0)
function readId(request) {
  const id = Number(new URL(request.url).searchParams.get("id"));
  return Number.isInteger(id) && id > 0 ? id : 0;
}

export async function onRequest({ request, env }) {
  // 1) 설정 확인
  if (!env.ADMIN_PASSWORD) return reply(500, { ok: false, error: "no_secret" });
  if (!env.DB) return reply(500, { ok: false, error: "no_db" });

  // 2) 비밀번호 확인 (목록 · 수정 · 삭제 모두)
  let given = "";
  try {
    given = decodeURIComponent(request.headers.get("X-Admin-Password") || "");
  } catch {
    given = "";
  }
  if (!given || !(await samePassword(given, env.ADMIN_PASSWORD))) {
    return reply(401, { ok: false, error: "wrong_password" });
  }

  const { org, job } = await getColumns(env.DB);

  // 3) 목록 보기: 최근 신청이 맨 위
  if (request.method === "GET") {
    const { results } = await env.DB.prepare(
      `SELECT id, created_at, name, ${org} AS organization, ${job} AS job_title, phone, email
       FROM applicants ORDER BY id DESC`
    ).all();
    return reply(200, { ok: true, total: results.length, applicants: results });
  }

  // 4) 수정
  if (request.method === "PUT") {
    const id = readId(request);
    if (!id) return reply(400, { ok: false, error: "bad_id" });

    let data;
    try {
      data = await request.json();
    } catch {
      return reply(400, { ok: false, error: "bad_request" });
    }
    if (!data || typeof data !== "object") return reply(400, { ok: false, error: "bad_request" });

    const form = {
      name: clean(data.name),
      organization: clean(data.organization),
      job_title: clean(data.job_title),
      phone: clean(data.phone),
      email: clean(data.email),
    };
    for (const field of ["name", "phone", "email"]) {
      if (!form[field]) return reply(400, { ok: false, error: "required", field });
    }
    if (!EMAIL_RULE.test(form.email)) return reply(400, { ok: false, error: "email_format", field: "email" });
    for (const field of Object.keys(LIMITS)) {
      if (form[field].length > LIMITS[field]) return reply(400, { ok: false, error: "too_long", field });
    }

    try {
      const result = await env.DB.prepare(
        `UPDATE applicants SET name = ?1, ${org} = ?2, ${job} = ?3, phone = ?4, email = ?5 WHERE id = ?6`
      )
        .bind(form.name, form.organization || null, form.job_title || null, form.phone, form.email, id)
        .run();
      if (!result.meta || result.meta.changes === 0) return reply(404, { ok: false, error: "not_found" });
    } catch (err) {
      const message = String((err && err.message) || err);
      // 다른 신청자가 이미 쓰는 이메일
      if (message.includes("UNIQUE")) return reply(409, { ok: false, error: "duplicate", field: "email" });
      console.log("applicants 수정 실패:", message);
      return reply(500, { ok: false, error: "save_failed" });
    }
    return reply(200, { ok: true });
  }

  // 5) 삭제
  if (request.method === "DELETE") {
    const id = readId(request);
    if (!id) return reply(400, { ok: false, error: "bad_id" });
    const result = await env.DB.prepare("DELETE FROM applicants WHERE id = ?1").bind(id).run();
    if (!result.meta || result.meta.changes === 0) return reply(404, { ok: false, error: "not_found" });
    return reply(200, { ok: true });
  }

  return reply(405, { ok: false, error: "method_not_allowed" });
}
