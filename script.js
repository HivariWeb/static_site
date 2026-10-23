"use strict";

(() => {
  const config = window.DIANA_SITE || {};
  const consentKey = "diana.consent.v1";
  const sourceKey = "diana.source.v1";
  const receiptKey = "diana.receipts.v1";
  const localStore = (() => {
    try {
      return window.localStorage;
    } catch {
      return null;
    }
  })();
  const sessionStore = (() => {
    try {
      return window.sessionStorage;
    } catch {
      return null;
    }
  })();
  const consentVersion = config.consentVersion || "2026-10-23";
  const counterId = Number(config.metrikaId);
  const hasCounter = Number.isSafeInteger(counterId) && counterId > 0;
  const knownServices = new Set([
    "help",
    "diary",
    "regime",
    "associations",
    "support-3",
    "support-5",
    "extended",
  ]);
  const sourceKeys = [
    "utm_source",
    "utm_medium",
    "utm_campaign",
    "utm_content",
    "utm_term",
    "yclid",
  ];
  const goalNames = new Set([
    "service_view",
    "service_select",
    "contact_click",
    "lead_created",
  ]);
  let trackerStarted = false;
  let consent = readStorage(localStore, consentKey);
  if (
    !consent ||
    consent.version !== consentVersion ||
    typeof consent.analytics !== "boolean"
  )
    consent = null;

  function readStorage(storage, key) {
    try {
      return JSON.parse(storage.getItem(key) || "null");
    } catch {
      return null;
    }
  }
  function writeStorage(storage, key, value) {
    try {
      storage.setItem(key, JSON.stringify(value));
    } catch {
      /* A blocked store must not break the page. */
    }
  }
  function removeStorage(storage, key) {
    try {
      storage.removeItem(key);
    } catch {
      /* Consent still applies in memory. */
    }
  }
  function analyticsAllowed() {
    return consent?.analytics === true;
  }
  function cleanSourceValue(value) {
    return String(value || "")
      .replace(/[\u0000-\u001f\u007f<>]/g, "")
      .slice(0, 200);
  }
  const incomingSource = {};
  const query = new URLSearchParams(location.search);
  sourceKeys.forEach((key) => {
    const value = cleanSourceValue(query.get(key));
    if (value && (key !== "yclid" || /^\d{1,30}$/.test(value)))
      incomingSource[key] = value;
  });
  function campaignSource() {
    if (!analyticsAllowed()) return {};
    let saved = readStorage(sessionStore, sourceKey);
    const lifetime = Number(config.sourceLifetimeMs) || 1800000;
    if (
      !saved ||
      Date.now() - saved.time > lifetime ||
      Object.keys(incomingSource).length
    ) {
      saved = { time: Date.now(), values: incomingSource };
      writeStorage(sessionStore, sourceKey, saved);
    }
    return saved.values && typeof saved.values === "object" ? saved.values : {};
  }
  function trackGoal(name, values = {}) {
    if (
      !analyticsAllowed() ||
      !hasCounter ||
      !trackerStarted ||
      !goalNames.has(name)
    )
      return false;
    const safe = {};
    if (knownServices.has(values.service_id))
      safe.service_id = values.service_id;
    if (["telegram", "whatsapp", "email", "vk", "max"].includes(values.channel))
      safe.channel = values.channel;
    window.ym(counterId, "reachGoal", name, safe);
    return true;
  }
  function startAnalytics() {
    campaignSource();
    if (!analyticsAllowed() || !hasCounter || trackerStarted) return;
    trackerStarted = true;
    window.ym =
      window.ym ||
      function () {
        (window.ym.a = window.ym.a || []).push(arguments);
      };
    window.ym.l = Date.now();
    const script = document.createElement("script");
    script.async = true;
    script.src = "https://mc.yandex.ru/metrika/tag.js";
    script.onerror = () => {
      trackerStarted = false;
    };
    document.head.append(script);
    window.ym(counterId, "init", {
      defer: true,
      webvisor: false,
      clickmap: false,
      trackLinks: false,
      accurateTrackBounce: true,
      sendTitle: false,
      disableYtm: true,
    });
    const page = new URL(location.pathname, location.origin);
    // Unrecognized URL parameters, form values and receipt IDs never go to the counter.
    Object.entries(campaignSource()).forEach(([key, value]) => {
      if (sourceKeys.includes(key))
        page.searchParams.set(key, cleanSourceValue(value));
    });
    let referer = "";
    try {
      referer = document.referrer ? new URL(document.referrer).origin : "";
    } catch {
      /* No referrer. */
    }
    window.ym(counterId, "hit", page.href, { referer, title: "" });
  }
  function stopAnalytics() {
    if (trackerStarted && typeof window.ym === "function")
      window.ym(counterId, "destruct");
    trackerStarted = false;
    removeStorage(sessionStore, sourceKey);
    removeStorage(sessionStore, receiptKey);
    document.cookie.split(";").forEach((item) => {
      const name = item.split("=")[0].trim();
      if (!/^_ym_[a-z0-9_]+$/i.test(name)) return;
      [
        undefined,
        location.hostname,
        "." + location.hostname,
        ".dianaberezovskaya.online",
      ].forEach((domain) => {
        document.cookie = `${name}=; Max-Age=0; Path=/; SameSite=Lax${domain ? "; Domain=" + domain : ""}`;
      });
    });
  }
  function setConsent(allowed) {
    consent = {
      version: consentVersion,
      analytics: allowed,
      time: new Date().toISOString(),
    };
    writeStorage(localStore, consentKey, consent);
    document.querySelector("#cookie-notice")?.setAttribute("hidden", "");
    const settings = document.querySelector("#cookie-settings");
    if (settings?.open) settings.close();
    if (allowed) startAnalytics();
    else stopAnalytics();
  }

  document.documentElement.classList.add("js");
  const menuButton = document.querySelector(".menu-toggle");
  const navigation = document.querySelector("#site-nav");
  const backdrop = document.querySelector(".menu-backdrop");
  const mobile = matchMedia("(max-width: 900px)");
  function setMenu(open, returnFocus = false) {
    if (!menuButton || !navigation) return;
    const expanded = Boolean(open && mobile.matches);
    menuButton.setAttribute("aria-expanded", String(expanded));
    menuButton.setAttribute(
      "aria-label",
      expanded ? "Закрыть меню" : "Открыть меню",
    );
    navigation.hidden = mobile.matches && !expanded;
    if (backdrop) backdrop.hidden = !expanded;
    document.body.classList.toggle("menu-open", expanded);
    if (returnFocus) menuButton.focus();
  }
  menuButton?.addEventListener("click", () =>
    setMenu(menuButton.getAttribute("aria-expanded") !== "true"),
  );
  navigation
    ?.querySelectorAll("a")
    .forEach((link) => link.addEventListener("click", () => setMenu(false)));
  backdrop?.addEventListener("click", () => setMenu(false, true));
  mobile.addEventListener("change", () => setMenu(false));
  setMenu(false);
  document.addEventListener("keydown", (event) => {
    if (menuButton?.getAttribute("aria-expanded") !== "true") return;
    if (event.key === "Escape") {
      setMenu(false, true);
      return;
    }
    if (event.key !== "Tab") return;
    const controls = [menuButton, ...navigation.querySelectorAll("a[href]")];
    const first = controls[0],
      last = controls[controls.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  });

  const gallery = document.querySelector("#gallery-dialog");
  let galleryItems = [],
    galleryIndex = 0,
    galleryOpener;
  function updateDialogLock() {
    document.body.classList.toggle(
      "dialog-open",
      Boolean(document.querySelector("dialog[open]")),
    );
  }
  function showImage(index) {
    galleryIndex = (index + galleryItems.length) % galleryItems.length;
    const item = galleryItems[galleryIndex];
    const image = gallery.querySelector(".dialog-image");
    image.src = item.href;
    image.alt = item.querySelector("img")?.alt || "";
    gallery.querySelector("#gallery-caption").textContent = image.alt;
    gallery.querySelector(".dialog-counter").textContent =
      `${galleryIndex + 1} / ${galleryItems.length}`;
  }
  document.querySelectorAll(".gallery-trigger").forEach((link) => {
    link.addEventListener("click", (event) => {
      if (!gallery || typeof gallery.showModal !== "function") return;
      event.preventDefault();
      galleryItems = [...document.querySelectorAll(".gallery-trigger")].filter(
        (item) => item.dataset.gallery === link.dataset.gallery,
      );
      galleryOpener = link;
      showImage(galleryItems.indexOf(link));
      gallery.showModal();
      updateDialogLock();
    });
  });
  gallery
    ?.querySelector("[data-gallery-prev]")
    ?.addEventListener("click", () => showImage(galleryIndex - 1));
  gallery
    ?.querySelector("[data-gallery-next]")
    ?.addEventListener("click", () => showImage(galleryIndex + 1));
  gallery?.addEventListener("keydown", (event) => {
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      event.preventDefault();
      showImage(galleryIndex + (event.key === "ArrowLeft" ? -1 : 1));
    }
  });
  gallery?.addEventListener("close", () => {
    updateDialogLock();
    galleryOpener?.focus({ preventScroll: true });
  });
  document.querySelectorAll("dialog").forEach((dialog) => {
    dialog
      .querySelectorAll("[data-dialog-close]")
      .forEach((button) =>
        button.addEventListener("click", () => dialog.close()),
      );
    dialog.addEventListener("click", (event) => {
      if (event.target === dialog) dialog.close();
    });
    dialog.addEventListener("close", updateDialogLock);
  });
  document.querySelectorAll("[data-analytics-consent]").forEach((button) => {
    button.addEventListener("click", () =>
      setConsent(button.dataset.analyticsConsent === "yes"),
    );
  });
  document.querySelectorAll("[data-cookie-settings]").forEach((button) => {
    button.addEventListener("click", () => {
      const dialog = document.querySelector("#cookie-settings");
      if (dialog && typeof dialog.showModal === "function") {
        dialog.showModal();
        updateDialogLock();
      } else
        document.querySelector("#cookie-notice")?.removeAttribute("hidden");
    });
  });
  if (!consent && hasCounter)
    document.querySelector("#cookie-notice")?.removeAttribute("hidden");
  else if (analyticsAllowed()) startAnalytics();
  else stopAnalytics();

  document.querySelectorAll("[data-contact-channel]").forEach((link) => {
    link.addEventListener("click", () =>
      trackGoal("contact_click", { channel: link.dataset.contactChannel }),
    );
  });
  document.querySelectorAll("[data-service-select]").forEach((link) => {
    link.addEventListener("click", () =>
      trackGoal("service_select", { service_id: link.dataset.serviceSelect }),
    );
  });
  if ("IntersectionObserver" in window) {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (
            entry.isIntersecting &&
            trackGoal("service_view", {
              service_id: entry.target.dataset.serviceId,
            })
          )
            observer.unobserve(entry.target);
        });
      },
      { threshold: 0.35 },
    );
    document
      .querySelectorAll("[data-service-id]")
      .forEach((card) => observer.observe(card));
  }

  const form = document.querySelector("#request-form");
  if (!form) return;
  const method = form.elements.namedItem("contact_method");
  const contact = form.elements.namedItem("contact");
  const contactLabel = document.querySelector("#contact-label");
  const contactHint = document.querySelector("#contact-hint");
  function updateContact() {
    if (!method || !contact) return;
    const options = {
      telegram: [
        "Ваш Telegram",
        "@username или номер телефона",
        "Например, @username. Проверьте, что вам можно написать.",
        "text",
        "text",
        "off",
      ],
      whatsapp: [
        "Номер для WhatsApp",
        "+7 999 123-45-67",
        "Укажите номер с кодом страны.",
        "tel",
        "tel",
        "tel",
      ],
      email: [
        "Электронная почта",
        "name@example.ru",
        "На этот адрес я отвечу на вашу заявку.",
        "email",
        "email",
        "email",
      ],
    };
    const selected = options[method.value] || options.telegram;
    contactLabel.textContent = selected[0];
    contact.placeholder = selected[1];
    contactHint.textContent = selected[2];
    contact.type = selected[3];
    contact.inputMode = selected[4];
    contact.autocomplete = selected[5];
  }
  method?.addEventListener("change", updateContact);
  updateContact();
  const serviceSelect = form.elements.namedItem("service");
  const serviceHint = document.querySelector("#service-hint");
  serviceSelect?.addEventListener("change", () => {
    if (serviceHint) serviceHint.textContent = serviceSelect.selectedOptions[0]?.dataset.fullLabel || "";
  });
  function getClientId() {
    return new Promise((resolve) => {
      if (!analyticsAllowed() || !trackerStarted || !hasCounter) {
        resolve("");
        return;
      }
      const timeout = setTimeout(() => resolve(""), 700);
      window.ym(counterId, "getClientID", (value) => {
        clearTimeout(timeout);
        resolve(/^\d{1,40}$/.test(String(value)) ? String(value) : "");
      });
    });
  }
  form.addEventListener("submit", async (event) => {
    if (!window.fetch || !window.FormData) return;
    event.preventDefault();
    if (form.dataset.submitting === "true") return;
    if (!form.reportValidity()) return;
    form.dataset.submitting = "true";
    const submit = form.querySelector("[type=submit]");
    const status = document.querySelector("#form-status");
    const originalLabel = submit.textContent;
    submit.disabled = true;
    submit.textContent = "Отправляем…";
    status.hidden = true;
    form
      .querySelectorAll("[aria-invalid]")
      .forEach((field) => field.removeAttribute("aria-invalid"));
    form.querySelectorAll(".field-error").forEach((error) => {
      error.textContent = "";
      error.hidden = true;
    });
    try {
      const data = new FormData(form);
      data.set("analytics_consent", analyticsAllowed() ? "1" : "0");
      data.set(
        "attribution",
        JSON.stringify(
          analyticsAllowed()
            ? { ...campaignSource(), client_id: await getClientId() }
            : {},
        ),
      );
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 20000);
      let response;
      try {
        response = await fetch(form.action, {
          method: "POST",
          body: data,
          headers: { Accept: "application/json" },
          credentials: "same-origin",
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timeout);
      }
      const result = await response.json();
      if (!response.ok || !result.ok) {
        const errors =
          result.errors && typeof result.errors === "object"
            ? result.errors
            : {};
        Object.entries(errors).forEach(([name, message]) => {
          if (
            ![
              "name",
              "contact",
              "contact_method",
              "service",
              "consent",
            ].includes(name)
          )
            return;
          const field = form.elements.namedItem(name);
          const output = document.querySelector("#error-" + name);
          if (field) field.setAttribute("aria-invalid", "true");
          if (output) {
            output.textContent = String(message);
            output.hidden = false;
          }
        });
        throw new Error(
          result.message ||
            "Не удалось отправить заявку. Попробуйте ещё раз или напишите мне напрямую.",
        );
      }
      const service = String(data.get("service"));
      const receipt = document.querySelector("#request-success");
      receipt.querySelector("[data-receipt]").textContent = result.lead_id;
      form.hidden = true;
      receipt.hidden = false;
      receipt.focus();
      const seen = readStorage(sessionStore, receiptKey) || [];
      if (
        analyticsAllowed() &&
        Array.isArray(seen) &&
        !seen.includes(result.lead_id)
      ) {
        trackGoal("lead_created", { service_id: service });
        writeStorage(sessionStore, receiptKey, [
          ...seen.slice(-19),
          result.lead_id,
        ]);
      }
    } catch (error) {
      status.textContent =
        error.name === "AbortError"
          ? "Подтверждение задержалось. Повторите отправку: одна и та же заявка не будет создана дважды. Можно также связаться со мной напрямую."
          : error instanceof SyntaxError || error instanceof TypeError
            ? "Не удалось связаться с сайтом. Проверьте соединение, повторите отправку или напишите мне напрямую."
            : error.message;
      status.className = "form-status form-status--error";
      status.hidden = false;
      status.focus();
    } finally {
      form.dataset.submitting = "false";
      submit.disabled = false;
      submit.textContent = originalLabel;
    }
  });
})();
