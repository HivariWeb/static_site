"use strict";
const fs = require("node:fs"),
  path = require("node:path"),
  os = require("node:os");
const { spawn } = require("node:child_process");
const root = path.resolve(__dirname, ".."),
  out = path.join(root, "audit-2026-10-23", "revision");
fs.mkdirSync(out, { recursive: true });
const stateFile = path.join(root, "audit-2026-10-23", "preview-state.json");
const state = fs.existsSync(stateFile)
  ? JSON.parse(fs.readFileSync(stateFile, "utf8").replace(/^\uFEFF/, ""))
  : {};
const base = process.argv[2] || state.url;
if (!/^http:\/\/(?:127\.0\.0\.1|localhost):\d+$/.test(base))
  throw Error("Use an isolated local preview for submission tests");
const profile = fs.mkdtempSync(path.join(os.tmpdir(), "diana-browser-"));
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
const result = { base, checks: [], screenshots: [] };
let chrome,
  ws,
  current,
  seq = 0;
const pending = new Map();
function assert(condition, message) {
  if (!condition) throw Error(message);
}
function pass(name, detail = {}) {
  result.checks.push({ name, ...detail });
  console.log("PASS " + name);
}
(async () => {
  const logfile = fs.openSync(path.join(out, "chrome.log"), "w");
  chrome = spawn(
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    [
      "--headless=new",
      "--disable-gpu",
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-background-networking",
      "--remote-debugging-port=0",
      "--user-data-dir=" + profile,
      "about:blank",
    ],
    { windowsHide: true, stdio: ["ignore", logfile, logfile] },
  );
  const portfile = path.join(profile, "DevToolsActivePort");
  for (let i = 0; i < 150 && !fs.existsSync(portfile); i++) await delay(100);
  assert(fs.existsSync(portfile), "Chrome did not start");
  const port = fs.readFileSync(portfile, "utf8").split(/\r?\n/)[0];
  const targets = await (
    await fetch("http://127.0.0.1:" + port + "/json/list")
  ).json();
  ws = new WebSocket(
    targets.find((x) => x.type === "page").webSocketDebuggerUrl,
  );
  await new Promise((r, j) => {
    ws.addEventListener("open", r, { once: true });
    ws.addEventListener("error", j, { once: true });
  });
  const call = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = ++seq;
      const timeout = setTimeout(() => {
        pending.delete(id);
        reject(Error("CDP timeout: " + method));
      }, 20000);
      pending.set(id, {
        resolve: (x) => {
          clearTimeout(timeout);
          resolve(x);
        },
        reject: (x) => {
          clearTimeout(timeout);
          reject(x);
        },
      });
      ws.send(JSON.stringify({ id, method, params }));
    });
  ws.addEventListener("message", (event) => {
    const m = JSON.parse(event.data);
    if (m.id) {
      const p = pending.get(m.id);
      if (p) {
        pending.delete(m.id);
        m.error
          ? p.reject(Error(JSON.stringify(m.error)))
          : p.resolve(m.result);
      }
      return;
    }
    if (m.method === "Fetch.requestPaused") {
      call("Fetch.fulfillRequest", {
        requestId: m.params.requestId,
        responseCode: 200,
        responseHeaders: [{ name: "Content-Type", value: "text/javascript" }],
        body: Buffer.from("/* local analytics test stub */").toString("base64"),
      }).catch((e) => {
        throw e;
      });
      return;
    }
    if (!current) return;
    if (m.method === "Runtime.exceptionThrown")
      current.exceptions.push(
        m.params.exceptionDetails.exception?.description ||
          m.params.exceptionDetails.text,
      );
    if (m.method === "Log.entryAdded" && m.params.entry.level === "error")
      current.logErrors.push(m.params.entry.text);
    if (m.method === "Network.requestWillBeSent")
      current.requests.push(m.params.request.url);
    if (
      m.method === "Network.responseReceived" &&
      m.params.response.status >= 400
    )
      current.httpErrors.push({
        url: m.params.response.url,
        status: m.params.response.status,
      });
  });
  const evaluate = async (expression) => {
    const r = await call("Runtime.evaluate", {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (r.exceptionDetails)
      throw Error(
        r.exceptionDetails.exception?.description || r.exceptionDetails.text,
      );
    return r.result.value;
  };
  const waitFor = async (expression, message) => {
    for (let i = 0; i < 100; i++) {
      if (await evaluate(expression)) return;
      await delay(100);
    }
    throw Error(message);
  };
  const navigate = async (url) => {
    current = {
      url,
      exceptions: [],
      logErrors: [],
      requests: [],
      httpErrors: [],
    };
    await call("Page.navigate", { url });
    await waitFor(
      "document.readyState==='complete'",
      "Page did not finish loading",
    );
    await evaluate("document.fonts.ready");
    await delay(150);
  };
  const screenshot = async (name) => {
    const shot = await call("Page.captureScreenshot", {
      format: "png",
      captureBeyondViewport: false,
    });
    fs.writeFileSync(path.join(out, name), Buffer.from(shot.data, "base64"));
    result.screenshots.push(name);
  };
  const viewport = async (width, height) =>
    call("Emulation.setDeviceMetricsOverride", {
      width,
      height,
      deviceScaleFactor: 1,
      mobile: width < 800,
    });
  const noErrors = () => {
    assert(!current.exceptions.length, JSON.stringify(current.exceptions));
    assert(!current.logErrors.length, JSON.stringify(current.logErrors));
    assert(!current.httpErrors.length, JSON.stringify(current.httpErrors));
  };
  const layout = () =>
    evaluate(
      `(()=>{const invalid=[...document.querySelectorAll('body *')].filter(e=>{if(e.closest('dialog:not([open]),[hidden],.spam-field,.screen-reader-only,.skip-link'))return false;const r=e.getBoundingClientRect();return r.width>1&&(r.left< -1||r.right>innerWidth+1)&&getComputedStyle(e).display!=='none';}).map(e=>({tag:e.tagName,class:e.className,right:e.getBoundingClientRect().right,width:e.getBoundingClientRect().width}));const a=document.querySelector('.hero-actions .button'),c=document.querySelector('#cookie-notice');return{width:innerWidth,scrollWidth:document.documentElement.scrollWidth,overflow:invalid.slice(0,12),cta:a?{top:a.getBoundingClientRect().top,bottom:a.getBoundingClientRect().bottom}:null,cookieTop:c&&!c.hidden?c.getBoundingClientRect().top:innerHeight,h1:document.querySelectorAll('h1').length,broken:[...document.images].filter(i=>i.getAttribute('src')&&i.complete&&!i.naturalWidth).map(i=>i.src)};})()`,
    );
  await call("Page.enable");
  await call("Runtime.enable");
  await call("Network.enable");
  await call("Log.enable");
  for (const [width, height] of [
    [320, 740],
    [360, 800],
    [390, 844],
    [768, 1024],
    [1024, 900],
    [1440, 1000],
  ]) {
    await viewport(width, height);
    await navigate(base + "/");
    const info = await layout();
    assert(info.h1 === 1, "Expected one H1");
    assert(
      !info.overflow.length,
      "Home overflow " + width + ": " + JSON.stringify(info.overflow),
    );
    assert(!info.broken.length, "Broken image");
    assert(
      info.cta.bottom < Math.min(height, info.cookieTop),
      "Primary CTA is obscured at " + width,
    );
    noErrors();
    if ([320, 390, 1440].includes(width))
      await screenshot("home-" + width + ".png");
    await evaluate(
      "document.querySelector('#services').scrollIntoView({behavior:'instant'})",
    );
    await delay(120);
    if ([390, 1440].includes(width))
      await screenshot("services-" + width + ".png");
    pass("home layout " + width, info);
  }
  await viewport(390, 844);
  await navigate(base + "/");
  await evaluate("document.querySelector('.menu-toggle').click()");
  assert(
    await evaluate(
      "document.querySelector('.menu-toggle').getAttribute('aria-expanded')==='true'&&!document.querySelector('#site-nav').hidden",
    ),
    "Menu failed to open",
  );
  await call("Input.dispatchKeyEvent", {
    type: "keyDown",
    key: "Escape",
    code: "Escape",
    windowsVirtualKeyCode: 27,
  });
  await call("Input.dispatchKeyEvent", {
    type: "keyUp",
    key: "Escape",
    code: "Escape",
    windowsVirtualKeyCode: 27,
  });
  assert(
    await evaluate(
      "document.querySelector('#site-nav').hidden&&document.activeElement===document.querySelector('.menu-toggle')",
    ),
    "Menu escape/focus failed",
  );
  await evaluate(
    "document.querySelector('.menu-toggle').click();document.querySelector('#site-nav a').click()",
  );
  assert(
    await evaluate(
      "document.querySelector('#site-nav').hidden&&!document.body.classList.contains('menu-open')",
    ),
    "Menu did not close on navigation",
  );
  noErrors();
  pass("menu keyboard and link navigation");
  await evaluate(
    "document.querySelector('.gallery-trigger').focus();document.querySelector('.gallery-trigger').click()",
  );
  await waitFor(
    "document.querySelector('#gallery-dialog').open",
    "Gallery failed to open",
  );
  const firstImage = await evaluate(
    "document.querySelector('.dialog-image').src",
  );
  await call("Input.dispatchKeyEvent", {
    type: "keyDown",
    key: "ArrowRight",
    code: "ArrowRight",
    windowsVirtualKeyCode: 39,
  });
  await call("Input.dispatchKeyEvent", {
    type: "keyUp",
    key: "ArrowRight",
    code: "ArrowRight",
    windowsVirtualKeyCode: 39,
  });
  assert(
    (await evaluate("document.querySelector('.dialog-image').src")) !==
      firstImage,
    "Gallery arrow failed",
  );
  await screenshot("gallery-mobile.png");
  await call("Input.dispatchKeyEvent", {
    type: "keyDown",
    key: "Escape",
    code: "Escape",
    windowsVirtualKeyCode: 27,
  });
  await call("Input.dispatchKeyEvent", {
    type: "keyUp",
    key: "Escape",
    code: "Escape",
    windowsVirtualKeyCode: 27,
  });
  await waitFor(
    "!document.querySelector('#gallery-dialog').open&&document.activeElement===document.querySelector('.gallery-trigger')&&!document.body.classList.contains('dialog-open')",
    "Gallery escape/focus failed",
  );
  noErrors();
  pass("gallery keyboard, close and focus return");
  assert(await evaluate("document.querySelector('#cookie-notice').hidden"), 'Unconfigured analytics should not show a consent banner');
  await evaluate(
    "document.querySelector('[data-cookie-settings]').click();document.querySelector('#cookie-settings [data-analytics-consent=no]').click()",
  );
  await navigate(base + "/");
  assert(
    await evaluate("document.querySelector('#cookie-notice').hidden"),
    "Consent was not persisted",
  );
  assert(
    !current.requests.some((u) => /mc\.yandex\./.test(u)),
    "Analytics loaded after rejection",
  );
  await evaluate("document.querySelector('[data-cookie-settings]').click()");
  assert(
    await evaluate("document.querySelector('#cookie-settings').open"),
    "Cookie settings did not open",
  );
  await evaluate(
    "document.querySelector('#cookie-settings [data-analytics-consent=yes]').click()",
  );
  assert(
    !current.requests.some((u) => /mc\.yandex\./.test(u)),
    "Zero counter ID must not load analytics",
  );
  await evaluate(
    "document.querySelector('[data-cookie-settings]').click();document.querySelector('#cookie-settings [data-analytics-consent=no]').click()",
  );
  noErrors();
  pass("cookie choice persists and zero counter stays disabled");
  for (const width of [320, 390, 768]) {
    await viewport(width, 844);
    for (const page of [
      "offer.html",
      "privacy-policy.html",
      "consent-personal-data.html",
      "consent-request.html",
      "request.php?service=regime",
    ]) {
      await navigate(base + "/" + page);
      const info = await layout();
      assert(
        !info.overflow.length,
        page + " overflow " + width + ": " + JSON.stringify(info.overflow),
      );
      assert(info.h1 === 1, page + " H1 count");
      noErrors();
      if (
        width === 390 &&
        ["privacy-policy.html", "request.php?service=regime"].includes(page)
      )
        await screenshot(
          page.startsWith("request")
            ? "request-mobile.png"
            : "privacy-mobile.png",
        );
    }
    pass("legal pages and request layout " + width);
  }
  await viewport(390, 844);
  await navigate(base + "/request.php?service=regime");
  assert(
    await evaluate("document.querySelector('#service').value==='regime'"),
    "Service choice was not retained",
  );
  await evaluate(
    "document.querySelector('#name').value='Тестовый родитель';document.querySelector('#contact_method').value='email';document.querySelector('#contact_method').dispatchEvent(new Event('change'));document.querySelector('#contact').value='browser-test@example.invalid';document.querySelector('#request-form').requestSubmit()",
  );
  await delay(150);
  assert(
    !current.requests.some((u) => u.endsWith("/api/leads.php")),
    "Unchecked consent was submitted",
  );
  await evaluate(
    "document.querySelector('#consent').checked=true;document.querySelector('#request-form').requestSubmit();document.querySelector('#request-form').requestSubmit()",
  );
  await waitFor(
    "!document.querySelector('#request-success').hidden",
    "Browser form did not succeed",
  );
  assert(
    current.requests.filter((u) => u.endsWith("/api/leads.php")).length === 1,
    "Double submit was not guarded",
  );
  assert(
    await evaluate(
      "document.activeElement===document.querySelector('#request-success')",
    ),
    "Success focus was not announced",
  );
  await screenshot("request-success-mobile.png");
  noErrors();
  pass(
    "browser form, required consent, duplicate guard and success announcement",
  );
  await navigate(base + "/request.php");
  await call("Network.setBlockedURLs", { urls: [base + "/api/leads.php"] });
  await evaluate(
    "document.querySelector('#name').value='Тестовый родитель';document.querySelector('#contact').value='@browser_test';document.querySelector('#consent').checked=true;document.querySelector('#request-form').requestSubmit()",
  );
  await waitFor(
    "!document.querySelector('#form-status').hidden",
    "Network failure was not shown",
  );
  assert(
    await evaluate(
      "!document.querySelector('#request-form').hidden&&document.querySelector('#request-success').hidden&&!document.querySelector('[type=submit]').disabled",
    ),
    "Failure claimed success or locked form",
  );
  await call("Network.setBlockedURLs", { urls: [] });
  pass("network failure keeps form retryable");
  const blocked = await call("Page.addScriptToEvaluateOnNewDocument", {
    source:
      "for(const key of ['localStorage','sessionStorage'])Object.defineProperty(window,key,{get(){throw new DOMException('blocked','SecurityError')}});",
  });
  await navigate(base + "/");
  assert(
    await evaluate("document.documentElement.classList.contains('js')"),
    "Blocked storage broke initialization",
  );
  await evaluate("document.querySelector('.menu-toggle').click()");
  assert(
    await evaluate(
      "document.querySelector('.menu-toggle').getAttribute('aria-expanded')==='true'",
    ),
    "Blocked storage broke menu",
  );
  noErrors();
  await call("Page.removeScriptToEvaluateOnNewDocument", {
    identifier: blocked.identifier,
  });
  pass("blocked browser storage does not break navigation");
  await call("Emulation.setScriptExecutionDisabled", { value: true });
  await navigate(base + "/");
  await screenshot("home-no-javascript.png");
  assert(
    await evaluate(
      "!document.documentElement.classList.contains('js')&&document.querySelectorAll('a[href^=\"/request.php\"]').length>=7",
    ),
    "No-script entry paths missing",
  );
  await call("Emulation.setScriptExecutionDisabled", { value: false });
  pass("no-JavaScript navigation and request links");
  const mock = await call("Page.addScriptToEvaluateOnNewDocument", {
    source:
      "window.__metricCalls=[];Object.defineProperty(window,'DIANA_SITE',{get(){return this.__testSite},set(v){this.__testSite={...v,metrikaId:999999}}});window.ym=function(...args){window.__metricCalls.push(args);if(args[1]==='getClientID')args[2]('123456789')};",
  });
  await call("Fetch.enable", {
    patterns: [
      { urlPattern: "https://mc.yandex.ru/*" },
      { urlPattern: "https://mc.yandex.com/*" },
    ],
  });
  await navigate(
    base +
      "/?utm_source=yandex&utm_campaign=qa&yclid=123456&email=must-not-be-tracked@example.invalid",
  );
  assert(
    !current.requests.some((u) => /mc\.yandex\./.test(u)),
    "Counter loaded without consent",
  );
  await evaluate(
    "document.querySelector('[data-cookie-settings]').click();document.querySelector('#cookie-settings [data-analytics-consent=yes]').click()",
  );
  await delay(100);
  const calls = await evaluate("window.__metricCalls");
  const hit = calls.find((c) => c[1] === "hit");
  assert(
    hit && !hit[2].includes("email=") && hit[2].includes("utm_source=yandex"),
    "Analytics URL filtering failed",
  );
  await evaluate(
    "document.querySelector('[data-service-select=diary]').click()",
  );
  await waitFor(
    "document.readyState==='complete'&&!!document.querySelector('#request-form')",
    "Request navigation failed",
  );
  await evaluate(
    "document.querySelector('#name').value='Тестовый родитель';document.querySelector('#contact').value='@analytics_test';document.querySelector('#consent').checked=true;document.querySelector('#request-form').requestSubmit()",
  );
  await waitFor(
    "!document.querySelector('#request-success').hidden",
    "Analytics form did not succeed",
  );
  const leadGoal = await evaluate(
    "window.__metricCalls.find(c=>c[1]==='reachGoal'&&c[2]==='lead_created')",
  );
  assert(
    leadGoal && Object.keys(leadGoal[3]).join(",") === "service_id",
    "Lead goal missing or contains private data",
  );
  await evaluate(
    "document.querySelector('[data-cookie-settings]').click();document.querySelector('#cookie-settings [data-analytics-consent=no]').click()",
  );
  assert(
    await evaluate("window.__metricCalls.some(c=>c[1]==='destruct')"),
    "Consent withdrawal did not stop counter",
  );
  noErrors();
  await call("Fetch.disable");
  await call("Page.removeScriptToEvaluateOnNewDocument", {
    identifier: mock.identifier,
  });
  pass(
    "analytics consent, sanitized URL, confirmed lead goal and withdrawal (local mock only)",
  );
  await navigate(base + "/");
  await viewport(1440, 1000);
  await screenshot("home-final-desktop.png");
  fs.writeFileSync(
    path.join(out, "browser-results.json"),
    JSON.stringify(result, null, 2),
  );
  console.log(
    JSON.stringify({
      checks: result.checks.length,
      screenshots: result.screenshots.length,
      result: path.join(out, "browser-results.json"),
    }),
  );
  await call("Browser.close");
})()
  .catch((error) => {
    result.error = error.stack;
    fs.writeFileSync(
      path.join(out, "browser-results.json"),
      JSON.stringify(result, null, 2),
    );
    console.error(error.stack);
    process.exitCode = 1;
  })
  .finally(async () => {
    if (ws) ws.close();
    if (chrome && !chrome.killed) chrome.kill();
    await delay(400);
    const resolved = fs.realpathSync(profile),
      temp = fs.realpathSync(os.tmpdir());
    if (
      path.dirname(resolved) === temp &&
      path.basename(resolved).startsWith("diana-browser-")
    )
      fs.rmSync(resolved, {
        recursive: true,
        force: true,
        maxRetries: 10,
        retryDelay: 200,
      });
  });
