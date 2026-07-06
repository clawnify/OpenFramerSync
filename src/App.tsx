import "./App.css"

import { framer, type ManagedCollection } from "@framer/plugin"
import { useEffect, useLayoutEffect, useState } from "react"
import { ConfigureSource } from "./ConfigureSource"
import { type DataSource, type SourceConfig, fetchDataSource } from "./data"
import { FieldMapping } from "./FieldMapping"

interface AppProps {
    collection: ManagedCollection
    previousSourceConfig: string | null
    previousSlugFieldId: string | null
}

export function App({ collection, previousSourceConfig, previousSlugFieldId }: AppProps) {
    const [dataSource, setDataSource] = useState<DataSource | null>(null)
    const [isLoadingDataSource, setIsLoadingDataSource] = useState(Boolean(previousSourceConfig))

    useLayoutEffect(() => {
        const hasDataSource = Boolean(dataSource)
        framer.showUI({
            width: hasDataSource ? 360 : 300,
            height: hasDataSource ? 460 : 360,
            minWidth: hasDataSource ? 360 : undefined,
            minHeight: hasDataSource ? 460 : undefined,
            resizable: hasDataSource,
        })
    }, [dataSource])

    useEffect(() => {
        if (!previousSourceConfig) return

        let config: SourceConfig
        try {
            config = JSON.parse(previousSourceConfig) as SourceConfig
        } catch {
            setIsLoadingDataSource(false)
            return
        }

        const abortController = new AbortController()
        setIsLoadingDataSource(true)
        fetchDataSource(config, abortController.signal)
            .then(setDataSource)
            .catch(error => {
                if (abortController.signal.aborted) return
                console.error(error)
                framer.notify(
                    `Could not reload the saved source (${error instanceof Error ? error.message : "error"}). Reconfigure it below.`,
                    { variant: "error" }
                )
            })
            .finally(() => {
                if (abortController.signal.aborted) return
                setIsLoadingDataSource(false)
            })

        return () => abortController.abort()
    }, [previousSourceConfig])

    if (isLoadingDataSource) {
        return (
            <main className="loading">
                <div className="framer-spinner" />
            </main>
        )
    }

    if (!dataSource) {
        return <ConfigureSource onDataSource={setDataSource} />
    }

    return <FieldMapping collection={collection} dataSource={dataSource} initialSlugFieldId={previousSlugFieldId} />
}
