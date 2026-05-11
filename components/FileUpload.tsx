'use client'

import { useState, useRef, useCallback } from 'react'
import { Upload, Loader2 } from 'lucide-react'

interface FileUploadProps {
    onFileSelect: (file: File, ocrText: string) => void
    isUploading: boolean
    language?: string
}

export default function FileUpload({ onFileSelect, isUploading, language = 'English' }: FileUploadProps) {
    const [dragActive, setDragActive] = useState(false)
    const [preview, setPreview] = useState<string | null>(null)
    const [fileName, setFileName] = useState<string | null>(null)
    const inputRef = useRef<HTMLInputElement>(null)

    const handleDrag = useCallback((e: React.DragEvent) => {
        e.preventDefault()
        e.stopPropagation()
        if (e.type === 'dragenter' || e.type === 'dragover') {
            setDragActive(true)
        } else if (e.type === 'dragleave') {
            setDragActive(false)
        }
    }, [])

    const compressImage = useCallback(async (file: File): Promise<File> => {
        // Only compress if file > 500KB
        if (file.size <= 500 * 1024) return file
        // Skip AVIF/HEIC - Canvas can't handle them
        if (file.type === 'image/avif' || file.type === 'image/heic' || file.type === 'image/heif') return file

        try {
            const bitmap = await createImageBitmap(file)
            const maxWidth = 1600
            let width = bitmap.width
            let height = bitmap.height
            if (width > maxWidth) {
                height = Math.round((height * maxWidth) / width)
                width = maxWidth
            }
            const canvas = document.createElement('canvas')
            canvas.width = width
            canvas.height = height
            const ctx = canvas.getContext('2d')
            if (!ctx) return file
            ctx.drawImage(bitmap, 0, 0, width, height)
            const blob = await new Promise<Blob | null>((resolve) =>
                canvas.toBlob(resolve, 'image/jpeg', 0.8)
            )
            if (!blob || blob.size >= file.size) return file
            return new File([blob], file.name.replace(/\.\w+$/, '.jpg'), { type: 'image/jpeg' })
        } catch {
            // If compression fails for any reason, silently use original
            return file
        }
    }, [])

    const processFile = useCallback(async (file: File) => {
        setFileName(file.name)
        const reader = new FileReader()
        reader.onload = (e) => {
            setPreview(e.target?.result as string)
        }
        reader.readAsDataURL(file)
        const compressed = await compressImage(file)

        // Run client-side Tesseract OCR in parallel (non-blocking, 15s timeout)
        let ocrText = ''
        try {
            const ocrPromise = (async () => {
                const { createWorker } = await import('tesseract.js')
                const worker = await createWorker('eng')
                const { data } = await worker.recognize(compressed)
                await worker.terminate()
                return data.text || ''
            })()

            const timeoutPromise = new Promise<string>((_, reject) =>
                setTimeout(() => reject(new Error('Tesseract timeout')), 15000)
            )

            ocrText = await Promise.race([ocrPromise, timeoutPromise])
            if (ocrText) {
                console.log(`[Tesseract] Client OCR: ${ocrText.length} chars extracted`)
            }
        } catch (err) {
            console.warn('[Tesseract] Client OCR failed (non-blocking):', (err as Error).message)
            ocrText = ''
        }

        onFileSelect(compressed, ocrText)
    }, [onFileSelect, compressImage])

    const handleDrop = useCallback((e: React.DragEvent) => {
        e.preventDefault()
        e.stopPropagation()
        setDragActive(false)
        if (e.dataTransfer.files && e.dataTransfer.files[0]) {
            processFile(e.dataTransfer.files[0])
        }
    }, [processFile])

    const handleChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
        e.preventDefault()
        if (e.target.files && e.target.files[0]) {
            processFile(e.target.files[0])
        }
    }, [processFile])

    const onButtonClick = () => {
        inputRef.current?.click()
    }

    return (
        <div className="w-full max-w-xl mx-auto">
            <div
                className={`
                    w-full rounded-xl border transition-colors duration-200 overflow-hidden
                    ${dragActive
                        ? 'border-green-600 bg-green-950/30'
                        : 'border-zinc-800 bg-zinc-900'
                    }
                `}
                onDragEnter={handleDrag}
                onDragLeave={handleDrag}
                onDragOver={handleDrag}
                onDrop={handleDrop}
            >
                <input
                    ref={inputRef}
                    type="file"
                    className="hidden"
                    accept="image/png, image/jpeg, image/jpg, image/webp, image/avif, image/heic, image/heif, .avif, .heic"
                    onChange={handleChange}
                />

                <div className={`p-5 sm:p-6 flex flex-col items-center justify-center text-center ${isUploading ? 'pointer-events-none' : ''}`}>
                    {isUploading ? (
                        <Loader2 className="w-8 h-8 text-green-500 animate-spin mb-4" />
                    ) : preview ? (
                        <img
                            src={preview}
                            alt="Preview"
                            className="w-16 h-16 object-cover rounded-lg border border-zinc-700 mb-4"
                        />
                    ) : (
                        <Upload className="w-8 h-8 text-zinc-500 mb-4" />
                    )}

                    <p className="text-sm text-zinc-400 mb-1">
                        {isUploading
                            ? ('Analyzing ingredients...')
                            : preview
                                ? fileName
                                : ('Drop image here or click to upload')
                        }
                    </p>

                    {!isUploading && (
                        <button
                            onClick={onButtonClick}
                            className="mt-3 px-4 py-2 bg-green-600 hover:bg-green-700 text-white text-sm font-medium rounded-lg transition-colors duration-150 min-h-[44px]"
                        >
                            {preview
                                ? ('Change Photo')
                                : ('Select Photo')
                            }
                        </button>
                    )}
                </div>
            </div>
        </div>
    )
}
