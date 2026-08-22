import {
    type FieldDataInput,
    framer,
    type ManagedCollection,
    type ManagedCollectionFieldInput,
    type ManagedCollectionItemInput,
    type ProtectedMethod,
} from "@framer/plugin"
import { generateHTML } from "@tiptap/html"
import Image from "@tiptap/extension-image"
import Link from "@tiptap/extension-link"
import StarterKit from "@tiptap/starter-kit"

/**
 * Generic REST/JSON → Framer CMS sync.
 *
 * Point the plugin at any endpoint that returns a JSON array of records
 * (OpenCMS, a headless CMS, an internal API…). Fields are inferred from
 * the response and every field's Framer type can be overridden in the
 * mapping step. Value conversion is keyed on the *target* Framer field
 * type, so the same engine serves any source.
 *
 * OpenCMS works out of the box via two inference heuristics: Tiptap rich
 * text (`{ "type": "doc", … }`) is rendered to HTML for `formattedText`,
 * and relative `/api/uploads/…` image URLs are absolutized against the
 * source origin.
 */

// The subset of Framer managed-collection field types this plugin maps to.
// (enum/reference are intentionally out of scope for v1 — they need case /
// collection discovery beyond a flat JSON response.)
export const SUPPORTED_FIELD_TYPES = [
    "string",
    "formattedText",
    "number",
    "boolean",
    "date",
    "image",
    "file",
    "link",
    "color",
] as const

export type SupportedFieldType = (typeof SUPPORTED_FIELD_TYPES)[number]

export const FIELD_TYPE_LABELS: Record<SupportedFieldType, string> = {
    string: "Plain Text",
    formattedText: "Formatted Text",
    number: "Number",
    boolean: "Boolean",
    date: "Date",
    image: "Image",
    file: "File",
    link: "Link",
    color: "Color",
}

export const PLUGIN_KEYS = {
    /** JSON-encoded SourceConfig — everything needed to re-fetch on sync. */
    SOURCE_CONFIG: "sourceConfig",
    SLUG_FIELD_ID: "slugFieldId",
} as const

export interface HeaderPair {
    key: string
    value: string
}

export interface SourceConfig {
    url: string
    method: "GET" | "POST"
    headers: HeaderPair[]
    /** Dot-path to the array inside the response, e.g. "data.items". Empty = auto-detect. */
    itemsPath: string
}

export function emptySourceConfig(): SourceConfig {
    return { url: "", method: "GET", headers: [], itemsPath: "" }
}

export interface DataSource {
    config: SourceConfig
    /** Origin of the source URL — used to absolutize relative asset paths. */
    origin: string
    /** Inferred fields (initial guess; user may re-type them in the mapping UI). */
    fields: ManagedCollectionFieldInput[]
    /** Raw records, untransformed. Shaped per target field type at sync time. */
    rawItems: Record<string, unknown>[]
}

// ── Fetch + locate the record array ───────────────────────────────────

function headersToObject(pairs: HeaderPair[]): Record<string, string> {
    const out: Record<string, string> = {}
    for (const { key, value } of pairs) {
        const k = key.trim()
        if (k) out[k] = value
    }
    return out
}

/** Walk a dot-path ("data.items") into a nested object. */
function resolvePath(json: unknown, path: string): unknown {
    if (!path.trim()) return json
    let cur: unknown = json
    for (const segment of path.split(".")) {
        const key = segment.trim()
        if (!key) continue
        if (cur && typeof cur === "object") {
            cur = (cur as Record<string, unknown>)[key]
        } else {
            return undefined
        }
    }
    return cur
}

/** Find the record array: explicit path → response-is-array → first array-valued property. */
function locateArray(json: unknown, itemsPath: string): Record<string, unknown>[] {
    const atPath = resolvePath(json, itemsPath)
    if (Array.isArray(atPath)) return atPath as Record<string, unknown>[]

    if (Array.isArray(json)) return json as Record<string, unknown>[]

    if (json && typeof json === "object") {
        // Common wrappers first, then any array-valued property.
        const obj = json as Record<string, unknown>
        for (const key of ["data", "items", "results", "records", "entries"]) {
            if (Array.isArray(obj[key])) return obj[key] as Record<string, unknown>[]
        }
        for (const value of Object.values(obj)) {
            if (Array.isArray(value)) return value as Record<string, unknown>[]
        }
    }

    throw new Error(
        itemsPath.trim()
            ? `No array found at path "${itemsPath}".`
            : "Response is not a JSON array and no array property was found. Set an items path (e.g. \"data\")."
    )
}

export async function fetchDataSource(config: SourceConfig, abortSignal?: AbortSignal): Promise<DataSource> {
    const url = config.url.trim()
    if (!url) throw new Error("Enter a source URL.")

    let origin = ""
    try {
        origin = new URL(url).origin
    } catch {
        throw new Error(`Invalid URL: ${url}`)
    }

    const response = await fetch(url, {
        method: config.method,
        headers: headersToObject(config.headers),
        signal: abortSignal,
    })
    if (!response.ok) {
        throw new Error(`Request failed: ${response.status} ${response.statusText}`)
    }

    const json = (await response.json()) as unknown
    const rawItems = locateArray(json, config.itemsPath)
    const fields = inferFields(rawItems)

    return { config, origin, fields, rawItems }
}

