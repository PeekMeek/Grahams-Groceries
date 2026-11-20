# Pantry — home food inventory, grocery list & recipes

A Progressive Web App for the household. No build step: plain HTML, CSS and JavaScript, ready for GitHub Pages.

## What it does

**Stock**
- Every food item with a quantity, category → type (e.g. Meats → Poultry / Beef / Seafood), optional photo, unit and notes.
- **All** view (alphabetical) or **By category** view, with a second row of type filters inside each category.
- **−** / **+** buttons tick quantities down or up.
- **★ Star** the things you always want in the house. When a starred item drops to **2 or fewer**, it shows up faded at the top of the grocery list until someone taps **Add** (or ✕ for "not now").
- Tap a non-prepared item (e.g. ground beef) to see every recipe that uses it, with whether you have everything to make it, and a button to put the missing ingredients on the grocery list.

**Scan list**
- Take a photo of a list ("3 ground beef", "milk x2", "eggs - 12", "2 lb chicken"...). The app reads it, matches each line to existing stock, and shows a review screen before changing anything.
- Modes: **Add to stock** (after shopping), **Set counts** (after a pantry count), **Used up**.
- You can also type or paste a list.
- Reading engine: with an Anthropic API key in Settings, Claude reads the photo, which handles handwriting well. Without a key, the free built-in reader (Tesseract) is used. It is fine for neat or printed lists and poor at handwriting.

**Grocery**
- Anyone can add an item, with a quantity, photo, category and note. Each item shows who added it and when.
- Tick the checkbox when it's picked up. If it matches a stock item, the stock goes up automatically (with Undo). If not, the app offers "Add to stock".
- All and By category views, same as Stock.

**Recipes**
- A dish photo, ingredients, numbered steps, and timestamped notes/feedback from anyone in the house.
- Each ingredient has "uses": how many of the matching stock item one batch uses up (for example, 1 pack of ground beef). Tick "staple" for things you don't track, such as salt.
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
