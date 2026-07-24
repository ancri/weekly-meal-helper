# Privacy

## Data stored

The extension stores the current shopping plan, preferred ingredient-to-product
mappings, and automation results in Chrome's local extension storage. Shopping
plans contain ingredient IDs, names, quantities, units, and the selected Amazon
product URL and title.

This data remains in the local Chrome profile. The extension does not send it
to the Meal Helper server, an analytics service, or the extension developer.
Chrome may include local extension data in browser-profile backups according to
the user's Chrome settings.

## Site access

The extension runs only on:

- `https://meals.andreicristea.com`
- `https://www.amazon.com`
- `https://www.wholefoodsmarket.com`

On Meal Helper, it receives a shopping plan only after the user chooses
**Populate Whole Foods cart**. On Amazon and Whole Foods pages, it reads the
current product title and locates an Add to Cart control only while selecting a
product or running a user-started cart plan.

## Data not collected

The extension does not request or store passwords, cookies, browsing history,
payment details, checkout details, or advertising identifiers. It has no
analytics, remote code, or third-party data transfer. It never completes a
purchase.

Uninstalling the extension removes its locally stored mappings and plans.
