# OpenFramerSync — any REST/JSON API → Framer CMS

A free, open-source Framer plugin that syncs **any RESTful JSON API** into a Framer CMS
collection — an open alternative to paid API-sync plugins. Works out of the box with
[OpenCMS](https://github.com/clawnify/open-cms), and with any endpoint that returns a
JSON array of records.

## How it works

Framer exposes CMS **write** access only through the Plugin/Server API's `ManagedCollection`
interface — there is no generic HTTP endpoint to POST content into a Framer collection. This
plugin runs inside the Framer editor as a managed-collection source: you pick a collection,
point it at your API, map the fields, and Framer gets a native **Sync** button that re-pulls on
demand.

1. **Connect a source** — paste the API URL. Optionally set the method, request headers
   (for API-key / bearer auth), and an items path (e.g. `data.items`) if the array is nested.
2. **Map fields** — the plugin fetches the data, infers a Framer field type for each property,
   and lets you rename fields, exclude any you don't want, and **override the type** of any
   field. Pick which field is the unique **slug**.
3. **Import** — records are written to the collection. Re-open the plugin (or use Framer's Sync)
   to pull the latest; items removed at the source are removed from the collection.

## Field types & conversions

Inference is a starting guess — you can change any field's type in the mapping step. Values are
converted to match the **target Framer type**:

| Framer type       | Accepts / conversion                                                        |
| ----------------- | --------------------------------------------------------------------------- |
| Plain Text        | any value (objects are JSON-stringified)                                    |
| Formatted Text    | HTML passthrough **or** Tiptap JSON (`{ "type": "doc", … }`) rendered to HTML |
| Number            | numeric strings coerced                                                      |
| Boolean           | `true`/`1`/non-empty → true                                                  |
| Date              | parsed to ISO 8601                                                           |
| Image / File      | URL string; **relative paths are absolutized** against the source origin     |
| Link / Color      | string                                                                       |

**OpenCMS specifics** are handled automatically: rich-text stored as Tiptap JSON is rendered to
HTML for Formatted Text fields, and relative `/api/uploads/…` image URLs are made absolute.

> Enum and collection-reference fields are out of scope for v1 (they need case / related-collection
> discovery beyond a flat JSON response).

## Requirements for the source API

- Returns a JSON **array** of records (or an object with an array property — set the items path).
- **CORS**: the endpoint must allow cross-origin reads from the Framer editor, since the plugin
  fetches it from the browser. OpenCMS's public read API already does.
- Each record needs a stable, unique, string-ish field to use as the **slug**.

## Development

```bash
npm install
npm run dev      # opens the plugin against the Framer editor (mkcert HTTPS)
npm run check    # typecheck + lint
npm run build    # production bundle in dist/
```

Load it in Framer via **Plugins → Develop → Open Development Plugin** and point it at the dev URL.

## Publishing

`framer.json` carries a local development `id`. To publish to the Framer Marketplace, create the
plugin in Framer (which assigns the real id), then `npm run build` and submit `dist/`. See
[Framer's plugin docs](https://www.framer.com/developers/).

## License

MIT
