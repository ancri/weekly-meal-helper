const state = {
  meta: null,
  week: null,
  recipes: [],
  ingredients: [],
  editorIngredients: [],
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
};

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
      <div class="meal-spacer"></div>
      ${locked ? `<span class="category-tag">${item.state === "accepted" ? "On the menu" : h(item.state)}</span>` : decisionControl(item)}
    </article>`;
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
  return `
    <section class="shopping-section">
      <p class="eyebrow">Combined quantities</p>
      <h2>Shopping list</h2>
      <div class="shopping-columns">
        ${shoppingColumn("Whole Foods", shopping.whole_foods)}
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
  document.querySelector("#recipe-dialog-title").textContent = recipeId ? "Edit recipe" : "New recipe";
  document.querySelector("#recipe-name").value = recipe.name;
  document.querySelector("#recipe-category").innerHTML = categoryOptions(recipe.category);
  document.querySelector("#recipe-url").value = recipe.url || "";
  document.querySelector("#recipe-instructions").value = recipe.instructions || "";
  document.querySelector("#new-ingredient-unit").innerHTML = unitOptions();
  document.querySelector("#new-ingredient-name").value = "";
  document.querySelector("#new-ingredient-whole-foods").checked = true;
  renderIngredientRows();
  recipeDialog.showModal();
}

function ingredientOptions(selected) {
  return `<option value="">Choose ingredient</option>${state.ingredients.map((ingredient) => `
    <option value="${ingredient.id}" ${Number(selected) === ingredient.id ? "selected" : ""}>${h(ingredient.name)}${ingredient.whole_foods ? "" : " (elsewhere)"}</option>`).join("")}`;
}

function renderIngredientRows() {
  const target = document.querySelector("#ingredient-rows");
  if (!state.editorIngredients.length) {
    target.innerHTML = '<div class="ingredient-empty">No ingredients added.</div>';
    return;
  }
  target.innerHTML = state.editorIngredients.map((item, index) => `
    <div class="ingredient-row" data-row="${index}">
      <select class="row-ingredient" aria-label="Ingredient">${ingredientOptions(item.id)}</select>
      <input class="row-quantity" type="number" value="${h(item.quantity)}" min="0.01" step="0.01" aria-label="Quantity">
      <select class="row-unit" aria-label="Unit">${unitOptions(item.unit)}</select>
      <button type="button" class="remove-row" data-remove-row="${index}" aria-label="Remove ingredient" title="Remove ingredient">&times;</button>
    </div>`).join("");
}

function captureIngredientRows() {
  state.editorIngredients = [...document.querySelectorAll(".ingredient-row")].map((row) => ({
    id: Number(row.querySelector(".row-ingredient").value),
    quantity: Number(row.querySelector(".row-quantity").value),
    unit: row.querySelector(".row-unit").value,
  }));
}

async function saveRecipe(event) {
  event.preventDefault();
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
    notify("Ingredient created and added.");
  } catch (error) {
    notify(error.message, true);
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

document.addEventListener("click", async (event) => {
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
  if (event.target.closest("#open-recipe-picker")) return openRecipePicker();
  if (event.target.closest("#new-recipe")) return openRecipe();

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

  if (event.target.closest("#add-ingredient-row")) {
    captureIngredientRows();
    state.editorIngredients.push({ id: 0, quantity: 1, unit: "pieces" });
    return renderIngredientRows();
  }

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
  if ((event.key === "Enter" || event.key === " ") && event.target.matches(".meal-card")) {
    event.preventDefault();
    openRecipe(Number(event.target.dataset.openRecipe));
  }
});

document.addEventListener("input", (event) => {
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
  } catch (error) {
    weekView.innerHTML = `<div class="loading">${h(error.message)}</div>`;
    notify(error.message, true);
  }
}

initialize();
