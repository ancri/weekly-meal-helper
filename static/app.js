const state = {
  meta: null,
  week: null,
  recipes: [],
  ingredients: [],
  editorIngredients: [],
  recipeIngredientMode: "single",
  editingRecipeId: null,
  addCreatedRecipeToWeek: false,
  view: "week",
  recipeSearch: "",
  recipeCategory: "",
  recipeSortKey: "name",
  recipeSortDirection: "asc",
  ingredientSearch: "",
  ingredientSortKey: "name",
  ingredientSortDirection: "asc",
  editingIngredientId: null,
  cartExtensionAvailable: false,
  cartExtensionVersion: "",
  cartTransferStatus: "",
};

const CART_EXTENSION_PAGE_SOURCE = "meal-helper-page";
const CART_EXTENSION_SOURCE = "meal-helper-cart-extension";
const CART_HELPER_SETUP_URL =
  "https://github.com/ancri/weekly-meal-helper/tree/main/extension/whole-foods-cart-helper";

const weekView = document.querySelector("#week-view");
const recipesView = document.querySelector("#recipes-view");
const ingredientsView = document.querySelector("#ingredients-view");
const recipeDialog = document.querySelector("#recipe-dialog");
const addRecipeDialog = document.querySelector("#add-recipe-dialog");
const instructionsDialog = document.querySelector("#instructions-dialog");
const ingredientDialog = document.querySelector("#ingredient-dialog");
const suggestionDialog = document.querySelector("#suggestion-dialog");
const recipeForm = document.querySelector("#recipe-form");
const ingredientForm = document.querySelector("#ingredient-form");
const suggestionForm = document.querySelector("#suggestion-form");
const toast = document.querySelector("#toast");

function h(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options,
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || "Request failed.");
  return payload;
}

function notify(message, error = false) {
  toast.textContent = message;
  toast.classList.toggle("error", error);
  toast.classList.add("show");
  clearTimeout(notify.timeout);
  notify.timeout = setTimeout(() => toast.classList.remove("show"), 2800);
}

