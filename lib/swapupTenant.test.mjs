// SUP-162 — Implement SwapUp Tenant in GradeIQ
// Automated test suite covering:
//   A. Tenant Configuration (swapup exists, INR currency, pricing matches swapmore-in, existing tenants unchanged)
//   B. Session Creation (valid SwapUp server key permits session creation under swapup, missing/invalid key returns 401)
//   C. Security (missing/invalid key rejected BEFORE IMEI lookup, fetch not called on auth failure, server key never exposed)
//   D. Camera Journey (SwapUp retail configuration, photo sequence, and required photos match swapmore-in)
//   E. Admin and Isolation (SwapUp visible in audit, SwapMore India admin cannot access SwapUp sessions, existing SwapMore India admin remains functional)

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createRequire } from "node:module";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// Run in an isolated temp directory so data/gradeiq.db in the workspace is never touched.
process.chdir(fs.mkdtempSync(path.join(os.tmpdir(), "giq-sup162-")));

const SWAPUP_SECRET = "sup162-swapup-secret-key-998877";
process.env.SWAPUP_SERVER_KEY = SWAPUP_SECRET;
process.env.GRADEIQ_SERVER_KEY = "legacy-gradeiq-server-key-112233";
process.env.PHONECHECK_USERNAME = "pc-user";
process.env.PHONECHECK_API_KEY = "pc-key";
process.env.IMEI_API_KEY = "imei-key";
process.env.GIQ_AUTH_MODE = "legacy";
const ADMIN_PW = "sup162-admin-pw";
const SWAPMOREIND_PW = "sup162-swapmoreind-pw";
process.env.PORTAL_PW_ADMIN = ADMIN_PW;
process.env.PORTAL_PW_SWAPMOREIND = SWAPMOREIND_PW;

globalThis.AsyncLocalStorage ??= (await import("node:async_hooks")).AsyncLocalStorage;
const require = createRequire(import.meta.url);
const { workAsyncStorage } = require("next/dist/server/app-render/work-async-storage.external.js");
const { workUnitAsyncStorage } = require("next/dist/server/app-render/work-unit-async-storage.external.js");
const { RequestCookies } = require("next/dist/server/web/spec-extension/cookies.js");
const { NextRequest } = await import("next/server.js");

function inRequest(cookie, fn) {
  const cookies = new RequestCookies(new Headers(cookie ? { cookie } : {}));
  return workAsyncStorage.run({ route: "/api/test", forceStatic: false, dynamicShouldError: false }, () =>
    workUnitAsyncStorage.run({ type: "request", phase: "render", cookies }, fn),
  );
}

const { CLIENTS, CLIENT_IDS, resolveClient, isClientId } = await import("./clients.ts");
const { THEMES, themeFor } = await import("./clientTheme.ts");
const { loadPricebook, savePricebook, marketBaseFor, clientOffer } = await import("./clientPricing.ts");
const { catalogFor, saveCatalog } = await import("./priceCatalog.ts");
const { channelConfig, journeyFor, saveJourney, DEFAULT_CAPTURE_STEPS } = await import("./journeyConfig.ts");
const { db, getSession } = await import("./db.ts");
const { checkLogin } = await import("./portalAuth.ts");
const { POST: createSession, GET: listStaffSessions } = await import("../app/api/sessions/route.ts");
const { GET: getSessionRoute } = await import("../app/api/sessions/[id]/route.ts");
const { GET: getJourneyRoute } = await import("../app/api/journey/[clientId]/[channel]/route.ts");
const { GET: getPortalAudit } = await import("../app/api/portal/audit/route.ts");
const { GET: getPortalSessions } = await import("../app/api/portal/sessions/route.ts");
const { GET: getPortalSessionById } = await import("../app/api/portal/sessions/[id]/route.ts");
const { GET: getPortalConfig } = await import("../app/api/portal/config/route.ts");
const { GET: getPortalCatalog } = await import("../app/api/portal/catalog/route.ts");

let pass = 0;
const t = async (name, fn) => {
  try {
    await fn();
    console.log("  ok  ", name);
    pass++;
  } catch (e) {
    console.log("  FAIL", name, "\n       ", e.stack || e.message);
    process.exitCode = 1;
  }
};

