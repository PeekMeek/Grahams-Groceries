# Pantry — home food inventory, grocery list & recipes

A Progressive Web App for the household. No build step: plain HTML, CSS and JavaScript, ready for GitHub Pages.

## What it does

**Stock**
- Three columns: **Fridge**, **Pantry** and **Deep freezer**. On a phone, a switcher at the top shows one column at a time. Each item's location is set on its screen ("Kept in"). New items get a sensible default: meat and dairy go in the fridge, frozen foods and ice cream in the freezer, dry goods and household goods in the pantry.
- **Units:** each item has **How many** and **Size of one** (e.g. 1 lb, 12 oz, 1 can). The item screen shows the total (5 × 1 lb = 5 lb), and rows show "1 lb each · 5 lb total". Leave the size empty for things you just count. Scanned lines fill this in: "10x 12 oz steamable corn" becomes 10 × 12 oz, and "2 lb ground beef" added to 1 lb packs adds 2.
- **Recipes use the units:** when an ingredient's amount has a unit that matches its stock item ("1 lb" of ground beef kept in 1 lb packs, "12 oz" of cheddar kept in 8 oz blocks), the recipe works out how many it uses (1 and 1.5). The recipe page shows "have 3 lb · need 1 lb", and the batch size scales it. When units can't be compared (cups vs. oz, "1 large onion"), set **uses** yourself in the recipe editor.
- **Used some:** each item's screen has a **Used some?** box for things used outside recipes. Enter an amount in the item's units (e.g. 8 oz) or as a number of items, or tap a quick button (¼, ½, 1). The stock goes down, and **Recent use** keeps a dated log of who used how much. Uses from **Made it** go into the same log with the recipe's name.
- **Moving items:** tap **⇄** on any row and pick Fridge, Pantry or Deep freezer (with Undo). On a computer you can also drag a row onto another column. The time-in-inventory counter keeps running when you move something.
- **Time in inventory:** each item counts the days since it was added. The counter restarts when an item is restocked after running out, or when you tap **Restocked today** on the item. Rows show the age (⏱ 5d, 6mo...).
- **Freshness borders:** a yellow border appears after the warning limit and a red border after double the limit. Defaults: fridge 14 days, pantry 365 days, deep freezer 180 days. Change them in ⚙︎ Settings → Freshness warnings (shared with the household). Any item can have its own limit ("Warn after (days)"). Household goods and items with 0 left don't get borders.
- Every food item with a quantity, category → type (e.g. Meats → Poultry / Beef / Seafood), optional photo, unit and notes.
- **All** view (alphabetical) or **By category** view, with a second row of type filters inside each category.
- **−** / **+** buttons tick quantities down or up.
- **Household goods** has its own category, with types for paper goods, cleaning, laundry, dish & kitchen, trash bags, batteries & bulbs, toiletries, medicine & first aid, and pet supplies. Items are sorted into these automatically when you add or scan them ("toilet paper", "dish soap", "AA batteries"...). Household goods never get recipe suggestions.
- In **By category** view, every category and type is listed, even empty ones, so you can open one and add straight into it.
- **★ Star** the things you always want in the house. When a starred item drops to **2 or fewer**, it shows up faded at the top of the grocery list until someone taps **Add** (or ✕ for "not now").
- Tap an item to see **Suggested recipes** that use it at the bottom of its screen. Recipes you can make right now are listed first. Ones with missing ingredients have an **🛒 Add to grocery list** button.

