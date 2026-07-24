const OVERLAY_ID = "meal-helper-product-chooser";

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

function cleanTitle() {
  const heading =
    document.querySelector("#productTitle") ||
    document.querySelector("h1") ||
    document.querySelector('[data-testid="product-title"]');
  return (heading?.textContent || document.title)
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 200);
}

function isProductPage() {
  return (
    /\/(?:dp|gp\/product)\//.test(location.pathname) ||
    Boolean(document.querySelector("#productTitle")) ||
    Boolean(document.querySelector('[data-testid="product-title"]'))
  );
}

function isVisible(control) {
  return (
    control instanceof HTMLElement &&
    !control.disabled &&
    control.getAttribute("aria-disabled") !== "true" &&
    control.getClientRects().length > 0
  );
}

function controlLabel(control) {
  const value = [
    control.getAttribute("aria-label"),
    control.getAttribute("title"),
    control.value,
    control.textContent,
  ]
    .filter(Boolean)
    .map((candidate) => String(candidate).replace(/\s+/g, " ").trim())
    .find(Boolean);
  return value || "";
}

function rootsUnder(root = document) {
  const roots = [root];
  for (const element of root.querySelectorAll("*")) {
    if (element.shadowRoot) roots.push(...rootsUnder(element.shadowRoot));
  }
  return roots;
}

function deepMatches(selectors, root = document) {
  return rootsUnder(root).flatMap((candidateRoot) =>
    [...candidateRoot.querySelectorAll(selectors)]
  );
}

function isAddLabel(label) {
  return (
    /^add(?:\s+\d+\s+items?)?$/i.test(label) ||
    /^add(?:\s+\d+\s+items?)?\s+to\s+(?:shopping\s+)?(?:cart|basket)\b/i.test(label)
  );
}

function chooserOverlay(chooser) {
  document.querySelector(`#${OVERLAY_ID}`)?.remove();
  const root = document.createElement("aside");
  root.id = OVERLAY_ID;
  root.style.cssText = [
    "position:fixed",
    "right:18px",
    "bottom:18px",
    "z-index:2147483647",
    "width:min(360px,calc(100vw - 36px))",
    "padding:14px",
    "color:#17211f",
    "background:#fff",
    "border:2px solid #285c50",
    "border-radius:6px",
    "box-shadow:0 12px 32px rgba(0,0,0,.24)",
    "font:14px/1.4 Arial,sans-serif",
  ].join(";");

  const title = document.createElement("strong");
  title.textContent = `Choose product for ${chooser.ingredientName}`;
  title.style.cssText = "display:block;margin-bottom:5px;font-size:15px;";
  root.append(title);

  const copy = document.createElement("div");
  copy.textContent = isProductPage()
    ? "Save this product as the preferred match."
    : "Open the product you want, then save it from its product page.";
  copy.style.cssText = "margin-bottom:11px;color:#5f6c68;";
  root.append(copy);

  const actions = document.createElement("div");
  actions.style.cssText = "display:flex;justify-content:flex-end;gap:8px;";
  const cancel = document.createElement("button");
  cancel.type = "button";
  cancel.textContent = "Cancel";
  cancel.style.cssText = "min-height:34px;padding:0 10px;background:#fff;border:1px solid #c7d0cd;border-radius:4px;";
  cancel.addEventListener("click", async () => {
    await runtimeMessage({ type: "CANCEL_PRODUCT_MAPPING" });
    root.remove();
  });
  actions.append(cancel);

  if (isProductPage()) {
    const save = document.createElement("button");
    save.type = "button";
    save.textContent = "Use this product";
    save.style.cssText = "min-height:34px;padding:0 11px;color:#fff;background:#285c50;border:0;border-radius:4px;font-weight:700;";
    save.addEventListener("click", async () => {
      save.disabled = true;
      save.textContent = "Saving...";
      const response = await runtimeMessage({
        type: "SAVE_PRODUCT_MAPPING",
        ingredientId: chooser.ingredientId,
        url: location.href,
        title: cleanTitle(),
      });
      if (!response.ok) {
        save.disabled = false;
        save.textContent = "Use this product";
        copy.textContent = response.error || "The product could not be saved.";
      }
    });
    actions.append(save);
  }
  root.append(actions);
  document.documentElement.append(root);
}