// Track external fetch calls (e.g. Phonecheck / GSMA IMEI lookups)
let fetchCalls = [];
globalThis.fetch = async (url, init) => {
  fetchCalls.push({ url: String(url), init });
  return new Response(
    JSON.stringify({
      Model: "iPhone 15 Pro",
      Make: "Apple",
      Memory: "256GB",
      BatteryHealthPercentage: "94",
      DeviceLock: "Off",
      SimLock: "Unlocked",
      GSMA: { BlacklistStatus: "Clean" },
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
};

// Valid 15-digit Luhn IMEI generator
function makeImei(prefix14) {
  let sum = 0;
  for (let i = 0; i < 14; i++) {
    let d = Number(prefix14[i]);
    if (i % 2 === 1) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  const check = (10 - (sum % 10)) % 10;
  return prefix14 + String(check);
}

console.log("A. Tenant Configuration & Theme (SUP-162)");

await t("swapup exists in CLIENTS registry with currency INR and pricing 'swapmore'", () => {
  assert.ok(isClientId("swapup"), "isClientId('swapup') should be true");
  assert.ok(isClientId("SWAPUP"), "isClientId('SWAPUP') case-insensitive should be true");
  assert.ok(CLIENT_IDS.includes("swapup"), "CLIENT_IDS includes 'swapup'");
  const def = resolveClient("swapup");
  assert.deepEqual(def, {
    id: "swapup",
    name: "SwapUp",
    currency: "INR",
    pricing: "swapmore",
  });
});

await t("existing tenant configurations remain unchanged", () => {
  assert.deepEqual(CLIENTS["swapmore"], { id: "swapmore", name: "SwapMore US", currency: "USD", pricing: "swapmore" });
  assert.deepEqual(CLIENTS["swapmore-in"], { id: "swapmore-in", name: "SwapMore India", currency: "INR", pricing: "swapmore" });
  assert.deepEqual(CLIENTS["denovo"], { id: "denovo", name: "DeNovo / SuperIQ", currency: "USD", pricing: "heuristic" });
  assert.deepEqual(CLIENTS["inzman"], { id: "inzman", name: "Gadget Rebirth", currency: "INR", pricing: "swapmore" });
  assert.deepEqual(CLIENTS["default"], { id: "default", name: "GradeIQ", currency: "EUR", pricing: "heuristic" });
});

await t("SwapUp pricing settings and pricebook resolution match swapmore-in", () => {
  const seedBook = loadPricebook("swapmore").book;
  const indiaBook = {
    ...seedBook,
    schema: 1,
    currency: "INR",
    models: [{ id: "iphone-15-pro", name: "iPhone 15 Pro", brand: "Apple", basePrice: 72000 }],
  };
  savePricebook("swapmore-in", indiaBook);

  const baseSwapmoreIn = marketBaseFor("swapmore-in", "INR", "iPhone 15 Pro");
  const baseSwapup = marketBaseFor("swapup", "INR", "iPhone 15 Pro");
  assert.equal(baseSwapmoreIn, 72000);
  assert.equal(baseSwapup, 72000);

  const catIn = catalogFor("swapmore-in");
  const catUp = catalogFor("swapup");
  assert.equal(catUp.currency, "INR");
  assert.deepEqual(catUp.gradeFactors, catIn.gradeFactors);
  assert.deepEqual(catUp.faultCosts, catIn.faultCosts);
  assert.equal(catUp.marginRate, catIn.marginRate);

  saveCatalog("swapmore-in", { ...catIn, marginRate: 0.18 }, "test");
  assert.equal(catalogFor("swapmore-in").marginRate, 0.18);
  assert.equal(catalogFor("swapup").marginRate, 0.18);

  const fakeSession = {
    model: "iPhone 15 Pro",
    cosmetic: { grade: "A" },
    functional: {},
    imei_info: { storage: "256GB" },
    phonecheck: {},
  };
  const offerIn = clientOffer(fakeSession, "swapmore-in");
  const offerUp = clientOffer(fakeSession, "swapup");
  assert.equal(offerUp.currency, "INR");
  assert.equal(offerUp.value, offerIn.value);
  assert.ok(offerUp.value > 0, "SwapUp offer value should be positive and match swapmore-in");
});

await t("SwapUp has a dedicated brand theme separate from SwapMore India, and existing themes are preserved", () => {
  const swapupTheme = themeFor("swapup");
  const swapmoreInTheme = themeFor("swapmore-in");
  assert.equal(swapupTheme.brandName, "SwapUp");
  assert.equal(swapmoreInTheme.brandName, "SwapMore India");
  assert.notEqual(swapupTheme.brandName, swapmoreInTheme.brandName);
  assert.notEqual(swapupTheme.accent, swapmoreInTheme.accent);
  assert.equal(THEMES["swapmore"].brandName, "SwapMore");
  assert.equal(THEMES["denovo"].brandName, "DeNovo");
  assert.equal(THEMES["inzman"].brandName, "Gadget Rebirth");
  assert.equal(THEMES["default"].brandName, "GradeIQ");
});

console.log("B & C. Session Creation & Server-Key Security (SUP-162)");

async function postSessions(body, headers = {}) {
  const req = new NextRequest("http://localhost:3000/api/sessions", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-forwarded-for": "203.0.113.50",
      ...headers,
    },
    body: JSON.stringify(body),
  });
  return createSession(req);
}

await t("Missing SwapUp server key returns HTTP 401 BEFORE any IMEI lookup or session creation", async () => {
  fetchCalls = [];
  const beforeCount = db.prepare("SELECT COUNT(*) as n FROM sessions").get().n;
  const imei = makeImei("35678901234560");

  const res = await postSessions({
    client: "swapup",
    channel: "retail",
    segment: "c2b",
    imei,
    model: "iPhone 15 Pro",
  });

  assert.equal(res.status, 401, "Expected HTTP 401 when server key is missing");
  assert.equal(fetchCalls.length, 0, "IMEI lookup (fetch) MUST NOT be called when auth fails");
  const afterCount = db.prepare("SELECT COUNT(*) as n FROM sessions").get().n;
  assert.equal(afterCount, beforeCount, "No session row may be created on 401");
});

await t("Invalid SwapUp server key returns HTTP 401 BEFORE any IMEI lookup or session creation", async () => {
  fetchCalls = [];
  const beforeCount = db.prepare("SELECT COUNT(*) as n FROM sessions").get().n;
  const imei = makeImei("35678901234561");

  const res1 = await postSessions(
    { client: "swapup", channel: "retail", segment: "c2b", imei },
    { "x-swapup-server-key": "wrong-key" },
  );
  assert.equal(res1.status, 401);

  const res2 = await postSessions(
    { client: "swapup", channel: "retail", segment: "c2b", imei },
    { "x-gradeiq-server-key": "wrong-key" },
  );
  assert.equal(res2.status, 401);

  const res3 = await postSessions(
    { client: "swapup", channel: "retail", segment: "c2b", imei },
    { "x-gradeiq-server-key": process.env.GRADEIQ_SERVER_KEY },
  );
  assert.equal(res3.status, 401);

  assert.equal(fetchCalls.length, 0, "IMEI lookup (fetch) MUST NOT be called when key is invalid");
  const afterCount = db.prepare("SELECT COUNT(*) as n FROM sessions").get().n;
  assert.equal(afterCount, beforeCount, "No session row may be created on invalid key");
});

await t("Valid SwapUp server key permits session creation under 'swapup' and never exposes the secret", async () => {
  fetchCalls = [];
  const imei = makeImei("35678901234562");

  const res = await postSessions(
    { client: "swapup", channel: "retail", segment: "c2b", imei },
    { "x-swapup-server-key": SWAPUP_SECRET },
  );
  assert.equal(res.status, 200, "Valid SwapUp server key should succeed with 200");
  const rawText = await res.text();
  assert.ok(!rawText.includes(SWAPUP_SECRET), "Response must never expose SWAPUP_SERVER_KEY");

  const data = JSON.parse(rawText);
  assert.equal(data.client, "swapup");
  assert.equal(data.profile?.app, "swapup");
  assert.ok(fetchCalls.length > 0, "IMEI lookup should be executed after valid authentication");

  const stored = getSession(data.id);
  assert.ok(stored, "Session exists in DB");
  assert.equal(stored.client_id, "swapup");
  assert.equal(stored.profile.app, "swapup");

  const getRes = await getSessionRoute(new NextRequest(`http://localhost:3000/api/sessions/${data.id}`), {
    params: Promise.resolve({ id: data.id }),
  });
  assert.equal(getRes.status, 200);
  const getText = await getRes.text();
  assert.ok(!getText.includes(SWAPUP_SECRET), "GET /api/sessions/[id] must never expose SWAPUP_SERVER_KEY");
});

await t("Existing tenants (swapmore-in, denovo, default) continue using their existing session creation flow", async () => {
  const resIn = await postSessions({ client: "swapmore-in", channel: "retail", segment: "c2b", model: "iPhone 14" });
  assert.equal(resIn.status, 200);
  const dataIn = await resIn.json();
  assert.equal(dataIn.client, "swapmore-in");
  assert.equal(getSession(dataIn.id).client_id, "swapmore-in");

  const resDenovo = await postSessions({ client: "denovo", channel: "consumer", segment: "c2b", model: "iPhone 13" });
  assert.equal(resDenovo.status, 200);
  const dataDenovo = await resDenovo.json();
  assert.equal(dataDenovo.client, "denovo");
});

console.log("D. Camera Journey Comparison (SUP-162)");

await t("SwapUp retail camera journey matches swapmore-in retail configuration exactly", async () => {
  const inRetail = channelConfig("swapmore-in", "retail");
  const upRetail = channelConfig("swapup", "retail");

  assert.deepEqual(upRetail, inRetail, "SwapUp retail channel config must be identical to swapmore-in");
  assert.deepEqual(
    upRetail.captureSteps.map((s) => s.id),
    ["front", "back", "left", "right", "top", "bottom"],
    "Photo capture sequence must match expected 6 angles in order",
  );
  assert.deepEqual(
    upRetail.captureSteps,
    DEFAULT_CAPTURE_STEPS,
    "Required photographs and step definitions match",
  );

  const resUp = await getJourneyRoute(new NextRequest("http://localhost:3000/api/journey/swapup/retail"), {
    params: Promise.resolve({ clientId: "swapup", channel: "retail" }),
  });
  const resIn = await getJourneyRoute(new NextRequest("http://localhost:3000/api/journey/swapmore-in/retail"), {
    params: Promise.resolve({ clientId: "swapmore-in", channel: "retail" }),
  });
  assert.equal(resUp.status, 200);
  assert.equal(resIn.status, 200);
  const bodyUp = await resUp.json();
  const bodyIn = await resIn.json();
  assert.equal(bodyUp.clientId, "swapup");
  assert.deepEqual(bodyUp.config, bodyIn.config);
});

await t("If swapmore-in has a saved production retail journey, swapup inherits it without modifying swapmore-in", () => {
  const custom = journeyFor("swapmore-in");
  custom.channels.retail.copy = { introTitle: "Retail Counter Check", tagline: "Fast store inspection" };
  saveJourney("swapmore-in", custom);

  const upRetail = channelConfig("swapup", "retail");
  const inRetail = channelConfig("swapmore-in", "retail");
  assert.deepEqual(upRetail, inRetail);
  assert.equal(upRetail.copy.introTitle, "Retail Counter Check");
});

console.log("E. Admin Audit Panel & Tenant Isolation (SUP-162)");

await t("No built-in SwapUp client-admin login was added and AuditPanel includes 'swapup'", () => {
  const portalAuthSrc = fs.readFileSync(path.join(REPO_ROOT, "lib/portalAuth.ts"), "utf8");
  assert.ok(!portalAuthSrc.includes('clientId: "swapup"'), "Must not create a built-in SwapUp client-admin login in lib/portalAuth.ts");

  const auditPanelSrc = fs.readFileSync(path.join(REPO_ROOT, "app/superadmin/AuditPanel.tsx"), "utf8");
  assert.ok(auditPanelSrc.includes('"swapup"'), "AuditPanel client filter must include 'swapup'");
  assert.ok(auditPanelSrc.includes('"swapmore-in"'), "AuditPanel client filter must preserve 'swapmore-in'");
});

await t("Strict tenant isolation between swapup and swapmore-in across portal & audit APIs", async () => {
  const resUp = await postSessions(
    { client: "swapup", channel: "retail", segment: "c2b", model: "Pixel 8 Pro" },
    { "x-swapup-server-key": SWAPUP_SECRET },
  );
  const upSession = await resUp.json();

  const resIn = await postSessions({
    client: "swapmore-in",
    channel: "retail",
    segment: "c2b",
    model: "Galaxy S23",
  });
  const inSession = await resIn.json();

  const swapmoreIndCookie = `giq_portal=${checkLogin("swapmoreind", SWAPMOREIND_PW).token}`;
  const superAdminCookie = `giq_portal=${checkLogin("admin", ADMIN_PW).token}`;

  // 1. SwapMore India administrator CANNOT access SwapUp sessions list (403)
  const sessionsResForbidden = await inRequest(swapmoreIndCookie, () =>
    getPortalSessions(new NextRequest("http://localhost:3000/api/portal/sessions?client=swapup")),
  );
  assert.equal(sessionsResForbidden.status, 403, "swapmoreind must receive 403 when querying client=swapup sessions");

  // 2. SwapMore India administrator CANNOT access a SwapUp session by ID (403)
  const sessionByIdForbidden = await inRequest(swapmoreIndCookie, () =>
    getPortalSessionById(new NextRequest(`http://localhost:3000/api/portal/sessions/${upSession.id}`), {
      params: Promise.resolve({ id: upSession.id }),
    }),
  );
  assert.equal(sessionByIdForbidden.status, 403, "swapmoreind must receive 403 when opening a SwapUp session by id");

  // 3. SwapMore India administrator CANNOT access SwapUp audit logs (403)
  const auditForbidden = await inRequest(swapmoreIndCookie, () =>
    getPortalAudit(new NextRequest("http://localhost:3000/api/portal/audit?client=swapup")),
  );
  assert.equal(auditForbidden.status, 403, "swapmoreind must receive 403 when querying client=swapup audit trail");

  // 4. SwapMore India administrator default audit query only returns swapmore-in events, never swapup
  const auditInRes = await inRequest(swapmoreIndCookie, () =>
    getPortalAudit(new NextRequest("http://localhost:3000/api/portal/audit")),
  );
  assert.equal(auditInRes.status, 200);
  const auditInData = await auditInRes.json();
  assert.ok(auditInData.rows.length > 0, "swapmore-in audit rows should be returned");
  assert.ok(
    auditInData.rows.every((r) => r.client_id === "swapmore-in"),
    "swapmoreind audit rows must belong exclusively to swapmore-in",
  );

  // 5. SwapMore India administrator CANNOT access SwapUp config or catalog (403)
  const cfgForbidden = await inRequest(swapmoreIndCookie, () =>
    getPortalConfig(new NextRequest("http://localhost:3000/api/portal/config?client=swapup")),
  );
  assert.equal(cfgForbidden.status, 403);
  const catForbidden = await inRequest(swapmoreIndCookie, () =>
    getPortalCatalog(new NextRequest("http://localhost:3000/api/portal/catalog?client=swapup")),
  );
  assert.equal(catForbidden.status, 403);

  // 6. Existing SwapMore India administration remains functional (200)
  const sessionsInOk = await inRequest(swapmoreIndCookie, () =>
    getPortalSessions(new NextRequest("http://localhost:3000/api/portal/sessions?client=swapmore-in")),
  );
  assert.equal(sessionsInOk.status, 200);
  const sessionsInData = await sessionsInOk.json();
  assert.ok(sessionsInData.sessions.every((s) => s.client_id === "swapmore-in"));

  const sessionByIdInOk = await inRequest(swapmoreIndCookie, () =>
    getPortalSessionById(new NextRequest(`http://localhost:3000/api/portal/sessions/${inSession.id}`), {
      params: Promise.resolve({ id: inSession.id }),
    }),
  );
  assert.equal(sessionByIdInOk.status, 200);

  const staffListIn = await inRequest(swapmoreIndCookie, () => listStaffSessions());
  assert.equal(staffListIn.status, 200);
  const staffListInRows = await staffListIn.json();
  assert.ok(staffListInRows.every((s) => s.client_id === "swapmore-in"));

  // 7. Superadmin sees both swapup and swapmore-in separately in Audit and Sessions
  const superAuditUp = await inRequest(superAdminCookie, () =>
    getPortalAudit(new NextRequest("http://localhost:3000/api/portal/audit?client=swapup")),
  );
  assert.equal(superAuditUp.status, 200);
  const superAuditUpData = await superAuditUp.json();
  assert.ok(superAuditUpData.rows.length > 0, "Superadmin sees SwapUp audit events");
  assert.ok(superAuditUpData.rows.every((r) => r.client_id === "swapup"));

  const superAuditIn = await inRequest(superAdminCookie, () =>
    getPortalAudit(new NextRequest("http://localhost:3000/api/portal/audit?client=swapmore-in")),
  );
  assert.equal(superAuditIn.status, 200);
  const superAuditInData = await superAuditIn.json();
  assert.ok(superAuditInData.rows.length > 0, "Superadmin sees SwapMore India audit events");
  assert.ok(superAuditInData.rows.every((r) => r.client_id === "swapmore-in"));
});

console.log(`${pass} passed`);