**Scan list**
- Take a photo of a list ("3 ground beef", "milk x2", "eggs - 12", "2 lb chicken"...). The app reads it, matches each line to existing stock, and shows a review screen before changing anything.
- Quantities it understands: counts ("2x milk", "milk 1x", "x2 bananas", "3 limes"), fractions and mixed numbers ("1/4", "1 1/2", "½"), weights ("1 lb", "12 oz", "2#", "500 g", "1 kg"), package counts ("3 cans", "2 bags", "1 dozen eggs") and combinations ("2x 1 lb ground beef" = 2 lb). The review screen shows the amount and unit for each line. You can edit both, and fractions like 3/4 can be typed in.
- Weights convert to match how an item is tracked. If an item's unit is lb, "12 oz" adds 0.75 lb. If an item is counted in packs (no unit), a weighed line counts as 1 pack, or 2 for "2x 1 lb". To track something by weight, set its Unit to lb, oz, g or kg.
- Modes: **Add to stock** (after shopping), **Set counts** (after a pantry count), **Used up**.
- You can also type or paste a list.
- Reading engine: with an Anthropic API key in Settings, Claude reads the photo, which handles handwriting well. Without a key, the free built-in reader (Tesseract) is used. It is fine for neat or printed lists and poor at handwriting.

**Spices**
- A tab of everything in Pantry → Spices. Spices are recognised automatically when you add or scan them (cumin, smoked paprika, garam masala, bay leaves...).
- **Most used:** ranked by how often each spice was used, counting "Used some" entries plus every time a recipe containing it was made. It shows when each was last used.
- **Cuisine:** grouped by cuisine (Everyday, American, Mexican, Italian, Mediterranean, French, Middle Eastern, Indian, Asian, Baking), with filter chips. Common spices get cuisines automatically. Change them on the spice's screen, where you can also add your own (e.g. Filipino, Tex-Mex).
- **Most in stock:** sorted by the amount on hand.

**Grocery**
- Anyone can add an item, with a quantity, photo, category and note. Each item shows who added it and when.
- Tick the checkbox when it's picked up. If it matches a stock item, the stock goes up automatically (with Undo). If not, the app offers "Add to stock".
- All and By category views, same as Stock.
- **Prices and buy links:** tap an item on the Stock tab, or an ingredient on a recipe, to enter the price you paid (each) and a link to buy it. The grocery list then shows the price per row (price × quantity), a 🔗 button that opens the buy link, and an **Estimated total** bar at the bottom. The total covers what's still to buy and notes any items without a price. You can also set the price and link from a grocery item's edit screen.

**Recipes**
- A dish photo, ingredients, numbered steps, and timestamped notes/feedback from anyone in the house.
- Each ingredient has "uses": how many of the matching stock item one batch uses up (for example, 1 pack of ground beef). Tick "staple" for things you don't track, such as salt.
- **📷 Scan a recipe** (on the Recipes tab, or at the top of a new recipe): photograph a cookbook page, recipe card or screenshot. You can add several photos for a recipe that spans pages. The title, servings, time, ingredients and steps fill themselves in for you to check before saving. Ingredients are matched to your stock names, and basics like salt and pepper are ticked as staples. A Claude API key gives the best results, especially for handwritten cards. Without one, the free reader works for clearly printed recipes with "Ingredients" and "Directions" headings.
- **Batch size**: on a recipe, pick 0.5×, 1×, 1.5×, 2× or Custom (type any size, e.g. 3 or 0.75). Ingredient amounts, servings, the "have everything?" check, **Made it**, **Add missing** and the printout all follow the batch size. The step text is not changed.
- **Leftovers:** "Made it" can also put the dish in the **Fridge** as a leftover (ticked by default), with a 4-day shelf life: yellow border at 4 days, red at 8. You can change this in Settings → Freshness warnings. Instead of − / +, leftovers have **Use…** with **Use ¼**, **Use ½**, **Finished it** and **Throw out the rest**. When the leftovers are finished or thrown out, the app asks for notes for next time and adds them to the recipe's notes, labelled *leftovers*, e.g. "Leftovers thrown out after 6 days (¼ left)". The recipe page shows any leftovers still in the fridge.
- **✓ Made it** takes the ingredients out of stock (you can untick any) and logs a "made it" note.
- **🖨 Print** produces a single A4 page with a thumbnail in the top-left. If the recipe is long, the text shrinks to fit (down to 7pt at most).
- The "Can make now" filter shows only recipes you have everything for.

## Run it locally

```powershell
cd pantry-pwa
python -m http.server 8080
# open http://localhost:8080
```