function localDate(iso) {
  const [year, month, day] = iso.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function toIso(value) {
  return [value.getFullYear(), String(value.getMonth() + 1).padStart(2, "0"), String(value.getDate()).padStart(2, "0")].join("-");
}

function weekLabel(iso) {
  const start = localDate(iso);
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  const first = start.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  const second = end.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  return `${first} - ${second}`;
}

function shortDate(iso) {
  if (!iso) return "Not yet";
  return localDate(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function quantity(value) {
  return Number(value) % 1 === 0 ? Number(value).toFixed(0) : Number(value).toFixed(2).replace(/0+$/, "");
}

async function loadWeek(start = "") {
  weekView.innerHTML = '<div class="loading">Loading this week...</div>';
  try {
    state.week = await api(`/api/week${start ? `?start=${encodeURIComponent(start)}` : ""}`);
    renderWeek();
  } catch (error) {
    weekView.innerHTML = `<div class="loading">${h(error.message)}</div>`;
    notify(error.message, true);
  }
}

function renderWeek() {
  const week = state.week;
  const grouped = Object.fromEntries(Object.keys(week.categories).map((category) => [category, []]));
  week.items.forEach((item) => grouped[item.category].push(item));
  const acceptedPercent = Math.min(100, (week.accepted_count / week.choose_count) * 100);

  const sections = Object.entries(week.categories).map(([category, label]) => {
    const items = grouped[category];
    if (!items.length) return "";
    return `
      <section class="category-section">
        <div class="category-header">
          <h2>${h(label)}</h2>
          <span class="category-count">${items.length} option${items.length === 1 ? "" : "s"}</span>
        </div>
        <div class="meal-grid">${items.map(mealCard).join("")}</div>
      </section>`;
  }).join("");

  weekView.innerHTML = `
    <div class="page-shell">
      <div class="week-toolbar">
        <button class="icon-button" data-shift-week="-7" aria-label="Previous week" title="Previous week">&#8249;</button>
        <div class="week-heading">
          <p class="eyebrow">Weekly menu</p>
          <h1>${h(weekLabel(week.week_start))}</h1>
          <p>${week.locked ? "Menu confirmed" : "Choose three meals for the week"}</p>
        </div>
        <button class="icon-button" data-shift-week="7" aria-label="Next week" title="Next week">&#8250;</button>
      </div>

      <div class="status-strip">
        <div class="status-copy">
          <strong>${week.accepted_count} of ${week.choose_count} selected</strong>
          <span>${week.locked ? `Locked ${h(new Date(week.locked_at).toLocaleDateString())}` : "Pass or postpone the others"}</span>
        </div>
        <div class="progress-track" aria-label="Meal selection progress">
          <div class="progress-fill" style="width:${acceptedPercent}%"></div>
        </div>
        ${week.locked ? "" : '<button class="button secondary" id="open-recipe-picker">+ Add meal</button>'}
      </div>

      ${sections || '<p class="empty-copy">There are no recipes in this week yet.</p>'}
      ${week.locked ? shoppingSection(week.shopping) : ""}
    </div>

    <div class="lock-bar">
      <div class="lock-bar-inner">
        ${week.locked ? `
          <div class="locked-banner"><span class="lock-symbol">&#10003;</span><div><strong>Week locked</strong><span>Your shopping list is ready</span></div></div>
          <button class="button secondary" id="unlock-week">Unlock week</button>
        ` : `
          <div><strong>${week.accepted_count === week.choose_count ? "Ready to lock" : `Select ${week.choose_count - week.accepted_count} more`}</strong><span>Locking finalizes the menu and shopping list</span></div>
          <button class="button primary" id="lock-week" ${week.accepted_count !== week.choose_count ? "disabled" : ""}>Lock this week</button>
        `}
      </div>
    </div>`;
}

function mealCard(item) {
  const ingredientText = item.ingredients.length
    ? `${item.ingredients.length} ingredient${item.ingredients.length === 1 ? "" : "s"}`
    : "Add ingredients";
  const historyText = item.last_eaten ? `Last cooked ${shortDate(item.last_eaten)}` : "No earlier history";
  const locked = state.week.locked;
  return `
    <article class="meal-card ${h(item.state)}" data-open-recipe="${item.id}" tabindex="0">
      ${locked ? "" : `<button class="remove-meal" data-remove-item="${item.weekly_recipe_id}" aria-label="Remove ${h(item.name)}" title="Remove meal">&times;</button>`}
      <p class="eyebrow">${h(ingredientText)}</p>
      <h3>${h(item.name)}</h3>
      <p class="meal-card-meta">${h(historyText)}</p>
      <div class="meal-card-links">${item.instructions ? `<button class="text-button" data-show-instructions="${item.id}">Instructions</button>` : ""}</div>
      ${item.was_proposed ? suggestionVoteControl(item) : ""}
      <div class="meal-spacer"></div>
      ${locked ? `<span class="category-tag">${item.state === "accepted" ? "On the menu" : h(item.state)}</span>` : decisionControl(item)}
    </article>`;
}

function suggestionVoteControl(item) {
  return `
    <div class="suggestion-vote" aria-label="Rate this suggestion">
      <button type="button" data-suggestion-vote="good"
        data-weekly-recipe-id="${item.weekly_recipe_id}"
        class="${item.suggestion_vote === "good" ? "selected" : ""}"
        aria-pressed="${item.suggestion_vote === "good"}" title="Good suggestion">
        <span aria-hidden="true">&#10003;</span><span>Good suggestion</span>
      </button>
      <button type="button" data-suggestion-vote="bad"
        data-weekly-recipe-id="${item.weekly_recipe_id}"
        class="${item.suggestion_vote === "bad" ? "selected" : ""}"
        aria-pressed="${item.suggestion_vote === "bad"}" title="Bad suggestion">
        <span aria-hidden="true">&#10005;</span><span>Bad suggestion</span>
      </button>
    </div>`;
}

function decisionControl(item) {
  return `
    <div class="decision-control" aria-label="Decision for ${h(item.name)}">
      <button data-item-id="${item.weekly_recipe_id}" data-state="accepted" class="${item.state === "accepted" ? "selected" : ""}">Keep</button>
      <button data-item-id="${item.weekly_recipe_id}" data-state="rejected" class="${item.state === "rejected" ? "selected" : ""}">Pass</button>
      <button data-item-id="${item.weekly_recipe_id}" data-state="postponed" class="${item.state === "postponed" ? "selected" : ""}">Next week</button>
    </div>`;
}

function shoppingSection(shopping) {
  const wholeFoodsItems = shopping.whole_foods || [];
  const cartAction = wholeFoodsItems.length
    ? state.cartExtensionAvailable
      ? '<button type="button" class="button primary" id="populate-whole-foods-cart">Populate Whole Foods cart</button>'
      : `<a class="button secondary cart-helper-link" href="${CART_HELPER_SETUP_URL}" target="_blank" rel="noopener">Set up cart helper</a>`
    : "";
  const helperStatus = state.cartTransferStatus
    ? `<p class="cart-helper-status" role="status">${h(state.cartTransferStatus)}</p>`
    : state.cartExtensionAvailable
      ? `<p class="cart-helper-status">Cart helper ${h(state.cartExtensionVersion)} is ready.</p>`
      : '<p class="cart-helper-status">The optional Chrome helper can add mapped products for review before checkout.</p>';
  return `
    <section class="shopping-section">
      <div class="shopping-section-heading">
        <div>
          <p class="eyebrow">Combined quantities</p>
          <h2>Shopping list</h2>
          ${helperStatus}
        </div>
        ${cartAction}
      </div>
      <div class="shopping-columns">
        ${shoppingColumn("Whole Foods", wholeFoodsItems)}
        ${shoppingColumn("Elsewhere", shopping.elsewhere)}
      </div>
    </section>`;
}

function shoppingColumn(title, items) {
  return `
    <div class="shopping-column">
      <h3>${h(title)}</h3>
      ${items.length ? `<ul class="shopping-list">${items.map((item) => `<li><span>${h(item.name)}</span><span>${quantity(item.quantity)} ${h(item.unit)}</span></li>`).join("")}</ul>` : '<p class="empty-copy">No items yet.</p>'}
    </div>`;
}

async function setDecision(itemId, nextState) {
  try {
    const current = state.week.items.find((item) => item.weekly_recipe_id === Number(itemId));
    const stateValue = current?.state === nextState ? "pending" : nextState;
    state.week = await api(`/api/week-items/${itemId}/decision`, {
      method: "POST",
      body: JSON.stringify({ state: stateValue }),
    });
    renderWeek();
  } catch (error) {
    notify(error.message, true);
  }
}

function pingCartExtension() {
  window.postMessage(
    { source: CART_EXTENSION_PAGE_SOURCE, type: "PING_CART_EXTENSION" },
    window.location.origin,
  );
}

function populateWholeFoodsCart() {
  const items = state.week?.shopping?.whole_foods || [];
  if (!state.week?.locked || !items.length) {
    notify("Lock a week with Whole Foods ingredients first.", true);
    return;
  }
  state.cartTransferStatus = "Opening the cart review...";
  renderWeek();
  window.postMessage(
    {
      source: CART_EXTENSION_PAGE_SOURCE,
      type: "POPULATE_WHOLE_FOODS_CART",
      weekStart: state.week.week_start,
      items: items.map((item) => ({
        id: item.id,
        name: item.name,
        quantity: item.quantity,
        unit: item.unit,
      })),
    },
    window.location.origin,
  );
}

window.addEventListener("message", (event) => {
  if (
    event.source !== window ||
    event.origin !== window.location.origin ||
    event.data?.source !== CART_EXTENSION_SOURCE
  ) {
    return;
  }
  if (event.data.type === "CART_EXTENSION_READY") {
    const firstDetection = !state.cartExtensionAvailable;
    state.cartExtensionAvailable = true;
    state.cartExtensionVersion = String(event.data.version || "");
    if (firstDetection && state.week?.locked) renderWeek();
    return;
  }
  if (event.data.type === "CART_EXTENSION_JOB_STARTED") {
    state.cartTransferStatus = `Opened a cart plan with ${Number(event.data.itemCount) || 0} ingredients.`;
    if (state.week?.locked) renderWeek();
    return;
  }
  if (event.data.type === "CART_EXTENSION_ERROR") {
    state.cartTransferStatus = "";
    notify(event.data.error || "The cart helper could not start.", true);
    if (state.week?.locked) renderWeek();
  }
});

async function setSuggestionVote(itemId, vote) {
  try {
    const current = state.week.items.find(
      (item) => item.weekly_recipe_id === Number(itemId)
    );
    const nextVote = current?.suggestion_vote === vote ? null : vote;
    state.week = await api(`/api/week-items/${itemId}/vote`, {
      method: "POST",
      body: JSON.stringify({ vote: nextVote }),
    });
    renderWeek();
  } catch (error) {
    notify(error.message, true);
  }
}

async function removeMeal(itemId) {
  try {
    state.week = await api(`/api/week-items/${itemId}`, { method: "DELETE" });
    renderWeek();
    notify("Meal removed from this week.");
  } catch (error) {
    notify(error.message, true);
  }
}

async function lockWeek() {
  try {
    state.week = await api("/api/week/lock", {
      method: "POST",
      body: JSON.stringify({ week_start: state.week.week_start }),
    });
    renderWeek();
    notify("The weekly menu is locked.");
  } catch (error) {
    notify(error.message, true);
  }
}

async function unlockWeek() {
  if (!window.confirm("Unlock this week? Its meals and decisions will become editable again.")) return;
  try {
    state.week = await api("/api/week/unlock", {
      method: "POST",
      body: JSON.stringify({ week_start: state.week.week_start }),
    });
    renderWeek();
    notify("The week is unlocked.");
  } catch (error) {
    notify(error.message, true);
  }
}

async function loadRecipes() {
  state.recipes = await api("/api/recipes");
  renderRecipes();
}

function renderRecipes() {
  const categoryFilters = Object.entries(state.meta.categories)
    .map(([value, label]) => `<option value="${h(value)}" ${value === state.recipeCategory ? "selected" : ""}>${h(label)}</option>`)
    .join("");
  recipesView.innerHTML = `
    <div class="page-shell">
      <div class="recipe-page-header">
        <div><p class="eyebrow">Library</p><h1>Recipes</h1></div>
        <div class="recipe-tools">
          <input id="recipe-search" type="search" value="${h(state.recipeSearch)}" placeholder="Search recipes" aria-label="Search recipes">
          <select id="recipe-category-filter" aria-label="Filter recipes by category">
            <option value="">All categories</option>
            ${categoryFilters}
          </select>
          <button id="new-recipe" class="button primary">+ New recipe</button>
        </div>
      </div>
      <table class="recipe-table recipe-library-table">
        <thead><tr>
          ${recipeSortHeader("name", "Recipe")}
          ${recipeSortHeader("category", "Category")}
          ${recipeSortHeader("last_eaten", "Last cooked")}
          ${recipeSortHeader("ingredient_count", "Ingredients")}
          <th><span class="visually-hidden">Actions</span></th>
        </tr></thead>
        <tbody id="recipe-table-body"></tbody>
      </table>
    </div>`;
  renderRecipeRows();
}

function recipeSortHeader(key, label) {
  const active = state.recipeSortKey === key;
  const direction = active ? state.recipeSortDirection : "none";
  const indicator = active ? (direction === "asc" ? "&#8593;" : "&#8595;") : "";
  const ariaSort = direction === "asc" ? "ascending" : direction === "desc" ? "descending" : "none";
  return `<th aria-sort="${ariaSort}"><button class="recipe-sort" data-sort-recipe="${key}">${label}<span class="sort-indicator" aria-hidden="true">${indicator}</span></button></th>`;
}

function highlightedRecipeName(name) {
  const query = state.recipeSearch.trim();
  if (!query) return h(name);
  const text = String(name);
  const lowered = text.toLocaleLowerCase();
  const needle = query.toLocaleLowerCase();
  let result = "";
  let cursor = 0;
  let match = lowered.indexOf(needle);
  while (match !== -1) {
    result += h(text.slice(cursor, match));
    result += `<mark>${h(text.slice(match, match + query.length))}</mark>`;
    cursor = match + query.length;
    match = lowered.indexOf(needle, cursor);
  }
  return result + h(text.slice(cursor));
}

function visibleRecipes() {
  const query = state.recipeSearch.trim().toLocaleLowerCase();
  const recipes = state.recipes.filter((recipe) =>
    (!query || recipe.name.toLocaleLowerCase().includes(query))
    && (!state.recipeCategory || recipe.category === state.recipeCategory)
  );
  return recipes.sort((first, second) => {
    let comparison;
    if (state.recipeSortKey === "ingredient_count") {
      comparison = Number(first.ingredient_count) - Number(second.ingredient_count);
    } else if (state.recipeSortKey === "last_eaten") {
      if (!first.last_eaten && !second.last_eaten) comparison = 0;
      else if (!first.last_eaten) return 1;
      else if (!second.last_eaten) return -1;
      else comparison = first.last_eaten.localeCompare(second.last_eaten);
    } else if (state.recipeSortKey === "category") {
      comparison = state.meta.categories[first.category].localeCompare(
        state.meta.categories[second.category],
        undefined,
        { sensitivity: "base" },
      );
    } else {
      comparison = first.name.localeCompare(second.name, undefined, { sensitivity: "base" });
    }
    if (comparison === 0 && state.recipeSortKey !== "name") {
      comparison = first.name.localeCompare(second.name, undefined, { sensitivity: "base" });
    }
    return state.recipeSortDirection === "asc" ? comparison : -comparison;
  });
}

function renderRecipeRows() {
  const target = document.querySelector("#recipe-table-body");
  if (!target) return;
  const recipes = visibleRecipes();
  target.innerHTML = recipes.length ? recipes.map((recipe) => `
    <tr>
      <td><strong>${highlightedRecipeName(recipe.name)}</strong></td>
      <td><span class="category-tag">${h(state.meta.categories[recipe.category])}</span></td>
      <td>${h(shortDate(recipe.last_eaten))}</td>
      <td>${recipe.ingredient_count}</td>
      <td>
        <div class="recipe-actions">
          <button class="text-button" data-edit-recipe="${recipe.id}">Edit</button>
          <button class="text-button danger" data-delete-recipe="${recipe.id}" data-recipe-name="${h(recipe.name)}">Delete</button>
        </div>
      </td>
    </tr>`).join("") : '<tr><td class="recipe-empty" colspan="5">No matching recipes.</td></tr>';
}

function ingredientSortHeader(key, label) {
  const active = state.ingredientSortKey === key;
  const direction = active ? state.ingredientSortDirection : "none";
  const indicator = active ? (direction === "asc" ? "&#8593;" : "&#8595;") : "";
  const ariaSort = direction === "asc" ? "ascending" : direction === "desc" ? "descending" : "none";
  return `<th aria-sort="${ariaSort}"><button class="recipe-sort" data-sort-ingredient="${key}">${label}<span class="sort-indicator" aria-hidden="true">${indicator}</span></button></th>`;
}

function visibleIngredients() {
  const query = state.ingredientSearch.trim().toLocaleLowerCase();
  const ingredients = state.ingredients.filter((ingredient) =>
    !query || ingredient.name.toLocaleLowerCase().includes(query)
  );
  return ingredients.sort((first, second) => {
    let comparison;
    if (state.ingredientSortKey === "whole_foods") {
      comparison = Number(second.whole_foods) - Number(first.whole_foods);
    } else if (state.ingredientSortKey === "usage_count") {
      comparison = Number(first.usage_count) - Number(second.usage_count);
    } else if (state.ingredientSortKey === "default_unit") {
      comparison = first.default_unit.localeCompare(second.default_unit, undefined, { sensitivity: "base" });
    } else {
      comparison = first.name.localeCompare(second.name, undefined, { sensitivity: "base" });
    }
    if (comparison === 0 && state.ingredientSortKey !== "name") {
      comparison = first.name.localeCompare(second.name, undefined, { sensitivity: "base" });
    }
    return state.ingredientSortDirection === "asc" ? comparison : -comparison;
  });
}

function highlightedIngredientName(name) {
  const query = state.ingredientSearch.trim();
  if (!query) return h(name);
  const text = String(name);
  const match = text.toLocaleLowerCase().indexOf(query.toLocaleLowerCase());
  if (match === -1) return h(text);
  return `${h(text.slice(0, match))}<mark>${h(text.slice(match, match + query.length))}</mark>${h(text.slice(match + query.length))}`;
}

function renderIngredients() {
  ingredientsView.innerHTML = `
    <div class="page-shell">
      <div class="recipe-page-header">
        <div><p class="eyebrow">Catalog</p><h1>Ingredients</h1></div>
        <div class="recipe-tools">
          <input id="ingredient-search" type="search" value="${h(state.ingredientSearch)}" placeholder="Search ingredients" aria-label="Search ingredients">
          <button id="new-managed-ingredient" class="button primary">+ New ingredient</button>
        </div>
      </div>
      <table class="recipe-table ingredient-table">
        <thead><tr>
          ${ingredientSortHeader("name", "Ingredient")}
          ${ingredientSortHeader("whole_foods", "Source")}
          ${ingredientSortHeader("default_unit", "Default unit")}
          ${ingredientSortHeader("usage_count", "Recipes")}
          <th><span class="visually-hidden">Actions</span></th>
        </tr></thead>
        <tbody id="ingredient-table-body"></tbody>
      </table>
    </div>`;
  renderIngredientTableRows();
}

function renderIngredientTableRows() {
  const target = document.querySelector("#ingredient-table-body");
  if (!target) return;
  const ingredients = visibleIngredients();
  target.innerHTML = ingredients.length ? ingredients.map((ingredient) => `
    <tr>
      <td><strong>${highlightedIngredientName(ingredient.name)}</strong></td>
      <td><span class="ingredient-source">${ingredient.whole_foods ? "Whole Foods" : "Elsewhere"}</span></td>
      <td>${h(ingredient.default_unit)}</td>
      <td><span class="ingredient-usage">${ingredient.usage_count} recipe${Number(ingredient.usage_count) === 1 ? "" : "s"}</span></td>
      <td>
        <div class="recipe-actions">
          <button class="text-button" data-edit-ingredient="${ingredient.id}">Edit</button>
          <button class="text-button danger" data-delete-ingredient="${ingredient.id}" data-ingredient-name="${h(ingredient.name)}" ${Number(ingredient.usage_count) ? `disabled title="Used by ${ingredient.usage_count} recipe(s)"` : ""}>Delete</button>
        </div>
      </td>
    </tr>`).join("") : '<tr><td class="recipe-empty" colspan="5">No matching ingredients.</td></tr>';
}

function openManagedIngredient(ingredientId = null) {
  state.editingIngredientId = ingredientId;
  const ingredient = ingredientId
    ? state.ingredients.find((item) => item.id === Number(ingredientId))
    : { name: "", default_unit: "pieces", whole_foods: true };
  if (!ingredient) return notify("Ingredient not found.", true);
  document.querySelector("#ingredient-dialog-title").textContent = ingredientId ? "Edit ingredient" : "New ingredient";
  document.querySelector("#managed-ingredient-name").value = ingredient.name;
  document.querySelector("#managed-ingredient-unit").innerHTML = unitOptions(ingredient.default_unit);
  document.querySelector("#managed-ingredient-whole-foods").checked = Boolean(ingredient.whole_foods);
  ingredientDialog.showModal();
}

async function saveManagedIngredient(event) {
  event.preventDefault();
  const payload = {
    name: document.querySelector("#managed-ingredient-name").value,
    default_unit: document.querySelector("#managed-ingredient-unit").value,
    whole_foods: document.querySelector("#managed-ingredient-whole-foods").checked,
  };
  try {
    await api(state.editingIngredientId ? `/api/ingredients/${state.editingIngredientId}` : "/api/ingredients", {
      method: state.editingIngredientId ? "PUT" : "POST",
      body: JSON.stringify(payload),
    });
    await refreshIngredients();
    ingredientDialog.close();
    renderIngredients();
    notify("Ingredient saved.");
  } catch (error) {
    notify(error.message, true);
  }
}

async function deleteManagedIngredient(ingredientId, ingredientName) {
  if (!window.confirm(`Delete “${ingredientName}” from the ingredient catalog?`)) return;
  try {
    await api(`/api/ingredients/${ingredientId}`, { method: "DELETE" });
    await refreshIngredients();
    renderIngredients();
    notify("Ingredient deleted.");
  } catch (error) {
    notify(error.message, true);
  }
}

async function refreshIngredients() {
  state.ingredients = await api("/api/ingredients");
}

function categoryOptions(selected = "oven_roasted") {
  return Object.entries(state.meta.categories)
    .map(([value, label]) => `<option value="${h(value)}" ${value === selected ? "selected" : ""}>${h(label)}</option>`)
    .join("");
}

function unitOptions(selected = "pieces") {
  return state.meta.units
    .map((unit) => `<option value="${h(unit)}" ${unit === selected ? "selected" : ""}>${h(unit)}</option>`)
    .join("");
}

function setRecipeIngredientMode(mode, focus = false) {
  state.recipeIngredientMode = mode === "paste" ? "paste" : "single";
  document.querySelectorAll("[data-ingredient-mode]").forEach((button) => {
    const active = button.dataset.ingredientMode === state.recipeIngredientMode;
    button.classList.toggle("active", active);
    button.setAttribute("aria-selected", String(active));
    button.tabIndex = active ? 0 : -1;
  });
  document.querySelector("#ingredient-single-panel").classList.toggle(
    "hidden", state.recipeIngredientMode !== "single"
  );
  document.querySelector("#ingredient-paste-panel").classList.toggle(
    "hidden", state.recipeIngredientMode !== "paste"
  );
  if (focus) {
    const target = state.recipeIngredientMode === "single"
      ? document.querySelector("#ingredient-add-search")
      : document.querySelector("#recipe-ingredient-text");
    target.focus();
  }
}

function resetIngredientEntry() {
  const combobox = document.querySelector("#ingredient-add-search")
    .closest(".ingredient-combobox");
  document.querySelector("#ingredient-add-search").value = "";
  combobox.querySelector(".row-ingredient-id").value = "";
  combobox.dataset.selectedId = "";
  combobox.classList.remove("invalid");
  document.querySelector("#ingredient-add-search").removeAttribute("aria-invalid");
  document.querySelector("#ingredient-add-quantity").value = "1";
  document.querySelector("#ingredient-add-unit").innerHTML = unitOptions();
  closeIngredientSuggestions(combobox);
}

function toggleNewIngredientFields() {
  const fields = document.querySelector("#new-ingredient-fields");
  const button = document.querySelector("#toggle-new-ingredient");
  const opening = fields.classList.contains("hidden");
  fields.classList.toggle("hidden", !opening);
  button.setAttribute("aria-expanded", String(opening));
  if (opening) document.querySelector("#new-ingredient-name").focus();
}

async function openRecipe(recipeId = null, addToWeek = false) {
  state.editingRecipeId = recipeId;
  state.addCreatedRecipeToWeek = addToWeek;
  const recipe = recipeId ? await api(`/api/recipes/${recipeId}`) : {
    name: "",
    category: "oven_roasted",
    url: "",
    instructions: "",
    ingredients: [],
  };
  state.editorIngredients = recipe.ingredients.map((item) => ({
    id: item.id,
    quantity: item.quantity,
    unit: item.unit,
  }));
  state.recipeIngredientMode = state.editorIngredients.length ? "single" : "paste";
  document.querySelector("#recipe-dialog-title").textContent = recipeId ? "Edit recipe" : "New recipe";
  document.querySelector("#recipe-name").value = recipe.name;
  document.querySelector("#recipe-category").innerHTML = categoryOptions(recipe.category);
  document.querySelector("#recipe-url").value = recipe.url || "";
  document.querySelector("#recipe-instructions").value = recipe.instructions || "";
  document.querySelector("#ingredient-add-unit").innerHTML = unitOptions();
  document.querySelector("#new-ingredient-unit").innerHTML = unitOptions();
  document.querySelector("#new-ingredient-name").value = "";
  document.querySelector("#new-ingredient-whole-foods").checked = true;
  document.querySelector("#new-ingredient-fields").classList.add("hidden");
  document.querySelector("#toggle-new-ingredient").setAttribute("aria-expanded", "false");
  document.querySelector("#recipe-ingredient-text").value = "";
  document.querySelector("#ingredient-parser-status").textContent = "";
  resetIngredientEntry();
  renderIngredientRows();
  setRecipeIngredientMode(state.recipeIngredientMode);
  recipeDialog.showModal();
}

function ingredientMatches(query, limit = 6) {
  const normalized = query.trim().toLocaleLowerCase();
  if (normalized.length < 2) return [];

  return state.ingredients
    .map((ingredient) => {
      const name = ingredient.name.toLocaleLowerCase();
      const words = name.split(/[\s(/,-]+/);
      let rank = 3;
      if (name.startsWith(normalized)) rank = 0;
      else if (words.some((word) => word.startsWith(normalized))) rank = 1;
      else if (name.includes(normalized)) rank = 2;
      return { ingredient, rank };
    })
    .filter((match) => match.rank < 3)
    .sort((first, second) =>
      first.rank - second.rank
      || Number(second.ingredient.usage_count || 0) - Number(first.ingredient.usage_count || 0)
      || first.ingredient.name.localeCompare(second.ingredient.name, undefined, { sensitivity: "base" })
    )
    .slice(0, limit)
    .map((match) => match.ingredient);
}

function highlightedMatch(name, query) {
  const normalized = query.trim().toLocaleLowerCase();
  const match = name.toLocaleLowerCase().indexOf(normalized);
  if (match < 0) return h(name);
  return `${h(name.slice(0, match))}<mark>${h(name.slice(match, match + normalized.length))}</mark>${h(name.slice(match + normalized.length))}`;
}

function ingredientCombobox(item, index) {
  const selected = state.ingredients.find((ingredient) => ingredient.id === Number(item.id));
  const listId = `ingredient-suggestions-${index}`;
  return `
    <div class="ingredient-combobox" data-selected-id="${selected?.id || ""}" data-active-index="-1">
      <input class="row-ingredient-search" type="text" value="${h(selected?.name || "")}"
        placeholder="Type 2+ letters" autocomplete="off" spellcheck="false"
        role="combobox" aria-label="Ingredient" aria-autocomplete="list"
        aria-expanded="false" aria-controls="${listId}">
      <input class="row-ingredient-id" type="hidden" value="${selected?.id || ""}">
      <div id="${listId}" class="ingredient-suggestions" role="listbox" hidden></div>
    </div>`;
}

function renderIngredientRows() {
  const target = document.querySelector("#ingredient-rows");
  const count = state.editorIngredients.length;
  document.querySelector("#recipe-ingredient-count").textContent =
    `${count} item${count === 1 ? "" : "s"}`;
  if (!state.editorIngredients.length) {
    target.innerHTML = '<div class="ingredient-empty">No ingredients in this recipe yet.</div>';
    return;
  }
  target.innerHTML = state.editorIngredients.map((item, index) => `
    <div class="ingredient-row ingredient-entry-context" data-row="${index}">
      ${ingredientCombobox(item, index)}
      <div class="quantity-stepper">
        <button type="button" data-adjust-quantity="-1" aria-label="Decrease quantity" title="Decrease quantity">&minus;</button>
        <input class="row-quantity" type="number" value="${h(item.quantity)}" min="0.01" step="any" inputmode="decimal" aria-label="Quantity">
        <button type="button" data-adjust-quantity="1" aria-label="Increase quantity" title="Increase quantity">+</button>
      </div>
      <select class="row-unit" aria-label="Unit">${unitOptions(item.unit)}</select>
      <button type="button" class="remove-row" data-remove-row="${index}" aria-label="Remove ingredient" title="Remove ingredient">&times;</button>
    </div>`).join("");
}

function closeIngredientSuggestions(combobox) {
  const input = combobox.querySelector(".row-ingredient-search");
  const suggestions = combobox.querySelector(".ingredient-suggestions");
  suggestions.hidden = true;
  suggestions.innerHTML = "";
  combobox.dataset.activeIndex = "-1";
  input.setAttribute("aria-expanded", "false");
  input.removeAttribute("aria-activedescendant");
}

function setIngredientSelection(combobox, ingredient) {
  const input = combobox.querySelector(".row-ingredient-search");
  input.value = ingredient.name;
  input.removeAttribute("aria-invalid");
  combobox.classList.remove("invalid");
  combobox.querySelector(".row-ingredient-id").value = String(ingredient.id);
  combobox.closest(".ingredient-entry-context").querySelector(".row-unit").value = ingredient.default_unit;
  combobox.dataset.selectedId = String(ingredient.id);
  closeIngredientSuggestions(combobox);
}

function resolveExactIngredient(input) {
  const normalized = input.value.trim().toLocaleLowerCase();
  if (!normalized) return true;
  const ingredient = state.ingredients.find(
    (item) => item.name.trim().toLocaleLowerCase() === normalized
  );
  if (!ingredient) return false;
  setIngredientSelection(input.closest(".ingredient-combobox"), ingredient);
  return true;
}

function setActiveIngredientSuggestion(combobox, index) {
  const options = [...combobox.querySelectorAll(".ingredient-suggestion")];
  if (!options.length) return;
  const activeIndex = (index + options.length) % options.length;
  options.forEach((option, optionIndex) => {
    option.classList.toggle("active", optionIndex === activeIndex);
    option.setAttribute("aria-selected", optionIndex === activeIndex ? "true" : "false");
  });
  combobox.dataset.activeIndex = String(activeIndex);
  combobox.querySelector(".row-ingredient-search")
    .setAttribute("aria-activedescendant", options[activeIndex].id);
}

function updateIngredientSuggestions(input) {
  const combobox = input.closest(".ingredient-combobox");
  const hiddenInput = combobox.querySelector(".row-ingredient-id");
  const selected = state.ingredients.find(
    (ingredient) => ingredient.id === Number(hiddenInput.value)
  );
  if (!selected || input.value !== selected.name) {
    hiddenInput.value = "";
    combobox.dataset.selectedId = "";
  }

  const query = input.value.trim();
  if (query.length < 2) {
    closeIngredientSuggestions(combobox);
    return;
  }

  const suggestions = combobox.querySelector(".ingredient-suggestions");
  const matches = ingredientMatches(query);
  suggestions.innerHTML = matches.length
    ? matches.map((ingredient, index) => `
      <div id="${suggestions.id}-option-${index}" class="ingredient-suggestion"
        role="option" aria-selected="false" data-ingredient-id="${ingredient.id}">
        <span>${highlightedMatch(ingredient.name, query)}</span>
        ${ingredient.whole_foods ? "" : "<small>Elsewhere</small>"}
      </div>`).join("")
    : '<div class="ingredient-no-match">No matching ingredients</div>';
  suggestions.hidden = false;
  input.setAttribute("aria-expanded", "true");
  if (matches.length) setActiveIngredientSuggestion(combobox, 0);
  else {
    combobox.dataset.activeIndex = "-1";
    input.removeAttribute("aria-activedescendant");
  }
}

function chooseIngredientSuggestion(option) {
  const combobox = option.closest(".ingredient-combobox");
  const ingredient = state.ingredients.find(
    (item) => item.id === Number(option.dataset.ingredientId)
  );
  if (!ingredient) return;
  setIngredientSelection(combobox, ingredient);
}

function adjustQuantity(button) {
  const input = button.closest(".quantity-stepper").querySelector(".row-quantity");
  const direction = Number(button.dataset.adjustQuantity);
  const current = Number(input.value) || 0;
  const step = direction > 0 ? (current >= 1 ? 1 : 0.25) : (current > 1 ? 1 : 0.25);
  const next = Math.max(0.25, Math.round((current + direction * step) * 100) / 100);
  input.value = String(next);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

function captureIngredientRows() {
  state.editorIngredients = [...document.querySelectorAll(".ingredient-row")].map((row) => ({
    id: Number(row.querySelector(".row-ingredient-id").value),
    quantity: Number(row.querySelector(".row-quantity").value),
    unit: row.querySelector(".row-unit").value,
  }));
}

function markUnresolvedIngredient(input) {
  const combobox = input.closest(".ingredient-combobox");
  input.setAttribute("aria-invalid", "true");
  combobox.classList.add("invalid");
  updateIngredientSuggestions(input);
  input.setAttribute("aria-invalid", "true");
  combobox.classList.add("invalid");
  input.focus();
  notify("Choose an ingredient from the matching suggestions.", true);
}

function addSelectedIngredient(focus = true) {
  const input = document.querySelector("#ingredient-add-search");
  const combobox = input.closest(".ingredient-combobox");
  if (!input.value.trim()) {
    input.focus();
    notify("Choose an ingredient to add.", true);
    return false;
  }
  if (!combobox.querySelector(".row-ingredient-id").value
      && !resolveExactIngredient(input)) {
    markUnresolvedIngredient(input);
    return false;
  }

  captureIngredientRows();
  const ingredientId = Number(combobox.querySelector(".row-ingredient-id").value);
  if (state.editorIngredients.some((item) => Number(item.id) === ingredientId)) {
    input.focus();
    notify("That ingredient is already in this recipe.", true);
    return false;
  }
  const quantity = Number(document.querySelector("#ingredient-add-quantity").value);
  if (!Number.isFinite(quantity) || quantity <= 0) {
    document.querySelector("#ingredient-add-quantity").focus();
    notify("Ingredient quantity must be greater than zero.", true);
    return false;
  }
  state.editorIngredients.push({
    id: ingredientId,
    quantity,
    unit: document.querySelector("#ingredient-add-unit").value,
  });
  renderIngredientRows();
  resetIngredientEntry();
  if (focus) document.querySelector("#ingredient-add-search").focus();
  return true;
}

async function saveRecipe(event) {
  event.preventDefault();
  if (state.recipeIngredientMode === "single"
      && document.querySelector("#ingredient-add-search").value.trim()
      && !addSelectedIngredient(false)) {
    return;
  }
  const unresolved = [...document.querySelectorAll(".ingredient-row")].find((row) => {
    const input = row.querySelector(".row-ingredient-search");
    const selectedId = row.querySelector(".row-ingredient-id").value;
    return input.value.trim() && !selectedId && !resolveExactIngredient(input);
  });
  if (unresolved) {
    const input = unresolved.querySelector(".row-ingredient-search");
    markUnresolvedIngredient(input);
    return;
  }
  captureIngredientRows();
  const ingredients = state.editorIngredients.filter((item) => item.id);
  const payload = {
    name: document.querySelector("#recipe-name").value,
    category: document.querySelector("#recipe-category").value,
    url: document.querySelector("#recipe-url").value,
    instructions: document.querySelector("#recipe-instructions").value,
    ingredients,
  };
  try {
    const recipe = await api(state.editingRecipeId ? `/api/recipes/${state.editingRecipeId}` : "/api/recipes", {
      method: state.editingRecipeId ? "PUT" : "POST",
      body: JSON.stringify(payload),
    });
    if (!state.editingRecipeId && state.addCreatedRecipeToWeek) {
      state.week = await api("/api/week/recipes", {
        method: "POST",
        body: JSON.stringify({ week_start: state.week.week_start, recipe_id: recipe.id }),
      });
    } else if (state.week) {
      state.week = await api(`/api/week?start=${encodeURIComponent(state.week.week_start)}`);
    }
    recipeDialog.close();
    renderWeek();
    if (state.view === "recipes") await loadRecipes();
    notify("Recipe saved.");
  } catch (error) {
    notify(error.message, true);
  }
}

function showInstructions(recipeId) {
  const recipe = state.week.items.find((item) => item.id === Number(recipeId));
  if (!recipe?.instructions) return;
  document.querySelector("#instructions-title").textContent = recipe.name;
  document.querySelector("#instructions-copy").textContent = recipe.instructions;
  const link = document.querySelector("#instructions-url");
  link.classList.toggle("hidden", !recipe.url);
  if (recipe.url) link.href = recipe.url;
  instructionsDialog.showModal();
}

async function deleteRecipe(recipeId, recipeName) {
  if (!window.confirm(`Delete “${recipeName}” from the recipe library? Historical weeks will be preserved.`)) return;
  try {
    await api(`/api/recipes/${recipeId}`, { method: "DELETE" });
    if (state.week) state.week = await api(`/api/week?start=${encodeURIComponent(state.week.week_start)}`);
    await loadRecipes();
    notify("Recipe deleted from the library.");
  } catch (error) {
    notify(error.message, true);
  }
}

async function createIngredient() {
  const name = document.querySelector("#new-ingredient-name").value;
  const defaultUnit = document.querySelector("#new-ingredient-unit").value;
  const wholeFoods = document.querySelector("#new-ingredient-whole-foods").checked;
  try {
    const ingredient = await api("/api/ingredients", {
      method: "POST",
      body: JSON.stringify({ name, default_unit: defaultUnit, whole_foods: wholeFoods }),
    });
    captureIngredientRows();
    await refreshIngredients();
    state.editorIngredients.push({ id: ingredient.id, quantity: 1, unit: ingredient.default_unit });
    renderIngredientRows();
    document.querySelector("#new-ingredient-name").value = "";
    document.querySelector("#new-ingredient-fields").classList.add("hidden");
    document.querySelector("#toggle-new-ingredient").setAttribute("aria-expanded", "false");
    document.querySelector("#ingredient-add-search").focus();
    notify("Ingredient created and added.");
  } catch (error) {
    notify(error.message, true);
  }
}

async function parseRecipeIngredients() {
  const text = document.querySelector("#recipe-ingredient-text").value;
  const status = document.querySelector("#ingredient-parser-status");
  const button = document.querySelector("#parse-recipe-ingredients");
  captureIngredientRows();
  if (state.editorIngredients.some((item) => item.id)
      && !window.confirm("Replace the current ingredient rows with the parsed list?")) return;

  button.disabled = true;
  button.textContent = "Parsing...";
  status.textContent = "";
  try {
    const result = await api("/api/recipes/parse-ingredients", {
      method: "POST",
      body: JSON.stringify({ text }),
    });
    if (result.ingredients.length) {
      state.editorIngredients = result.ingredients.map((item) => ({
        id: item.id,
        quantity: item.quantity,
        unit: item.unit,
      }));
      renderIngredientRows();
    }
    const matched = `${result.ingredients.length} ingredient${result.ingredients.length === 1 ? "" : "s"} filled`;
    const unmatched = result.unmatched.length
      ? ` Could not match: ${result.unmatched.join(", ")}.`
      : "";
    status.textContent = `${matched}.${unmatched} ${result.requests_remaining} requests remaining this hour.`;
  } catch (error) {
    status.textContent = error.message;
    notify(error.message, true);
  } finally {
    button.disabled = false;
    button.textContent = "Fill ingredients";
  }
}

function openSuggestion() {
  document.querySelector("#suggestion-text").value = "";
  document.querySelector("#suggestion-count").textContent = "0 / 500";
  suggestionDialog.showModal();
  document.querySelector("#suggestion-text").focus();
}

async function submitSuggestion(event) {
  event.preventDefault();
  const text = document.querySelector("#suggestion-text").value;
  try {
    await api("/api/suggestions", {
      method: "POST",
      body: JSON.stringify({ text }),
    });
    suggestionDialog.close();
    suggestionForm.reset();
    notify("Suggestion submitted.");
  } catch (error) {
    notify(error.message, true);
  }
}

function renderRecipePicker(query = "") {
  const lowered = query.trim().toLocaleLowerCase();
  const currentIds = new Set(state.week.items.map((item) => item.id));
  const matches = state.recipes.filter((recipe) => !currentIds.has(recipe.id) && recipe.name.toLocaleLowerCase().includes(lowered)).slice(0, 100);
  document.querySelector("#recipe-picker-results").innerHTML = matches.length ? matches.map((recipe) => `
    <div class="picker-row">
      <div><strong>${h(recipe.name)}</strong><span>${h(state.meta.categories[recipe.category])} · ${recipe.ingredient_count} ingredients</span></div>
      <button class="button secondary" data-add-recipe="${recipe.id}">Add</button>
    </div>`).join("") : '<p class="loading">No matching recipes.</p>';
}

async function openRecipePicker() {
  if (!state.recipes.length) state.recipes = await api("/api/recipes");
  document.querySelector("#recipe-picker-search").value = "";
  renderRecipePicker();
  addRecipeDialog.showModal();
}

async function addExistingRecipe(recipeId) {
  try {
    state.week = await api("/api/week/recipes", {
      method: "POST",
      body: JSON.stringify({ week_start: state.week.week_start, recipe_id: Number(recipeId) }),
    });
    addRecipeDialog.close();
    renderWeek();
    notify("Recipe added to this week.");
  } catch (error) {
    notify(error.message, true);
  }
}

function switchView(view) {
  state.view = view;
  document.querySelectorAll(".tab").forEach((tab) => tab.classList.toggle("active", tab.dataset.view === view));
  weekView.classList.toggle("hidden", view !== "week");
  recipesView.classList.toggle("hidden", view !== "recipes");
  ingredientsView.classList.toggle("hidden", view !== "ingredients");
  if (view === "recipes") loadRecipes().catch((error) => notify(error.message, true));
  if (view === "ingredients") {
    refreshIngredients()
      .then(renderIngredients)
      .catch((error) => notify(error.message, true));
  }
}

document.addEventListener("pointerdown", (event) => {
  const ingredientSuggestion = event.target.closest(".ingredient-suggestion");
  if (!ingredientSuggestion) return;
  event.preventDefault();
  chooseIngredientSuggestion(ingredientSuggestion);
});

document.addEventListener("click", async (event) => {
  document.querySelectorAll(".ingredient-combobox").forEach((combobox) => {
    if (!combobox.contains(event.target)) closeIngredientSuggestions(combobox);
  });

  if (event.target.closest("#open-suggestion")) return openSuggestion();

  const tab = event.target.closest("[data-view]");
  if (tab) return switchView(tab.dataset.view);

  const shift = event.target.closest("[data-shift-week]");
  if (shift) {
    const next = localDate(state.week.week_start);
    next.setDate(next.getDate() + Number(shift.dataset.shiftWeek));
    return loadWeek(toIso(next));
  }

  const decision = event.target.closest("[data-item-id]");
  if (decision) {
    event.stopPropagation();
    return setDecision(decision.dataset.itemId, decision.dataset.state);
  }

  const suggestionVote = event.target.closest("[data-suggestion-vote]");
  if (suggestionVote) {
    event.stopPropagation();
    return setSuggestionVote(
      suggestionVote.dataset.weeklyRecipeId,
      suggestionVote.dataset.suggestionVote,
    );
  }

  const remove = event.target.closest("[data-remove-item]");
  if (remove) {
    event.stopPropagation();
    return removeMeal(remove.dataset.removeItem);
  }

  const instructions = event.target.closest("[data-show-instructions]");
  if (instructions) {
    event.stopPropagation();
    return showInstructions(instructions.dataset.showInstructions);
  }

  const meal = event.target.closest("[data-open-recipe]");
  if (meal) return openRecipe(Number(meal.dataset.openRecipe));

  if (event.target.closest("#lock-week")) return lockWeek();
  if (event.target.closest("#unlock-week")) return unlockWeek();
  if (event.target.closest("#populate-whole-foods-cart")) return populateWholeFoodsCart();
  if (event.target.closest("#open-recipe-picker")) return openRecipePicker();
  if (event.target.closest("#new-recipe")) return openRecipe();

  const ingredientMode = event.target.closest("[data-ingredient-mode]");
  if (ingredientMode) {
    return setRecipeIngredientMode(ingredientMode.dataset.ingredientMode, true);
  }

  const edit = event.target.closest("[data-edit-recipe]");
  if (edit) return openRecipe(Number(edit.dataset.editRecipe));

  const deleteButton = event.target.closest("[data-delete-recipe]");
  if (deleteButton) return deleteRecipe(Number(deleteButton.dataset.deleteRecipe), deleteButton.dataset.recipeName);

  const sort = event.target.closest("[data-sort-recipe]");
  if (sort) {
    const key = sort.dataset.sortRecipe;
    if (state.recipeSortKey === key) {
      state.recipeSortDirection = state.recipeSortDirection === "asc" ? "desc" : "asc";
    } else {
      state.recipeSortKey = key;
      state.recipeSortDirection = "asc";
    }
    return renderRecipes();
  }

  const ingredientSort = event.target.closest("[data-sort-ingredient]");
  if (ingredientSort) {
    const key = ingredientSort.dataset.sortIngredient;
    if (state.ingredientSortKey === key) {
      state.ingredientSortDirection = state.ingredientSortDirection === "asc" ? "desc" : "asc";
    } else {
      state.ingredientSortKey = key;
      state.ingredientSortDirection = "asc";
    }
    return renderIngredients();
  }

  if (event.target.closest("#new-managed-ingredient")) return openManagedIngredient();

  const editIngredient = event.target.closest("[data-edit-ingredient]");
  if (editIngredient) return openManagedIngredient(Number(editIngredient.dataset.editIngredient));

  const deleteIngredient = event.target.closest("[data-delete-ingredient]");
  if (deleteIngredient) {
    return deleteManagedIngredient(
      Number(deleteIngredient.dataset.deleteIngredient),
      deleteIngredient.dataset.ingredientName,
    );
  }

  const add = event.target.closest("[data-add-recipe]");
  if (add) return addExistingRecipe(add.dataset.addRecipe);

  if (event.target.closest("#create-recipe-for-week")) {
    addRecipeDialog.close();
    return openRecipe(null, true);
  }

  if (event.target.closest("#add-selected-ingredient")) return addSelectedIngredient();
  if (event.target.closest("#toggle-new-ingredient")) return toggleNewIngredientFields();

  const quantityAdjustment = event.target.closest("[data-adjust-quantity]");
  if (quantityAdjustment) return adjustQuantity(quantityAdjustment);

  if (event.target.closest("#parse-recipe-ingredients")) return parseRecipeIngredients();

  const removeRow = event.target.closest("[data-remove-row]");
  if (removeRow) {
    captureIngredientRows();
    state.editorIngredients.splice(Number(removeRow.dataset.removeRow), 1);
    return renderIngredientRows();
  }

  if (event.target.closest("#create-ingredient")) return createIngredient();
  if (event.target.closest(".dialog-close")) return event.target.closest("dialog").close();
});

document.addEventListener("keydown", (event) => {
  if (event.target.matches(".row-ingredient-search")) {
    const combobox = event.target.closest(".ingredient-combobox");
    const options = [...combobox.querySelectorAll(".ingredient-suggestion")];
    const activeIndex = Number(combobox.dataset.activeIndex);
    if (event.key === "ArrowDown" && options.length) {
      event.preventDefault();
      setActiveIngredientSuggestion(combobox, activeIndex + 1);
      return;
    }
    if (event.key === "ArrowUp" && options.length) {
      event.preventDefault();
      setActiveIngredientSuggestion(combobox, activeIndex < 0 ? options.length - 1 : activeIndex - 1);
      return;
    }
    if (event.key === "Enter" && activeIndex >= 0 && options[activeIndex]) {
      event.preventDefault();
      chooseIngredientSuggestion(options[activeIndex]);
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      closeIngredientSuggestions(combobox);
      return;
    }
    if (event.key === "Enter" && event.target.id === "ingredient-add-search") {
      event.preventDefault();
      addSelectedIngredient();
      return;
    }
  }

  if ((event.key === "Enter" || event.key === " ") && event.target.matches(".meal-card")) {
    event.preventDefault();
    openRecipe(Number(event.target.dataset.openRecipe));
  }
});

document.addEventListener("focusin", (event) => {
  document.querySelectorAll(".ingredient-combobox").forEach((combobox) => {
    if (!combobox.contains(event.target)) closeIngredientSuggestions(combobox);
  });
  if (event.target.matches(".row-ingredient-search")
      && !event.target.closest(".ingredient-combobox").querySelector(".row-ingredient-id").value
      && event.target.value.trim().length >= 2) {
    updateIngredientSuggestions(event.target);
  }
});

document.addEventListener("focusout", (event) => {
  if (!event.target.matches(".row-ingredient-search")) return;
  const combobox = event.target.closest(".ingredient-combobox");
  if (!combobox.querySelector(".row-ingredient-id").value) {
    resolveExactIngredient(event.target);
  }
});

document.addEventListener("input", (event) => {
  if (event.target.matches(".row-ingredient-search")) {
    event.target.removeAttribute("aria-invalid");
    event.target.closest(".ingredient-combobox").classList.remove("invalid");
    updateIngredientSuggestions(event.target);
  }
  if (event.target.matches("#recipe-picker-search")) renderRecipePicker(event.target.value);
  if (event.target.matches("#recipe-search")) {
    state.recipeSearch = event.target.value;
    renderRecipeRows();
  }
  if (event.target.matches("#ingredient-search")) {
    state.ingredientSearch = event.target.value;
    renderIngredientTableRows();
  }
  if (event.target.matches("#suggestion-text")) {
    document.querySelector("#suggestion-count").textContent = `${event.target.value.length} / 500`;
  }
});

document.addEventListener("change", (event) => {
  if (event.target.matches("#recipe-category-filter")) {
    state.recipeCategory = event.target.value;
    renderRecipeRows();
  }
});

recipeForm.addEventListener("submit", saveRecipe);
ingredientForm.addEventListener("submit", saveManagedIngredient);
suggestionForm.addEventListener("submit", submitSuggestion);

async function initialize() {
  try {
    [state.meta, state.ingredients] = await Promise.all([api("/api/meta"), api("/api/ingredients")]);
    await loadWeek();
    pingCartExtension();
    setTimeout(pingCartExtension, 500);
  } catch (error) {
    weekView.innerHTML = `<div class="loading">${h(error.message)}</div>`;
    notify(error.message, true);
  }
}

initialize();
