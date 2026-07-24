# Meal Helper Whole Foods Cart

This optional Chrome extension transfers the Whole Foods portion of a locked
Meal Helper shopping list into a review plan. You choose and save a preferred
Amazon Whole Foods product for each ingredient. The extension can then visit
those saved product pages and click **Add to Cart** once per mapped ingredient.

It never proceeds to checkout. Always review package sizes, quantities,
substitutions, prices, and the final cart in Amazon.

## Install for testing

The unpacked extension works in desktop Chrome on macOS, Windows, and Linux:

1. Download or clone this repository and keep the extracted files in a stable
   location.
2. Open `chrome://extensions`.
3. Enable **Developer mode**.
4. Choose **Load unpacked**.
5. Select the `extension/whole-foods-cart-helper` directory.

Chrome shows the Meal Helper cart icon after installation. Reload
`https://meals.andreicristea.com` if it was already open.

An unpacked installation does not update itself. After pulling a newer version,
open `chrome://extensions` and press the extension's reload button.

## Use

1. Sign in to Amazon and choose the intended Whole Foods store or delivery
   address.
2. Lock a week in Meal Helper.
3. Choose **Populate Whole Foods cart** above the shopping list.
4. For every unmapped ingredient, choose **Choose product**, open the intended
   product, and save it.
5. Exclude any ingredients you do not want and start cart population. Requirements
   in multiple units are combined into one row for the same preferred product.
6. Review the resulting Amazon cart and check out manually.

Preferred product mappings and the current plan stay in Chrome's local
extension storage on that browser profile. They are not written to the Meal
Helper server or synchronized between computers.

## Limitations

- The helper clicks Add to Cart once per mapped ingredient. The required recipe
  quantity is shown for comparison, but package-size conversion is manual.
- Amazon can change its pages at any time. An item is marked for review when
  the helper cannot identify the Add to Cart control.
- Unavailable products, sign-in prompts, store changes, substitutions, and
  cart limits require manual handling.
- Only `amazon.com` and `wholefoodsmarket.com` product URLs can be saved.
- The current build is installed manually. An unlisted Chrome Web Store release
  can replace this process after live testing.

See [PRIVACY.md](PRIVACY.md) for data handling details.
