import { framer, type ManagedCollection, type ManagedCollectionFieldInput, useIsAllowedTo } from "@framer/plugin"
import { useCallback, useEffect, useMemo, useState } from "react"
import {
    type DataSource,
    FIELD_TYPE_LABELS,
    mergeFieldsWithExistingFields,
    possibleSlugFields,
    SUPPORTED_FIELD_TYPES,
    type SupportedFieldType,
    syncCollection,
    syncMethods,
} from "./data"

interface FieldMappingRowProps {
    field: ManagedCollectionFieldInput
    originalFieldName: string | undefined
    isIgnored: boolean
    onToggleDisabled: (fieldId: string) => void
    onNameChange: (fieldId: string, name: string) => void
    onTypeChange: (fieldId: string, type: SupportedFieldType) => void
    disabled: boolean
}

function FieldMappingRow({
    field,
    originalFieldName,
    isIgnored,
    onToggleDisabled,
    onNameChange,
    onTypeChange,
    disabled,
}: FieldMappingRowProps) {
    return (
        <>
            <button
                type="button"
                className={`source-field ${isIgnored ? "ignored" : ""}`}
                onClick={() => onToggleDisabled(field.id)}
                disabled={disabled}
            >
                <input type="checkbox" checked={!isIgnored} tabIndex={-1} readOnly />
                <span>{originalFieldName ?? field.id}</span>
            </button>
            <svg xmlns="http://www.w3.org/2000/svg" width="8" height="8" fill="none">
                <title>maps to</title>
                <path
                    fill="transparent"
                    stroke="#999"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="1.5"
                    d="m2.5 7 3-3-3-3"
                />
            </svg>
            <div className="field-target">
                <input
                    type="text"
                    disabled={isIgnored || disabled}
                    placeholder={field.id}
                    value={field.name}
                    onChange={event => onNameChange(field.id, event.target.value)}
                    onKeyDown={event => {
                        if (event.key === "Enter") event.preventDefault()
                    }}
                />
                <select
                    className="type-select"
                    disabled={isIgnored || disabled}
                    value={field.type}
                    onChange={event => onTypeChange(field.id, event.target.value as SupportedFieldType)}
                >
                    {SUPPORTED_FIELD_TYPES.map(type => (
                        <option key={type} value={type}>
                            {FIELD_TYPE_LABELS[type]}
                        </option>
                    ))}
                </select>
            </div>
        </>
    )
}

const emptyFields: ManagedCollectionFieldInput[] = []
Object.freeze(emptyFields)

const initialFieldIds: ReadonlySet<string> = new Set()

interface FieldMappingProps {
    collection: ManagedCollection
    dataSource: DataSource
    initialSlugFieldId: string | null
}

