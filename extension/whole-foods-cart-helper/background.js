const REVIEW_PAGE = chrome.runtime.getURL("review.html");
const AMAZON_HOSTS = new Set([
  "amazon.com",
  "www.amazon.com",
  "wholefoodsmarket.com",
  "www.wholefoodsmarket.com",
]);

function storageGet(keys) {
  return new Promise((resolve, reject) => {
    chrome.storage.local.get(keys, (value) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      resolve(value);
    });
  });
}

function storageSet(value) {
  return new Promise((resolve, reject) => {
    chrome.storage.local.set(value, () => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      resolve();
    });
  });
}

function createTab(options) {
  return new Promise((resolve, reject) => {
    chrome.tabs.create(options, (tab) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      resolve(tab);
    });
  });
}

function updateTab(tabId, options) {
  return new Promise((resolve, reject) => {
    chrome.tabs.update(tabId, options, (tab) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      resolve(tab);
    });
  });
}

function removeTab(tabId) {
  return new Promise((resolve, reject) => {
    chrome.tabs.remove(tabId, () => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      resolve();
    });
  });
}

function sendTabMessage(tabId, message) {
  return new Promise((resolve) => {
    chrome.tabs.sendMessage(tabId, message, (response) => {
      if (chrome.runtime.lastError) {
        resolve({
          ok: false,
          code: "content_script_unavailable",
          message: chrome.runtime.lastError.message,
        });
        return;
      }
      resolve(response || { ok: false, code: "empty_response" });
    });
  });
}

function cleanText(value, maximum = 160) {
  if (typeof value !== "string") return "";
  return value.replace(/\s+/g, " ").trim().slice(0, maximum);
}

function validProductUrl(value) {
  if (!value) return "";
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    if (url.protocol !== "https:" || !AMAZON_HOSTS.has(host)) return "";
    url.hash = "";
    return url.toString();
  } catch {
    return "";
  }
}

function searchUrl(name) {
  const query = encodeURIComponent(cleanText(name, 100));
  return `https://www.amazon.com/s?k=${query}&i=wholefoods`;
}

function normalizedItems(value, mappings) {
  if (!Array.isArray(value)) return [];
  const normalized = [];
  const byId = new Map();
  value.slice(0, 100).forEach((item) => {
    const id = Number(item?.id);
    const name = cleanText(item?.name, 100);
    const quantity = Number(item?.quantity);
    const unit = cleanText(item?.unit, 30);
    if (!Number.isInteger(id) || id <= 0 || !name) return;
    if (!Number.isFinite(quantity) || quantity <= 0 || !unit) return;
    const existing = byId.get(id);
    if (existing) {
      const sameUnit = existing.requirements.find(
        (requirement) => requirement.unit.toLocaleLowerCase() === unit.toLocaleLowerCase()
      );
      if (sameUnit) sameUnit.quantity += quantity;
      else existing.requirements.push({ quantity, unit });
      return;
    }
    const mapping = mappings[String(id)] || {};
    const normalizedItem = {
      id,
      name,
      requiredQuantity: quantity,
      requiredUnit: unit,
      requirements: [{ quantity, unit }],
      included: true,
      productUrl: validProductUrl(mapping.url),
      productTitle: cleanText(mapping.title, 200),
      status: validProductUrl(mapping.url) ? "ready" : "needs_mapping",
      resultMessage: "",
    };
    normalized.push(normalizedItem);
    byId.set(id, normalizedItem);
  });
  return normalized;
}

function formatQuantity(value) {
  return Number.isInteger(value)
    ? String(value)
    : Number(value).toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
}

function requiredText(item) {
  const requirements = Array.isArray(item.requirements) && item.requirements.length
    ? item.requirements
    : [{ quantity: item.requiredQuantity, unit: item.requiredUnit }];
  return requirements
    .map((requirement) => `${formatQuantity(Number(requirement.quantity))} ${cleanText(requirement.unit, 30)}`)
    .join(" + ");
}

async function openReviewPage() {
  const { reviewTabId } = await storageGet(["reviewTabId"]);
  if (reviewTabId) {
    try {
      return await updateTab(reviewTabId, { url: REVIEW_PAGE, active: true });
    } catch {
      await storageSet({ reviewTabId: null });
    }
  }
  const tab = await createTab({ url: REVIEW_PAGE, active: true });
  await storageSet({ reviewTabId: tab.id });
  return tab;
}