## Put it on GitHub Pages (PowerShell)

```powershell
cd pantry-pwa
git remote add origin https://github.com/<you>/pantry-pwa.git
git push -u origin main
```

On GitHub, go to the repo → **Settings → Pages → Build and deployment → Deploy from a branch → `main` / root**. The app will be at `https://<you>.github.io/pantry-pwa/`. Open it on each phone and use **Add to Home Screen** (Safari) or **Install app** (Chrome).

To update later:

```powershell
git add -A
git commit -m "Describe the change"
git push
```

When you change files, also bump `VERSION` in `sw.js` (e.g. `pantry-v3`) so installed phones pick up the new version.

## Sharing the list between phones (GitHub)

The app itself is just files on GitHub Pages, so each phone needs somewhere shared to save the list. That place is your repo:

- Changes are saved to a separate branch called **`pantry-data`** (the app creates it). It holds `pantry.json` and a `photos/` folder. Using its own branch means list changes don't rebuild the website.
- A change on one phone is saved about 2 seconds later. Each commit is named after the person, e.g. "Miko updated the pantry".
- Other phones check every 30 seconds, and whenever the app is reopened. When someone else has saved, a yellow **"The list was updated on another phone — Refresh"** banner appears.
- Before saving, the app always reads the latest copy and merges it. Two people editing at the same time won't wipe out each other's changes.
- Changes made with no signal are kept on the phone and saved when the connection comes back.
- The dot in the top bar shows status: green means up to date, yellow means saving or waiting, red means a problem (tap ⚙︎ to see what).

### One-time setup

1. **Create an access token** at https://github.com/settings/personal-access-tokens/new (Fine-grained token):
   - Name: `Pantry`
   - Expiration: the longest offered is easiest. When it expires, the dot turns red. Make a new token and paste it in again.
   - Repository access: **Only select repositories** → `pantry-pwa`
   - Permissions → Repository permissions → **Contents: Read and write**
   - Click **Generate token** and copy it (it starts with `github_pat_`).
2. On each phone, open the app → **⚙︎ Settings → Share the list (GitHub)**:
   - Repository is filled in automatically from the web address (e.g. `your-name/pantry-pwa`).
   - Paste the token, then tap **Save & connect**.

Every phone can use the same token. Send it to the household privately (not in a public post). The token can only change the contents of this one repo.

Privacy note: if the repo is **public**, anyone who finds it on GitHub can read the `pantry-data` branch (the list, recipes and photos). They can't change it without the token. If you'd rather keep it hidden, make the repo private. GitHub Pages on a private repo needs a paid GitHub plan.

## Claude API key (optional, for handwriting)

1. Create a key at https://console.anthropic.com → API Keys. This uses pay-as-you-go credit, which works out to a fraction of a cent per photo.
2. Paste it in **⚙︎ Settings → Reading handwritten lists** on each phone that will scan lists. The key is stored only on that device and is never synced.
3. The Model field defaults to `claude-sonnet-5-5`. You can change it there.

## Files

| File | Purpose |
|---|---|
| `index.html` | App shell and tab bar |
| `css/app.css` | All styling, including the A4 print layout |
| `js/app.js` | Screens, actions, recipe and stock logic |
| `js/db.js` | On-device storage (IndexedDB) |
| `js/github.js` | Saving to / loading from the repo, refresh banner checks |
| `js/ocr.js` | Reading list photos and parsing lines |
| `js/categories.js` | Default categories and types (also editable in Settings) |
| `sw.js` | Offline caching |

## Tweaks

- How often other phones check for changes: `setInterval(check, 30000)` at the bottom of `js/github.js` (milliseconds).
- Low-stock threshold: `LOW` at the top of `js/app.js`.
- How faded the "running low" suggestions are: `--ghost-opacity` in `css/app.css` (0 = invisible, 1 = solid).
- Colours: the variables at the top of `css/app.css`.
- Back up or move data: **Settings → Export backup / Import backup** (JSON).
