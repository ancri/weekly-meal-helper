const emptyState = document.querySelector("#empty-state");
const jobView = document.querySelector("#job-view");
const itemTable = document.querySelector("#cart-items");
const startButton = document.querySelector("#start-cart");
const stopButton = document.querySelector("#stop-cart");
const statusTarget = document.querySelector("#job-status");

function storageGet(keys) {
  return new Promise((resolve) => chrome.storage.local.get(keys, resolve));
}

function storageSet(value) {
  return new Promise((resolve) => chrome.storage.local.set(value, resolve));
}

function runtimeMessage(message) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(message, (response) => {
      if (chrome.runtime.lastError) {
        resolve({ ok: false, error: chrome.runtime.lastError.message });
        return;
      }
      resolve(response || { ok: false });
    });
  });
}

function formatQuantity(value) {
  const numeric = Number(value);
  return Number.isInteger(numeric)
    ? String(numeric)
    : numeric.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
}

function formatRequirements(item) {
  const requirements = Array.isArray(item.requirements) && item.requirements.length
    ? item.requirements
    : [{ quantity: item.requiredQuantity, unit: item.requiredUnit }];
  return requirements
    .map((requirement) => `${formatQuantity(requirement.quantity)} ${requirement.unit}`)
    .join(" + ");
}

function statusLabel(status) {
  return {
    ready: "Ready",
    needs_mapping: "Needs product",
    opening: "Opening",
    adding: "Adding",
    added: "Add clicked",
    failed: "Needs review",
    skipped: "Skipped",
  }[status] || "Pending";
}

function cell(tag = "td") {
  return document.createElement(tag);
}

async function setIncluded(ingredientId, included) {
  const { currentJob: job } = await storageGet(["currentJob"]);
  if (!job) return;
  const item = job.items.find((candidate) => candidate.id === ingredientId);
  if (!item) return;
  item.included = included;
  item.status = included
    ? (item.productUrl ? "ready" : "needs_mapping")
    : "skipped";
  item.resultMessage = "";
  await storageSet({ currentJob: job });
}

function itemRow(item, jobRunning) {
  const row = document.createElement("tr");

  const includeCell = cell();
  const checkbox = document.createElement("input");
  checkbox.type = "checkbox";
  checkbox.checked = Boolean(item.included);
  checkbox.disabled = jobRunning;
  checkbox.setAttribute("aria-label", `Include ${item.name}`);
  checkbox.addEventListener("change", () => setIncluded(item.id, checkbox.checked));
  includeCell.append(checkbox);
  row.append(includeCell);

  const nameCell = cell();
  const name = document.createElement("strong");
  name.className = "ingredient-name";
  name.textContent = item.name;
  nameCell.append(name);
  row.append(nameCell);

  const neededCell = cell();
  neededCell.textContent = formatRequirements(item);
  row.append(neededCell);

  const productCell = cell();
  const productActions = document.createElement("div");
  productActions.className = "product-actions";
  if (item.productUrl) {
    const link = document.createElement("a");
    link.className = "product-title";
    link.href = item.productUrl;
    link.target = "_blank";
    link.rel = "noopener";
    link.textContent = item.productTitle || "Saved Whole Foods product";
    productActions.append(link);
  } else {
    const missing = document.createElement("span");
    missing.textContent = "No preferred product";
    missing.style.color = "#64716e";
    productActions.append(missing);
  }
  const choose = document.createElement("button");
  choose.type = "button";
  choose.className = "text-button";
  choose.textContent = item.productUrl ? "Change" : "Choose product";
  choose.disabled = jobRunning;
  choose.addEventListener("click", async () => {
    choose.disabled = true;
    statusTarget.textContent = `Opening Whole Foods search for ${item.name}...`;
    const response = await runtimeMessage({
      type: "CHOOSE_PRODUCT",
      ingredientId: item.id,
    });
    if (!response.ok) {
      choose.disabled = false;
      statusTarget.textContent = response.error || "The product chooser could not open.";
    }
  });
  productActions.append(choose);
  productCell.append(productActions);
  row.append(productCell);

  const stateCell = cell();
  const badge = document.createElement("span");
  badge.className = `status ${item.status}`;
  badge.textContent = statusLabel(item.status);
  stateCell.append(badge);
  if (item.resultMessage) {
    const result = document.createElement("span");
    result.className = "result-message";
    result.textContent = item.resultMessage;
    stateCell.append(result);
  }
  row.append(stateCell);
  return row;
}

async function render() {
  const { currentJob: job } = await storageGet(["currentJob"]);
  emptyState.classList.toggle("hidden", Boolean(job));
  jobView.classList.toggle("hidden", !job);
  if (!job) return;

  const running = job.status === "running";
  const mapped = job.items.filter(
    (item) => item.included && item.productUrl
  ).length;
  const included = job.items.filter((item) => item.included).length;
  document.querySelector("#job-heading").textContent =
    job.status === "complete" ? "Cart pass complete" : "Review products";
  document.querySelector("#job-summary").textContent =
    `${included} included, ${mapped} mapped to preferred products`;
  startButton.disabled = running || mapped === 0;
  stopButton.classList.toggle("hidden", !running);
  startButton.textContent = running
    ? "Populating..."
    : (job.status === "complete" ? "Run again" : `Populate ${mapped} mapped item${mapped === 1 ? "" : "s"}`);

  itemTable.replaceChildren(
    ...job.items.map((item) => itemRow(item, running))
  );
  statusTarget.textContent = running
    ? "Keep this tab open while the helper visits each mapped product."
    : job.status === "complete"
      ? "Review the Whole Foods cart in Amazon. Items marked Needs review require manual attention."
      : "Choose products for unmapped ingredients, then populate the cart.";
}

startButton.addEventListener("click", async () => {
  startButton.disabled = true;
  statusTarget.textContent = "Starting Whole Foods cart population...";
  const response = await runtimeMessage({ type: "BEGIN_AUTOMATION" });
  if (!response.ok) {
    startButton.disabled = false;
    statusTarget.textContent = response.error || "The cart helper could not start.";
  }
});

stopButton.addEventListener("click", async () => {
  stopButton.disabled = true;
  statusTarget.textContent = "Stopping cart population...";
  const response = await runtimeMessage({ type: "CANCEL_AUTOMATION" });
  stopButton.disabled = false;
  if (!response.ok) {
    statusTarget.textContent = response.error || "The cart helper could not stop.";
  }
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === "local" && changes.currentJob) render();
});

render();