async function startJob(items, weekStart) {
  const { productMappings = {} } = await storageGet(["productMappings"]);
  const normalized = normalizedItems(items, productMappings);
  if (!normalized.length) {
    return { ok: false, error: "The Whole Foods shopping list is empty." };
  }
  const job = {
    id: crypto.randomUUID(),
    weekStart: cleanText(weekStart, 10),
    createdAt: new Date().toISOString(),
    status: "review",
    currentIndex: -1,
    automationTabId: null,
    items: normalized,
  };
  await storageSet({ currentJob: job });
  await openReviewPage();
  return { ok: true, itemCount: normalized.length, jobId: job.id };
}

async function saveJob(job) {
  await storageSet({ currentJob: job });
}

async function runNextItem() {
  const { currentJob: job } = await storageGet(["currentJob"]);
  if (!job || job.status !== "running") return;

  let nextIndex = job.items.findIndex(
    (item, index) =>
      index > job.currentIndex &&
      item.included &&
      item.productUrl &&
      !["added", "failed"].includes(item.status)
  );
  if (nextIndex < 0) {
    job.status = "complete";
    job.currentIndex = -1;
    job.completedAt = new Date().toISOString();
    await saveJob(job);
    await openReviewPage();
    return;
  }

  job.currentIndex = nextIndex;
  job.items[nextIndex].status = "opening";
  job.items[nextIndex].resultMessage = "";
  const url = validProductUrl(job.items[nextIndex].productUrl);
  if (!url) {
    job.items[nextIndex].status = "failed";
    job.items[nextIndex].resultMessage = "The saved product URL is no longer valid.";
    await saveJob(job);
    return runNextItem();
  }

  let tabId = job.automationTabId;
  if (!tabId) {
    try {
      const tab = await createTab({ url: "about:blank", active: true });
      tabId = tab.id;
      job.automationTabId = tabId;
      await saveJob(job);
    } catch (error) {
      job.items[nextIndex].status = "failed";
      job.items[nextIndex].resultMessage = `Could not open an Amazon tab: ${error.message}`;
      await saveJob(job);
      return runNextItem();
    }
  }

  try {
    await updateTab(tabId, { url, active: true });
  } catch {
    try {
      const tab = await createTab({ url: "about:blank", active: true });
      job.automationTabId = tab.id;
      await saveJob(job);
      await updateTab(tab.id, { url, active: true });
    } catch (error) {
      job.items[nextIndex].status = "failed";
      job.items[nextIndex].resultMessage = `Could not open the saved product: ${error.message}`;
      await saveJob(job);
      return runNextItem();
    }
  }
}

async function beginAutomation() {
  const { currentJob: job } = await storageGet(["currentJob"]);
  if (!job) return { ok: false, error: "No cart plan is available." };
  const runnable = job.items.filter(
    (item) => item.included && validProductUrl(item.productUrl)
  );
  if (!runnable.length) {
    return { ok: false, error: "Map at least one product before populating the cart." };
  }
  job.status = "running";
  job.currentIndex = -1;
  job.items = job.items.map((item) => ({
    ...item,
    status: item.included
      ? (item.productUrl ? "ready" : "needs_mapping")
      : "skipped",
    resultMessage: "",
  }));
  await saveJob(job);
  await runNextItem();
  return { ok: true, itemCount: runnable.length };
}

async function chooseProduct(ingredientId) {
  const { currentJob: job } = await storageGet(["currentJob"]);
  const item = job?.items.find((candidate) => candidate.id === Number(ingredientId));
  if (!item) return { ok: false, error: "Ingredient not found in the current cart plan." };
  const chooser = {
    ingredientId: item.id,
    ingredientName: item.name,
    startedAt: new Date().toISOString(),
    reviewPage: REVIEW_PAGE,
  };
  let tab;
  try {
    tab = await createTab({ url: "about:blank", active: true });
    chooser.tabId = tab.id;
    await storageSet({ chooser });
    await updateTab(tab.id, { url: searchUrl(item.name), active: true });
    return { ok: true };
  } catch (error) {
    await storageSet({ chooser: null });
    if (tab?.id) removeTab(tab.id).catch(() => {});
    return { ok: false, error: `The product chooser could not open: ${error.message}` };
  }
}

