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

function mergeRequirement(requirements, quantity, unit) {
  const existing = requirements.find(
    (requirement) => requirement.unit.toLocaleLowerCase() === unit.toLocaleLowerCase()
  );
  if (existing) existing.quantity += quantity;
  else requirements.push({ quantity, unit });
}

function formatRequirementList(requirements) {
  return requirements
    .map((requirement) => `${formatQuantity(requirement.quantity)} ${requirement.unit}`)
    .join(" + ");
}

function recipeGroups(items) {
  const groups = new Map();
  const appearances = new Map();

  items.forEach((item) => {
    const sources = Array.isArray(item.recipes) && item.recipes.length
      ? item.recipes
      : [{
          id: 0,
          name: "Other ingredients",
          position: Number.MAX_SAFE_INTEGER,
          requirements: Array.isArray(item.requirements) ? item.requirements : [],
        }];

    sources.forEach((source) => {
      const recipeId = Number(source.id) || 0;
      const key = recipeId ? `recipe:${recipeId}` : "other";
      let group = groups.get(key);
      if (!group) {
        group = {
          id: recipeId,
          name: source.name || "Other ingredients",
          position: Number.isInteger(Number(source.position))
            ? Number(source.position)
            : Number.MAX_SAFE_INTEGER,
          items: new Map(),
        };
        groups.set(key, group);
      }
      let occurrence = group.items.get(item.id);
      if (!occurrence) {
        occurrence = { item, requirements: [] };
        group.items.set(item.id, occurrence);
        appearances.set(item.id, (appearances.get(item.id) || 0) + 1);
      }
      if (Array.isArray(source.requirements)) {
        source.requirements.forEach((requirement) => {
          mergeRequirement(
            occurrence.requirements,
            Number(requirement.quantity),
            requirement.unit
          );
        });
      } else {
        mergeRequirement(
          occurrence.requirements,
          Number(source.quantity),
          source.unit
        );
      }
    });
  });

  const seen = new Set();
  return [...groups.values()]
    .sort((first, second) => first.position - second.position
      || first.name.localeCompare(second.name))
    .map((group) => ({
      ...group,
      items: [...group.items.values()]
        .sort((first, second) => first.item.name.localeCompare(second.item.name))
        .map((occurrence) => {
          const duplicate = seen.has(occurrence.item.id);
          seen.add(occurrence.item.id);
          return {
            ...occurrence,
            duplicate,
            shared: (appearances.get(occurrence.item.id) || 0) > 1,
          };
        }),
    }));
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

function groupRow(group) {
  const row = document.createElement("tr");
  row.className = "recipe-group-row";
  const heading = cell("th");
  heading.colSpan = 5;
  heading.scope = "rowgroup";
  const title = document.createElement("strong");
  title.textContent = group.name;
  const count = document.createElement("span");
  count.textContent = `${group.items.length} ingredient${group.items.length === 1 ? "" : "s"}`;
  heading.append(title, count);
  row.append(heading);
  return row;
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

function itemRow(occurrence, jobRunning) {
  const { item, requirements, duplicate, shared } = occurrence;
  const row = document.createElement("tr");
  row.classList.toggle("duplicate-item", duplicate);

  const includeCell = cell();
  const checkbox = document.createElement("input");
  checkbox.type = "checkbox";
  checkbox.checked = Boolean(item.included);
  checkbox.disabled = jobRunning || duplicate;
  checkbox.setAttribute(
    "aria-label",
    duplicate ? `${item.name} is listed above` : `Include ${item.name}`
  );
  if (!duplicate) {
    checkbox.addEventListener("change", () => setIncluded(item.id, checkbox.checked));
  }
  includeCell.append(checkbox);
  row.append(includeCell);

  const nameCell = cell();
  const name = document.createElement("strong");
  name.className = "ingredient-name";
  name.textContent = item.name;
  nameCell.append(name);
  if (duplicate) {
    const duplicateNote = document.createElement("span");
    duplicateNote.className = "duplicate-note";
    duplicateNote.textContent = "Listed above";
    nameCell.append(duplicateNote);
  }
  row.append(nameCell);

  const neededCell = cell();
  const recipeQuantity = document.createElement("span");
  recipeQuantity.className = "recipe-quantity";
  recipeQuantity.textContent = formatRequirementList(requirements);
  neededCell.append(recipeQuantity);
  if (shared && !duplicate) {
    const total = document.createElement("span");
    total.className = "total-needed";
    total.textContent = `Total: ${formatRequirements(item)}`;
    neededCell.append(total);
  }
  row.append(neededCell);

  const productCell = cell();
  if (duplicate) {
    const listedAbove = document.createElement("span");
    listedAbove.className = "listed-above";
    listedAbove.textContent = "Use the first listing above";
    productCell.append(listedAbove);
    row.append(productCell);

    const stateCell = cell();
    const duplicateStatus = document.createElement("span");
    duplicateStatus.className = "status duplicate";
    duplicateStatus.textContent = "Listed above";
    stateCell.append(duplicateStatus);
    row.append(stateCell);
    return row;
  }

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

  itemTable.replaceChildren(...recipeGroups(job.items).flatMap((group) => [
    groupRow(group),
    ...group.items.map((occurrence) => itemRow(occurrence, running)),
  ]));
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