function findAddButton() {
  const directSelectors = [
    "#add-to-cart-button",
    "#freshAddToCartButton button",
    "#freshAddToCartButton input",
    'input[name="submit.add-to-cart"]',
    'button[data-action="add-to-cart"]',
    '[data-testid="add-to-cart-button"]',
    '[data-testid="addToCartButton"]',
    '[data-test-id="add-to-cart-button"]',
    '[data-a-selector="add-to-cart-button"]',
  ];
  for (const control of deepMatches(directSelectors.join(","))) {
    if (isVisible(control)) return control;
  }

  const purchaseScopes = deepMatches([
    "#buybox",
    "#desktop_buybox",
    "#rightCol",
    "#freshAddToCartButton",
    '[data-feature-name="addToCart"]',
    '[data-testid*="buy-box" i]',
    '[data-testid*="product-purchase" i]',
  ].join(","));
  for (const scope of purchaseScopes) {
    const controls = deepMatches(
      'button, input[type="button"], input[type="submit"], [role="button"]',
      scope
    );
    const match = controls.find((control) => {
      if (!isVisible(control)) return false;
      return isAddLabel(controlLabel(control));
    });
    if (match) return match;
  }

  const unambiguousMatches = deepMatches(
    'button, input[type="button"], input[type="submit"], [role="button"]'
  ).filter((control) => isVisible(control) && isAddLabel(controlLabel(control)));
  if (unambiguousMatches.length === 1) return unambiguousMatches[0];
  return null;
}

async function waitForAddButton(timeoutMs = 7000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const button = findAddButton();
    if (button) return button;
    await new Promise((resolve) => setTimeout(resolve, 350));
  }
  return null;
}

function failureMessage(item) {
  const pageText = (document.body?.innerText || "").replace(/\s+/g, " ");
  if (/currently unavailable|temporarily out of stock|not available for delivery/i.test(pageText)) {
    return `${item.name} appears unavailable for the selected address or store.`;
  }
  if (/select (?:a|your) (?:delivery )?(?:address|location)|choose your location/i.test(pageText)) {
    return `Amazon needs a delivery address or store before ${item.name} can be added.`;
  }
  const labels = [...new Set(
    deepMatches('button, input[type="button"], input[type="submit"], [role="button"]')
      .filter(isVisible)
      .map(controlLabel)
      .filter(Boolean)
  )].slice(0, 5);
  const details = labels.length ? ` Visible controls included: ${labels.join("; ")}.` : "";
  return `No Add to Cart control was found for ${item.name}.${details}`;
}

async function addCurrentItem(item) {
  if (/\/ap\/signin/.test(location.pathname) || document.querySelector("#ap_email")) {
    return {
      ok: false,
      code: "sign_in_required",
      message: "Sign in to Amazon, then run the cart helper again.",
    };
  }
  if (!isProductPage()) {
    return {
      ok: false,
      code: "not_a_product_page",
      message: `The saved link for ${item.name} did not open an Amazon product page. Choose the product again.`,
    };
  }
  const button = await waitForAddButton();
  if (!button) {
    return {
      ok: false,
      code: "add_button_not_found",
      message: failureMessage(item),
    };
  }
  button.scrollIntoView({ block: "center" });
  return {
    ok: true,
    message: `Clicked Add to Cart once; ${item.requiredText} needed. Verify the cart before checkout.`,
    button,
  };
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== "ADD_CURRENT_ITEM") return false;
  addCurrentItem(message.item)
    .then((result) => {
      const { button, ...response } = result;
      if (button) button.click();
      sendResponse(response);
    })
    .catch((error) => {
      sendResponse({ ok: false, code: "unexpected_error", message: error.message });
    });
  return true;
});

runtimeMessage({ type: "GET_CHOOSER" }).then((response) => {
  if (response?.chooser) chooserOverlay(response.chooser);
});

runtimeMessage({ type: "AMAZON_PAGE_READY" });
