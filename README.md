# G3M Mod Creator/Editor

Create, edit and package G3M mods in your browser. Use the exported ZIP with G3M 3.4.0 or newer.

- Edit mod details, authors, icons and tags, including mods for custom games.
- Add patches, copy files, unpack archives and include documentation. Choose whether to replace existing files, keep them, or clear a destination first.
- Arrange actions in order and organize them into nested groups.
- Reuse paths and specify mod dependencies, conflicts and load order.
- Calculate hashes for bundled files, folders and ZIP members, or select an original game file to calculate its target hash.
- Open existing G3M ZIPs or `mod_config.json`. Older G3M configs and Deltamod ZIPs with JSON or TOML metadata are converted to the current format.
- Keep script dependencies and other bundled files when editing a mod.
- Drop a ZIP or config onto the start page to open it. Drag files and folders into the editor, or onto source, icon and hash fields. Bundled files can also be dragged onto fields to reuse them.
- Save a ZIP or send the saved file to G3M through `g3m://`. Open any ZIP or file from Edit Mod to start a mod with its contents already bundled; drop multiple files or folders to bundle them at once.
- Available in English, Russian, Spanish, Japanese, Korean, Simplified Chinese and Traditional Chinese.

Edit Mod accepts G3M and Deltamod archives, ordinary ZIP files, individual files, and dropped folders. Ordinary imports start with an empty mod configuration; assign actions and targets before saving.

To export to G3M, save the ZIP, then enter its full local path. G3M must be installed and registered to open `g3m://` links. Browsers cannot supply the downloaded file’s full path automatically.

The web editor creates `mod_config.json 2.0.0` archives. It packages patches and scripts; G3M applies them. Test the mod in G3M before sharing it. Archives are limited to 1 GiB unpacked in total and 512 MiB per file. Hashes for files inside archives other than ZIP are checked by G3M.

## Development

```sh
npm ci
npm run dev
npm test
npm run test:e2e
npm run build
```

Browser tests use installed Edge on Windows. On other systems, install Chromium with `npx playwright install chromium` first. Browser tests also import the downloaded ZIP into G3M when a source checkout and its Python environment are available.

The G3M compatibility test runs automatically when `../G3M/.venv` exists. To use another checkout, set `G3M_ROOT` and `G3M_PYTHON`. It checks the desktop validator, old-config conversion, folder hashes, and imports exported archives into temporary libraries without touching installed mods.