async function saveMapping(message, sender) {
  const { chooser, productMappings = {}, currentJob: job } = await storageGet([
    "chooser",
    "productMappings",
    "currentJob",
  ]);
  const ingredientId = Number(message.ingredientId);
  const url = validProductUrl(message.url);
  const title = cleanText(message.title, 200);
  if (
    !chooser ||
    chooser.ingredientId !== ingredientId ||
    chooser.tabId !== sender.tab?.id ||
    !url
  ) {
    return { ok: false, error: "The selected product could not be saved." };
  }
  productMappings[String(ingredientId)] = {
    url,
    title,
    updatedAt: new Date().toISOString(),
  };
  if (job) {
    const item = job.items.find((candidate) => candidate.id === ingredientId);
    if (item) {
      item.productUrl = url;
      item.productTitle = title;
      item.status = "ready";
      item.resultMessage = "";
    }
  }
  const updates = { productMappings, chooser: null };
  if (job) updates.currentJob = job;
  await storageSet(updates);
  await openReviewPage();
  if (sender.tab?.id) {
    setTimeout(() => removeTab(sender.tab.id).catch(() => {}), 250);
  }
  return { ok: true };
}

async function handleAmazonReady(sender) {
  const { currentJob: job } = await storageGet(["currentJob"]);
  if (
    !job ||
    job.status !== "running" ||
    sender.tab?.id !== job.automationTabId ||
    job.currentIndex < 0
  ) {
    return { ok: true, active: false };
  }
  const item = job.items[job.currentIndex];
  item.status = "adding";
  await saveJob(job);
  const result = await sendTabMessage(sender.tab.id, {
    type: "ADD_CURRENT_ITEM",
    item: {
      id: item.id,
      name: item.name,
      requiredQuantity: item.requiredQuantity,
      requiredUnit: item.requiredUnit,
      requiredText: requiredText(item),
    },
  });
  const latest = (await storageGet(["currentJob"])).currentJob;
  if (!latest || latest.id !== job.id) return { ok: false };
  const latestItem = latest.items[latest.currentIndex];
  latestItem.status = result?.ok ? "added" : "failed";
  latestItem.resultMessage = cleanText(
    result?.message || (result?.ok ? "Clicked Add to Cart." : "Could not add this product."),
    240
  );
  await saveJob(latest);
  setTimeout(runNextItem, 900);
  return { ok: true, active: true };
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const respond = (promise) => {
    promise.then(sendResponse).catch((error) => {
      sendResponse({ ok: false, error: error.message || "Unexpected extension error." });
    });
  };

  switch (message?.type) {
    case "START_CART_JOB":
      respond(startJob(message.items, message.weekStart));
      return true;
    case "OPEN_REVIEW":
      respond(openReviewPage().then(() => ({ ok: true })));
      return true;
    case "BEGIN_AUTOMATION":
      respond(beginAutomation());
      return true;
    case "CHOOSE_PRODUCT":
      respond(chooseProduct(message.ingredientId));
      return true;
    case "GET_CHOOSER":
      respond(
        storageGet(["chooser"]).then(({ chooser }) => ({
          ok: true,
          chooser: chooser?.tabId === sender.tab?.id ? chooser : null,
        }))
      );
      return true;
    case "SAVE_PRODUCT_MAPPING":
      respond(saveMapping(message, sender));
      return true;
    case "CANCEL_PRODUCT_MAPPING":
      respond(
        storageGet(["chooser"]).then(({ chooser }) => {
          if (chooser?.tabId !== sender.tab?.id) {
            return { ok: false, error: "This product chooser is no longer active." };
          }
          return storageSet({ chooser: null }).then(() => ({ ok: true }));
        })
      );
      return true;
    case "AMAZON_PAGE_READY":
      respond(handleAmazonReady(sender));
      return true;
    default:
      return false;
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  storageGet(["reviewTabId", "currentJob", "chooser"])
    .then(async ({ reviewTabId, currentJob, chooser }) => {
      const updates = {};
      if (reviewTabId === tabId) updates.reviewTabId = null;
      if (chooser?.tabId === tabId) updates.chooser = null;
      if (currentJob?.automationTabId === tabId) {
        currentJob.automationTabId = null;
        if (currentJob.status === "running") {
          currentJob.status = "review";
          const item = currentJob.items[currentJob.currentIndex];
          if (item && ["opening", "adding"].includes(item.status)) {
            item.status = "failed";
            item.resultMessage = "The Amazon tab was closed before this item was added.";
          }
        }
        updates.currentJob = currentJob;
      }
      if (Object.keys(updates).length) await storageSet(updates);
    })
    .catch(() => {});
});