// ── Field inference ────────────────────────────────────────────────────

function humanize(key: string): string {
    return key
        .replace(/[_-]+/g, " ")
        .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
        .replace(/\b\w/g, c => c.toUpperCase())
        .trim()
}

const IMAGE_EXT = /\.(png|jpe?g|gif|webp|svg|avif|bmp|ico)(\?.*)?$/i
const ISO_DATEISH = /^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}|$)/
const HTML_TAG = /<\/?[a-z][\s\S]*>/i

function looksLikeTiptapDoc(value: unknown): boolean {
    if (value && typeof value === "object") {
        return (value as Record<string, unknown>).type === "doc"
    }
    if (typeof value === "string") {
        const s = value.trim()
        if (!s.startsWith("{")) return false
        try {
            const parsed = JSON.parse(s) as Record<string, unknown>
            return parsed?.type === "doc"
        } catch {
            return false
        }
    }
    return false
}

function looksLikeImage(s: string): boolean {
    return IMAGE_EXT.test(s) || /\/(uploads|images|assets|media)\//i.test(s)
}

function inferType(values: unknown[]): SupportedFieldType {
    const sample = values.find(v => v !== null && v !== undefined && v !== "")
    if (sample === undefined) return "string"

    if (typeof sample === "boolean") return "boolean"
    if (typeof sample === "number") return "number"

    if (looksLikeTiptapDoc(sample)) return "formattedText"
    if (typeof sample === "object") return "string" // fallback: JSON-stringified

    if (typeof sample === "string") {
        const s = sample.trim()
        if (looksLikeImage(s)) return "image"
        if (ISO_DATEISH.test(s)) return "date"
        if (HTML_TAG.test(s)) return "formattedText"
        return "string"
    }
    return "string"
}

/** Reserved columns most sources expose; kept but not a great slug/content guess. */
const LOW_PRIORITY_KEYS = new Set(["id", "created_at", "updated_at", "createdAt", "updatedAt"])

function inferFields(rawItems: Record<string, unknown>[]): ManagedCollectionFieldInput[] {
    // Union of keys across a sample, preserving first-seen order.
    const keys: string[] = []
    const seen = new Set<string>()
    for (const item of rawItems.slice(0, 100)) {
        if (!item || typeof item !== "object") continue
        for (const key of Object.keys(item)) {
            if (!seen.has(key)) {
                seen.add(key)
                keys.push(key)
            }
        }
    }

    return keys.map(key => {
        const values = rawItems.map(item => item?.[key])
        const type = inferType(values)
        return { id: key, name: humanize(key), type } as ManagedCollectionFieldInput
    })
}

/** Fields eligible to act as the Framer slug (must resolve to a non-empty string). */
export function possibleSlugFields(fields: readonly ManagedCollectionFieldInput[]): ManagedCollectionFieldInput[] {
    const strings = fields.filter(f => f.type === "string" || f.type === "link")
    // Prefer a field literally named slug/handle first.
    strings.sort((a, b) => slugRank(a.id) - slugRank(b.id))
    return strings
}

function slugRank(id: string): number {
    const lower = id.toLowerCase()
    if (lower === "slug") return 0
    if (lower === "handle" || lower === "permalink") return 1
    if (LOW_PRIORITY_KEYS.has(id)) return 3
    return 2
}

// ── Value transforms (keyed on target Framer type) ─────────────────────

const RICHTEXT_EXTENSIONS = [StarterKit, Image, Link]

function tiptapToHtml(value: unknown): string {
    let doc: unknown = value
    if (typeof value === "string") {
        const s = value.trim()
        if (!s) return ""
        if (!s.startsWith("{")) return s // already HTML or plain text
        try {
            doc = JSON.parse(s)
        } catch {
            return s
        }
    }
    if (doc && typeof doc === "object" && (doc as Record<string, unknown>).type === "doc") {
        try {
            return generateHTML(doc as Parameters<typeof generateHTML>[0], RICHTEXT_EXTENSIONS)
        } catch {
            return ""
        }
    }
    return typeof value === "string" ? value : ""
}

function absolutize(value: string, origin: string): string {
    const s = value.trim()
    if (!s) return s
    if (/^(https?:|data:|blob:)/i.test(s)) return s
    if (s.startsWith("/")) return origin + s
    return s
}

function toIsoDate(value: unknown): string | null {
    if (value == null || value === "") return null
    const s = String(value)
    const parsed = Date.parse(s)
    if (Number.isNaN(parsed)) return s // let Framer try; don't lose data
    return new Date(parsed).toISOString()
}