export function FieldMapping({ collection, dataSource, initialSlugFieldId }: FieldMappingProps) {
    const [status, setStatus] = useState<"mapping-fields" | "loading-fields" | "syncing-collection">("loading-fields")
    const isSyncing = status === "syncing-collection"
    const isLoadingFields = status === "loading-fields"

    const [fields, setFields] = useState<ManagedCollectionFieldInput[]>(emptyFields)
    const [ignoredFieldIds, setIgnoredFieldIds] = useState(initialFieldIds)
    const [selectedSlugFieldId, setSelectedSlugFieldId] = useState<string | null>(initialSlugFieldId)

    // Slug candidates track the live field types (a field re-typed to text becomes eligible).
    const slugFields = useMemo(() => possibleSlugFields(fields), [fields])
    const selectedSlugField = slugFields.find(field => field.id === selectedSlugFieldId) ?? slugFields[0] ?? null

    useEffect(() => {
        const abortController = new AbortController()

        collection
            .getFields()
            .then(collectionFields => {
                if (abortController.signal.aborted) return
                setFields(mergeFieldsWithExistingFields(dataSource.fields, collectionFields))

                if (initialSlugFieldId) {
                    const existingFieldIds = new Set(collectionFields.map(field => field.id))
                    const ignoredIds = new Set<string>()
                    for (const sourceField of dataSource.fields) {
                        if (!existingFieldIds.has(sourceField.id)) ignoredIds.add(sourceField.id)
                    }
                    setIgnoredFieldIds(ignoredIds)
                }

                setStatus("mapping-fields")
            })
            .catch(error => {
                if (abortController.signal.aborted) return
                console.error("Failed to fetch collection fields:", error)
                framer.notify("Failed to load collection fields", { variant: "error" })
            })

        return () => abortController.abort()
    }, [initialSlugFieldId, dataSource, collection])

    const changeFieldName = useCallback((fieldId: string, name: string) => {
        setFields(prev => prev.map(field => (field.id === fieldId ? { ...field, name } : field)))
    }, [])

    const changeFieldType = useCallback((fieldId: string, type: SupportedFieldType) => {
        setFields(prev =>
            prev.map(field =>
                field.id === fieldId ? ({ id: field.id, name: field.name, type } as ManagedCollectionFieldInput) : field
            )
        )
    }, [])

    const toggleFieldDisabledState = useCallback((fieldId: string) => {
        setIgnoredFieldIds(previous => {
            const next = new Set(previous)
            if (next.has(fieldId)) next.delete(fieldId)
            else next.add(fieldId)
            return next
        })
    }, [])

    const isAllowedToManage = useIsAllowedTo("ManagedCollection.setFields", ...syncMethods)

    const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
        event.preventDefault()

        if (!selectedSlugField) {
            framer.notify("Select a slug field (a Plain Text field with unique values) before importing.", {
                variant: "warning",
            })
            return
        }
        if (ignoredFieldIds.has(selectedSlugField.id)) {
            framer.notify("The slug field cannot be excluded from the import.", { variant: "warning" })
            return
        }

        try {
            setStatus("syncing-collection")

            const fieldsToSync: ManagedCollectionFieldInput[] = []
            for (const field of fields) {
                if (ignoredFieldIds.has(field.id)) continue
                fieldsToSync.push({ ...field, name: field.name.trim() || field.id })
            }

            await collection.setFields(fieldsToSync)
            await syncCollection(collection, dataSource, fieldsToSync, selectedSlugField)
            framer.closePlugin("Synchronization successful", { variant: "success" })
        } catch (error) {
            console.error(error)
            framer.notify(`Import failed: ${error instanceof Error ? error.message : "unknown error"}`, {
                variant: "error",
            })
        } finally {
            setStatus("mapping-fields")
        }
    }

    if (isLoadingFields) {
        return (
            <main className="loading">
                <div className="framer-spinner" />
            </main>
        )
    }

    return (
        <main className="framer-hide-scrollbar mapping">
            <hr className="sticky-divider" />
            <form onSubmit={handleSubmit}>
                <label className="slug-field" htmlFor="slugField">
                    Slug Field
                    <select
                        required
                        name="slugField"
                        className="field-input"
                        value={selectedSlugField ? selectedSlugField.id : ""}
                        onChange={event => setSelectedSlugFieldId(event.target.value)}
                        disabled={!isAllowedToManage}
                    >
                        {slugFields.length === 0 && <option value="">No text field available</option>}
                        {slugFields.map(field => (
                            <option key={`slug-field-${field.id}`} value={field.id}>
                                {field.name}
                            </option>
                        ))}
                    </select>
                </label>

                <div className="fields">
                    <span className="fields-column">Column</span>
                    <span>Field</span>
                    {fields.map(field => (
                        <FieldMappingRow
                            key={`field-${field.id}`}
                            field={field}
                            originalFieldName={dataSource.fields.find(source => source.id === field.id)?.id}
                            isIgnored={ignoredFieldIds.has(field.id)}
                            onToggleDisabled={toggleFieldDisabledState}
                            onNameChange={changeFieldName}
                            onTypeChange={changeFieldType}
                            disabled={!isAllowedToManage}
                        />
                    ))}
                </div>

                <footer>
                    <hr />
                    <button
                        type="submit"
                        disabled={isSyncing || !isAllowedToManage}
                        title={isAllowedToManage ? undefined : "Insufficient permissions"}
                    >
                        {isSyncing ? <div className="framer-spinner" /> : "Import"}
                    </button>
                </footer>
            </form>
        </main>
    )
}
