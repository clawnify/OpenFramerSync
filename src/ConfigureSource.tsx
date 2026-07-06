import { framer } from "@framer/plugin"
import { useState } from "react"
import { type DataSource, type SourceConfig, emptySourceConfig, fetchDataSource } from "./data"

interface ConfigureSourceProps {
    onDataSource: (dataSource: DataSource) => void
}

export function ConfigureSource({ onDataSource }: ConfigureSourceProps) {
    const [config, setConfig] = useState<SourceConfig>(emptySourceConfig)
    const [showAdvanced, setShowAdvanced] = useState(false)
    const [isLoading, setIsLoading] = useState(false)

    const update = (patch: Partial<SourceConfig>) => setConfig(prev => ({ ...prev, ...patch }))

    const setHeader = (index: number, patch: Partial<{ key: string; value: string }>) =>
        update({ headers: config.headers.map((h, i) => (i === index ? { ...h, ...patch } : h)) })

    const addHeader = () => update({ headers: [...config.headers, { key: "", value: "" }] })
    const removeHeader = (index: number) => update({ headers: config.headers.filter((_, i) => i !== index) })

    const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
        event.preventDefault()
        try {
            setIsLoading(true)
            const dataSource = await fetchDataSource(config)
            if (dataSource.rawItems.length === 0) {
                framer.notify("The source returned no records.", { variant: "warning" })
            }
            onDataSource(dataSource)
        } catch (error) {
            console.error(error)
            framer.notify(error instanceof Error ? error.message : "Failed to load the source.", { variant: "error" })
        } finally {
            setIsLoading(false)
        }
    }

    return (
        <main className="framer-hide-scrollbar setup">
            <div className="intro">
                <div className="content">
                    <h2>Connect a Source</h2>
                    <p>Sync any REST/JSON API — including Open CMS — into this collection.</p>
                </div>
            </div>

            <form onSubmit={handleSubmit}>
                <label className="stacked">
                    URL
                    <input
                        type="url"
                        required
                        placeholder="https://your-cms.example.com/api/entries/posts"
                        value={config.url}
                        onChange={event => update({ url: event.target.value })}
                    />
                </label>

                <button
                    type="button"
                    className="link-button"
                    onClick={() => setShowAdvanced(value => !value)}
                >
                    {showAdvanced ? "Hide options" : "Method, headers & auth"}
                </button>

                {showAdvanced && (
                    <div className="advanced">
                        <label className="stacked">
                            Method
                            <select
                                value={config.method}
                                onChange={event => update({ method: event.target.value as SourceConfig["method"] })}
                            >
                                <option value="GET">GET</option>
                                <option value="POST">POST</option>
                            </select>
                        </label>

                        <div className="headers">
                            <span className="advanced-label">Headers</span>
                            {config.headers.map((header, index) => (
                                <div className="header-row" key={index}>
                                    <input
                                        type="text"
                                        placeholder="Authorization"
                                        value={header.key}
                                        onChange={event => setHeader(index, { key: event.target.value })}
                                    />
                                    <input
                                        type="text"
                                        placeholder="Bearer …"
                                        value={header.value}
                                        onChange={event => setHeader(index, { value: event.target.value })}
                                    />
                                    <button type="button" className="icon-button" onClick={() => removeHeader(index)}>
                                        ×
                                    </button>
                                </div>
                            ))}
                            <button type="button" className="link-button" onClick={addHeader}>
                                + Add header
                            </button>
                        </div>

                        <label className="stacked">
                            Items path <span className="hint">(optional)</span>
                            <input
                                type="text"
                                placeholder="data.items"
                                value={config.itemsPath}
                                onChange={event => update({ itemsPath: event.target.value })}
                            />
                        </label>
                    </div>
                )}

                <button type="submit" disabled={!config.url.trim() || isLoading}>
                    {isLoading ? <div className="framer-spinner" /> : "Next"}
                </button>
            </form>
        </main>
    )
}
