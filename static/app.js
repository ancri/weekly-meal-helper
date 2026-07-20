const state = {
  meta: null,
  week: null,
  recipes: [],
  ingredients: [],
  editorIngredients: [],
  editingRecipeId: null,
  addCreatedRecipeToWeek: false,
  view: "week",
};

const weekView = document.querySelector("#week-view");
const recipesView = document.querySelector("#recipes-view");
const recipeDialog = document.querySelector("#recipe-dialog");
const addRecipeDialog = document.querySelector("#add-recipe-dialog");
const recipeForm = document.querySelector("#recipe-form");
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
          <strong>${week.accepted_count} meals</strong>
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

async function loadRecipes(query = "") {
  state.recipes = await api(`/api/recipes?q=${encodeURIComponent(query)}`);
  renderRecipes();
}

function renderRecipes() {
  recipesView.innerHTML = `
    <div class="page-shell">
      <div class="recipe-page-header">
        <div><p class="eyebrow">Library</p><h1>Recipes</h1></div>
        <div class="recipe-tools">
          <input id="recipe-search" type="search" value="${h(document.querySelector("#recipe-search")?.value || "")}" placeholder="Search recipes" aria-label="Search recipes">
          <button id="new-recipe" class="button primary">+ New recipe</button>
        </div>
      </div>
      <table class="recipe-table">
        <thead><tr><th>Recipe</th><th>Category</th><th>Last cooked</th><th>Ingredients</th><th></th></tr></thead>
        <tbody>
          ${state.recipes.map((recipe) => `
            <tr>
              <td><strong>${h(recipe.name)}</strong></td>
              <td><span class="category-tag">${h(state.meta.categories[recipe.category])}</span></td>
              <td>${h(shortDate(recipe.last_eaten))}</td>
              <td>${recipe.ingredient_count}</td>
              <td><button class="text-button" data-edit-recipe="${recipe.id}">Edit</button></td>
            </tr>`).join("")}
        </tbody>
      </table>
    </div>`;
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
    if (state.view === "recipes") await loadRecipes(document.querySelector("#recipe-search")?.value || "");
    notify("Recipe saved.");
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
  if (view === "recipes") loadRecipes().catch((error) => notify(error.message, true));
}

document.addEventListener("click", async (event) => {
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

  const meal = event.target.closest("[data-open-recipe]");
  if (meal) return openRecipe(Number(meal.dataset.openRecipe));

  if (event.target.closest("#lock-week")) return lockWeek();
  if (event.target.closest("#open-recipe-picker")) return openRecipePicker();
  if (event.target.closest("#new-recipe")) return openRecipe();

  const edit = event.target.closest("[data-edit-recipe]");
  if (edit) return openRecipe(Number(edit.dataset.editRecipe));

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
    clearTimeout(state.searchTimer);
    state.searchTimer = setTimeout(() => loadRecipes(event.target.value).catch((error) => notify(error.message, true)), 180);
  }
});

recipeForm.addEventListener("submit", saveRecipe);

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
