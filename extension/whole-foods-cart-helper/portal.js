const PAGE_SOURCE = "meal-helper-page";
const EXTENSION_SOURCE = "meal-helper-cart-extension";

function postToPage(type, payload = {}) {
  window.postMessage(
    { source: EXTENSION_SOURCE, type, ...payload },
    window.location.origin
  );
}

window.addEventListener("message", (event) => {
  if (
    event.source !== window ||
    event.origin !== window.location.origin ||
    event.data?.source !== PAGE_SOURCE
  ) {
    return;
  }

  if (event.data.type === "PING_CART_EXTENSION") {
    postToPage("CART_EXTENSION_READY", {
      version: chrome.runtime.getManifest().version,
    });
    return;
  }

  if (event.data.type === "POPULATE_WHOLE_FOODS_CART") {
    chrome.runtime.sendMessage(
      {
        type: "START_CART_JOB",
        weekStart: event.data.weekStart,
        items: event.data.items,
      },
      (response) => {
        if (chrome.runtime.lastError) {
          postToPage("CART_EXTENSION_ERROR", {
            error: chrome.runtime.lastError.message,
          });
          return;
        }
        if (!response?.ok) {
          postToPage("CART_EXTENSION_ERROR", {
            error: response?.error || "The cart helper could not start.",
          });
          return;
        }
        postToPage("CART_EXTENSION_JOB_STARTED", {
          itemCount: response.itemCount,
        });
      }
    );
  }
});

postToPage("CART_EXTENSION_READY", {
  version: chrome.runtime.getManifest().version,
});
