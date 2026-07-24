const statusTarget = document.querySelector("#popup-status");

chrome.storage.local.get(["currentJob"], ({ currentJob: job }) => {
  if (!job) {
    statusTarget.textContent =
      "No cart plan yet. Start one from a locked week in Meal Helper.";
    return;
  }
  const mapped = job.items.filter((item) => item.productUrl).length;
  statusTarget.textContent =
    `${job.items.length} ingredients in the current plan; ${mapped} mapped.`;
});

document.querySelector("#open-review").addEventListener("click", () => {
  chrome.runtime.sendMessage({ type: "OPEN_REVIEW" }, () => window.close());
});