/** Convert a raw source value to the Framer FieldData value for `type`. Returns null to omit. */
function transformValue(type: string, raw: unknown, origin: string): unknown {
    if (raw === null || raw === undefined) return null
    switch (type) {
        case "boolean":
            if (typeof raw === "string") return raw !== "" && raw !== "false" && raw !== "0"
            return Boolean(raw)
        case "number": {
            const n = Number(raw)
            return Number.isFinite(n) ? n : null
        }
        case "date":
            return toIsoDate(raw)
        case "image":
        case "file": {
            const s = typeof raw === "string" ? raw : String(raw)
            return s.trim() ? absolutize(s, origin) : null
        }
        case "formattedText":
            return tiptapToHtml(raw)
        case "color":
        case "link":
        case "string":
        default:
            if (typeof raw === "object") return JSON.stringify(raw)
            return String(raw)
    }
}

// ── Sync ───────────────────────────────────────────────────────────────

export function mergeFieldsWithExistingFields(
    sourceFields: readonly ManagedCollectionFieldInput[],
    existingFields: readonly ManagedCollectionFieldInput[]
): ManagedCollectionFieldInput[] {
    // An existing collection field is already the authoritative mapping — it carries
    // the user's chosen name AND type from a prior sync, so prefer it as-is.
    return sourceFields.map(sourceField => existingFields.find(existing => existing.id === sourceField.id) ?? sourceField)
}

export const syncMethods = [
    "ManagedCollection.removeItems",
    "ManagedCollection.addItems",
    "ManagedCollection.setPluginData",
] as const satisfies ProtectedMethod[]

export async function syncCollection(
    collection: ManagedCollection,
    dataSource: DataSource,
    fields: readonly ManagedCollectionFieldInput[],
    slugField: ManagedCollectionFieldInput
) {
    const items: ManagedCollectionItemInput[] = []
    const unsyncedItems = new Set(await collection.getItemIds())
    const seenSlugs = new Set<string>()

    for (let i = 0; i < dataSource.rawItems.length; i++) {
        const raw = dataSource.rawItems[i]
        if (!raw) continue

        const slugRaw = raw[slugField.id]
        const slug = slugify(slugRaw)
        if (!slug) {
            console.warn(`Skipping record ${i}: slug field "${slugField.id}" is empty.`)
            continue
        }
        // Guard against duplicate slugs collapsing records.
        let uniqueSlug = slug
        let n = 2
        while (seenSlugs.has(uniqueSlug)) uniqueSlug = `${slug}-${n++}`
        seenSlugs.add(uniqueSlug)

        unsyncedItems.delete(uniqueSlug)

        const fieldData: FieldDataInput = {}
        for (const field of fields) {
            const value = transformValue(field.type, raw[field.id], dataSource.origin)
            if (value === null || value === undefined) continue
            fieldData[field.id] = { value } as FieldDataInput[string]
        }

        items.push({ id: uniqueSlug, slug: uniqueSlug, draft: false, fieldData })
    }

    await collection.removeItems(Array.from(unsyncedItems))
    await collection.addItems(items)

    await collection.setPluginData(PLUGIN_KEYS.SOURCE_CONFIG, JSON.stringify(dataSource.config))
    await collection.setPluginData(PLUGIN_KEYS.SLUG_FIELD_ID, slugField.id)
}

function slugify(value: unknown): string {
    if (value == null) return ""
    return String(value)
        .toLowerCase()
        .trim()
        .replace(/['"]/g, "")
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 96)
}

export async function syncExistingCollection(
    collection: ManagedCollection,
    previousSourceConfig: string | null,
    previousSlugFieldId: string | null
): Promise<{ didSync: boolean }> {
    if (!previousSourceConfig || !previousSlugFieldId) {
        return { didSync: false }
    }
    if (framer.mode !== "syncManagedCollection") {
        return { didSync: false }
    }
    if (!framer.isAllowedTo(...syncMethods)) {
        return { didSync: false }
    }

    let config: SourceConfig
    try {
        config = JSON.parse(previousSourceConfig) as SourceConfig
    } catch {
        framer.notify("Saved source configuration is corrupt. Reconfigure the plugin.", { variant: "error" })
        return { didSync: false }
    }

    try {
        const dataSource = await fetchDataSource(config)
        // Existing collection fields are authoritative for shaping (id + user-chosen type).
        const existingFields = await collection.getFields()

        const slugField =
            existingFields.find(field => field.id === previousSlugFieldId) ??
            dataSource.fields.find(field => field.id === previousSlugFieldId)
        if (!slugField) {
            framer.notify(`Slug field "${previousSlugFieldId}" no longer exists. Sync skipped.`, { variant: "error" })
            return { didSync: false }
        }

        await syncCollection(collection, dataSource, existingFields, slugField)
        return { didSync: true }
    } catch (error) {
        console.error(error)
        framer.notify(`Sync failed: ${error instanceof Error ? error.message : "unknown error"}`, { variant: "error" })
        return { didSync: false }
    }
}
