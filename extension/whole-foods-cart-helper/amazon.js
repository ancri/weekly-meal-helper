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
    'input[name="submit.add-to-cart"]',
    'button[data-action="add-to-cart"]',
    'button[aria-label*="Add to Cart" i]',
    'button[aria-label*="Add to cart" i]',
  ];
  for (const selector of directSelectors) {
    const button = document.querySelector(selector);
    if (button && !button.disabled && button.getClientRects().length) return button;
  }
  return null;
}

async function waitForAddButton(timeoutMs = 12000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const button = findAddButton();
    if (button) return button;
    await new Promise((resolve) => setTimeout(resolve, 350));
  }
  return null;
}

async function addCurrentItem(item) {
  if (/\/ap\/signin/.test(location.pathname) || document.querySelector("#ap_email")) {
    return {
      ok: false,
      code: "sign_in_required",
      message: "Sign in to Amazon, then run the cart helper again.",
    };
  }
  const button = await waitForAddButton();
  if (!button) {
    return {
      ok: false,
      code: "add_button_not_found",
      message: `No Add to Cart button was found for ${item.name}.`,
    };
  }
  button.scrollIntoView({ block: "center" });
  button.click();
  await new Promise((resolve) => setTimeout(resolve, 1500));
  return {
    ok: true,
    message: `Clicked Add to Cart once; ${item.requiredText} needed. Verify the cart before checkout.`,
  };
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== "ADD_CURRENT_ITEM") return false;
  addCurrentItem(message.item)
    .then(sendResponse)
    .catch((error) => {
      sendResponse({ ok: false, code: "unexpected_error", message: error.message });
    });
  return true;
});

runtimeMessage({ type: "GET_CHOOSER" }).then((response) => {
  if (response?.chooser) chooserOverlay(response.chooser);
});

runtimeMessage({ type: "AMAZON_PAGE_READY" });
