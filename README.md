# Pixels

A free pixel art editor and Minecraft skin maker that runs in the browser. No account, no install: drawings are saved in your own browser.

**Live:** https://pixels.brandonj.ink

![icon](public/icon-192.png)

## What it does

- **Pixel art:** pencil, eraser, fill, shapes, spray, gradient, lasso, magic wand, mirrors, dithering, pixel-perfect lines, tile mode, custom brushes, pen pressure.
- **Layers and animation:** layers with blend modes, groups, linked cels, tags, onion skin, tilemaps, frame timing. Exports to PNG, sprite sheet (with JSON), GIF and `.aseprite`, and opens `.aseprite`/`.ase` files.
- **Colour:** colour wheel, palettes (import/export), colour ramps, indexed colour mode, adjustments.
- **Minecraft skins:** paint on the flat texture or straight onto a 3D model, classic or slim arms, a character starter (skin tones, hair, eyes, clothes), and import a skin by Java username.
- **Tablets and phones:** opens in a full-screen focus mode with everything in one bar across the top; selections scale and rotate with drag handles.
- **Free asset packs:** import zipped sprite and tile packs.

## How it's built

Plain HTML, CSS and JavaScript modules. No framework and no build step.

- `public/` is the whole editor, served as static files.
- `worker.js` is a small Cloudflare Worker. It serves `public/` and one API route, `GET /api/skin/<username>`, which fetches a player's skin from Mojang (their servers don't allow browser requests directly).
- `wrangler.toml` configures the Worker.

## Run it locally

Any static file server works for the editor:

```sh
cd public
python3 -m http.server 8787
# open http://localhost:8787
```

To run it with the Worker (needed for skin import by username):

```sh
npx wrangler dev
```

## Deploy

```sh
npx wrangler deploy
```

Change the `routes` entry in `wrangler.toml` to your own domain first.

## License

MIT. See [LICENSE](LICENSE).
