'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import FileUpload from '@/components/FileUpload'
import AnalysisResult from '@/components/AnalysisResult'
import LiveStats from '@/components/LiveStats'
import TrendingWidget from '@/components/TrendingWidget'
import ComparisonView from '@/components/ComparisonView'
import {
    Languages, HelpCircle, X, Shield, Heart, Type,
    ArrowLeft, AlertCircle, Mic, MicOff, Camera, Loader2,
    ChevronRight, GitCompareArrows
} from 'lucide-react'

/* ========================================
   Processing State Component
   ======================================== */

function ProcessingState({ language: _language }: { language: string }) {
    const [step, setStep] = useState(0)

    const steps = [
        'Reading product label...',
        'Identifying ingredients...',
        'Checking FDA database...',
        'Checking EU CosIng...',
        'Checking WHO/IARC...',
        'Checking FSSAI / BIS...',
        'Generating safety report...',
    ]

    useEffect(() => {
        const interval = setInterval(() => {
            setStep(prev => (prev + 1) % steps.length)
        }, 2200)
        return () => clearInterval(interval)
    }, [steps.length])

    return (
        <div className="w-full max-w-md mx-auto mt-16 animate-fade-in">
            <div className="flex flex-col items-center gap-5">
                <Loader2 size={28} className="text-green-500 animate-spin" />
                <p className="text-sm text-zinc-300 font-medium">
                    {steps[step]}
                </p>
                <div className="flex gap-1">
                    {steps.map((_, i) => (
                        <div
                            key={i}
                            className={`h-1 rounded-full transition-all duration-500 ${
                                i <= step ? 'bg-green-500 w-4' : 'bg-zinc-800 w-2'
                            }`}
                        />
                    ))}
                </div>
                <p className="text-xs text-zinc-600">
                    {'Cross-referencing 6 official databases'}
                </p>
            </div>
        </div>
    )
}

/* ========================================
   Voice Recorder Component
   ======================================== */

function VoiceRecorder({ onRecordComplete, isAnalyzing, language: _language }: {
    onRecordComplete: (audioBlob: Blob) => void
    isAnalyzing: boolean
    language: string
}) {
    const [isRecording, setIsRecording] = useState(false)
    const [recordingTime, setRecordingTime] = useState(0)
    const mediaRecorderRef = useRef<MediaRecorder | null>(null)
    const chunksRef = useRef<Blob[]>([])
    const timerRef = useRef<NodeJS.Timeout | null>(null)

    const startRecording = useCallback(async () => {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
            const mediaRecorder = new MediaRecorder(stream, { mimeType: 'audio/webm' })
            mediaRecorderRef.current = mediaRecorder
            chunksRef.current = []

            mediaRecorder.ondataavailable = (e) => {
                if (e.data.size > 0) chunksRef.current.push(e.data)
            }

            mediaRecorder.onstop = () => {
                const blob = new Blob(chunksRef.current, { type: 'audio/webm' })
                onRecordComplete(blob)
                stream.getTracks().forEach(track => track.stop())
            }

            mediaRecorder.start()
            setIsRecording(true)
            setRecordingTime(0)

            timerRef.current = setInterval(() => {
                setRecordingTime(prev => {
                    // Auto-stop at 5 minutes to prevent unbounded recording
                    if (prev + 1 >= 300) {
                        mediaRecorderRef.current?.stop()
                        setIsRecording(false)
                        if (timerRef.current) clearInterval(timerRef.current)
                    }
                    return prev + 1
                })
            }, 1000)
        } catch (err) {
            console.error('Microphone access denied:', err)
            alert('Please allow microphone access')
        }
    }, [onRecordComplete])

    const stopRecording = useCallback(() => {
        if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
            mediaRecorderRef.current.stop()
            setIsRecording(false)
            if (timerRef.current) clearInterval(timerRef.current)
        }
    }, [])

    const formatTime = (seconds: number) => {
        const m = Math.floor(seconds / 60)
        const s = seconds % 60
        return `${m}:${s.toString().padStart(2, '0')}`
    }

    return (
        <div className="py-10 px-6 flex flex-col items-center gap-5">
            <button
                onClick={isRecording ? stopRecording : startRecording}
                disabled={isAnalyzing}
                className={`w-16 h-16 rounded-full flex items-center justify-center transition-all active:scale-95 disabled:opacity-50 ${
                    isRecording
                        ? 'bg-red-500 hover:bg-red-600'
                        : 'bg-green-600 hover:bg-green-700'
                }`}
            >
                {isRecording ? <MicOff size={24} className="text-white" /> : <Mic size={24} className="text-white" />}
            </button>

            <div className="text-center">
                <p className="text-sm font-medium text-zinc-200">
                    {isRecording
                        ? ('Recording...')
                        : ('Ask by Voice')
                    }
                </p>
                {isRecording ? (
                    <p className="text-red-400 font-mono text-sm mt-1">{formatTime(recordingTime)}</p>
                ) : (
                    <p className="text-xs text-zinc-500 mt-1 max-w-xs">
                        {'Tap the mic and speak the ingredients or ask about a product'
                        }
                    </p>
                )}
            </div>

            {isRecording && (
                <button
                    onClick={stopRecording}
                    className="px-5 py-2.5 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-sm font-medium hover:bg-red-500/20 transition active:scale-95"
                >
                    {'Stop & Analyze'}
                </button>
            )}
        </div>
    )
}

/* ========================================
   Tutorial Modal
   ======================================== */

function TutorialModal({ language: _language, onClose }: { language: string; onClose: () => void }) {
    const [step, setStep] = useState(0)

    const steps = [
        {
            title: 'Welcome!',
            description: 'Alzhal tells you exactly what is in your food, cosmetics, and household products - and whether it is safe, grounded in real regulators (FDA, EU, WHO, FSSAI, IARC).',
            icon: Shield,
        },
        {
            title: 'Three Ways to Check',
            description: 'Upload a photo of the label, paste ingredient text, or use voice input. All three methods work instantly.',
            icon: Camera,
        },
        {
            title: 'Understand Your Report',
            description: 'Green means safe, yellow means caution, red means avoid. Every ingredient gets a detailed breakdown with official sources.',
            icon: Heart,
        }
    ]

    return (
        <div className="fixed inset-0 z-[100] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 animate-fade-in">
            <div className="relative bg-zinc-900 border border-zinc-800 rounded-xl p-8 max-w-md w-full animate-fade-in">
                <button
                    onClick={onClose}
                    className="absolute top-4 right-4 p-1.5 rounded-md text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800 transition"
                >
                    <X size={16} />
                </button>

                <div className="space-y-5">
                    <div className="w-10 h-10 rounded-lg bg-zinc-800 flex items-center justify-center">
                        {(() => {
                            const Icon = steps[step].icon
                            return <Icon className="w-5 h-5 text-green-500" />
                        })()}
                    </div>

                    <h2 className="text-xl font-semibold text-white">{steps[step].title}</h2>

                    <p className="text-sm text-zinc-400 leading-relaxed">{steps[step].description}</p>

                    <div className="flex gap-1.5 pt-1">
                        {steps.map((_, idx) => (
                            <div
                                key={idx}
                                className={`h-1 rounded-full transition-all duration-300 ${
                                    idx === step ? 'bg-green-500 w-5' : idx < step ? 'bg-zinc-600 w-3' : 'bg-zinc-800 w-3'
                                }`}
                            />
                        ))}
                    </div>

                    <div className="flex gap-3 pt-1">
                        {step < steps.length - 1 ? (
                            <>
                                <button
                                    onClick={onClose}
                                    className="flex-1 px-4 py-2.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 transition text-sm text-zinc-400 hover:text-zinc-200"
                                >
                                    {'Skip'}
                                </button>
                                <button
                                    onClick={() => setStep(step + 1)}
                                    className="flex-1 px-4 py-2.5 rounded-lg bg-white text-zinc-900 font-medium text-sm hover:bg-zinc-100 transition flex items-center justify-center gap-1 active:scale-[0.98]"
                                >
                                    {'Next'}
                                    <ChevronRight size={14} />
                                </button>
                            </>
                        ) : (
                            <button
                                onClick={onClose}
                                className="w-full px-4 py-2.5 rounded-lg bg-white text-zinc-900 font-medium text-sm hover:bg-zinc-100 transition active:scale-[0.98]"
                            >
                                {'Get Started'}
                            </button>
                        )}
                    </div>
                </div>
            </div>
        </div>
    )
}

/* ========================================
   Main Page
   ======================================== */

export default function Home() {
    const [isAnalyzing, setIsAnalyzing] = useState(false)
    const [analysisData, setAnalysisData] = useState<any>(null)
    const [voiceResponse, setVoiceResponse] = useState<any>(null)
    const [error, setError] = useState<string | null>(null)
    const [language, setLanguage] = useState('English')
    const [showTutorial, setShowTutorial] = useState(false)
    const [inputMode, setInputMode] = useState<'image' | 'text' | 'voice' | 'compare'>('image')
    const [textInput, setTextInput] = useState('')
    const [compareA, setCompareA] = useState('')
    const [compareB, setCompareB] = useState('')
    const [comparisonData, setComparisonData] = useState<any>(null)


    useEffect(() => {
        const hasVisited = localStorage.getItem('ct_visited')
        if (!hasVisited) {
            setShowTutorial(true)
            localStorage.setItem('ct_visited', 'true')
        }
    }, [])

    const handleFileSelect = async (file: File, ocrText: string = '') => {
        setIsAnalyzing(true)
        setError(null)
        setAnalysisData(null)

        const formData = new FormData()
        formData.append('image', file)
        formData.append('language', language)
        if (ocrText) {
            formData.append('ocrText', ocrText)
        }

        try {
            const response = await fetch('/api/analyze/image', {
                method: 'POST',
                body: formData,
            })

            const data = await response.json()

            if (!response.ok) {
                throw new Error(data.error || 'Analysis failed')
            }

            setAnalysisData(data)
        } catch (err: any) {
            console.error(err)
            setError(err.message || 'Failed to analyze product. Please try again.')
        } finally {
            setIsAnalyzing(false)
        }
    }

    const handleTextAnalysis = async () => {
        if (!textInput.trim() || textInput.trim().length < 3) {
            setError('Please enter at least one ingredient name.')
            return
        }

        setIsAnalyzing(true)
        setError(null)
        setAnalysisData(null)

        try {
            const response = await fetch('/api/analyze/text', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    text: textInput,
                    language,
                }),
            })

            const data = await response.json()

            if (!response.ok) {
                throw new Error(data.error || 'Analysis failed')
            }

            setAnalysisData(data)
        } catch (err: any) {
            console.error(err)
            setError(err.message || 'Failed to analyze ingredients. Please try again.')
        } finally {
            setIsAnalyzing(false)
        }
    }

    const handleVoiceComplete = async (audioBlob: Blob) => {
        setIsAnalyzing(true)
        setError(null)
        setAnalysisData(null)
        setVoiceResponse(null)

        const formData = new FormData()
        formData.append('audio', audioBlob, 'voice.webm')
        formData.append('language', language)

        try {
            const response = await fetch('/api/analyze/voice', {
                method: 'POST',
                body: formData,
            })

            const data = await response.json()

            if (!response.ok) {
                throw new Error(data.error || 'Voice analysis failed')
            }

            // Voice API returns { transcription, language, intent, response } - not ingredients
            setVoiceResponse(data)
        } catch (err: any) {
            console.error(err)
            setError(err.message || 'Failed to analyze voice input. Please try again.')
        } finally {
            setIsAnalyzing(false)
        }
    }

    const handleComparison = async () => {
        if (!compareA.trim() || !compareB.trim()) {
            setError('Please enter both product names.')
            return
        }

        setIsAnalyzing(true)
        setError(null)
        setComparisonData(null)

        try {
            const response = await fetch('/api/compare', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    product_a: compareA,
                    product_b: compareB,
                    language,
                }),
            })

            const data = await response.json()

            if (!response.ok) {
                throw new Error(data.error || 'Comparison failed')
            }

            setComparisonData(data)
        } catch (err: any) {
            console.error(err)
            setError(err.message || 'Failed to compare products. Please try again.')
        } finally {
            setIsAnalyzing(false)
        }
    }

    const resetAnalysis = () => {
        setAnalysisData(null)
        setVoiceResponse(null)
        setComparisonData(null)
        setError(null)
        setTextInput('')
        setCompareA('')
        setCompareB('')
    }

    const labels = {
        heroTitle: 'Know What You',
        heroHighlight: 'Consume.',
        heroSubtitle: 'Instant AI safety analysis against FDA, EU, WHO & BIS/FSSAI standards.',
        uploadTab: 'Photo',
        textTab: 'Text',
        voiceTab: 'Voice',
        compareTab: 'Compare',
        textPlaceholder: 'Type a product name or paste ingredients...\nExample: Maaza, Coca-Cola, or Sodium Laureth Sulfate, Parabens',
        analyzeBtn: 'Analyze',
        scanAnother: 'Scan Another Product',
        disclaimer: 'Educational information only, not medical advice. Consult professionals for health concerns.',
    }

    return (
        <main className="min-h-screen bg-[#09090b] text-white">

            {/* Tutorial Modal */}
            {showTutorial && (
                <TutorialModal language={language} onClose={() => setShowTutorial(false)} />
            )}

            {/* ====== NAVBAR ====== */}
            <nav className="sticky top-0 z-50 w-full bg-[#09090b]/80 backdrop-blur-md border-b border-zinc-800/50">
                <div className="max-w-3xl mx-auto px-4 py-3 flex justify-between items-center">
                    <span className="font-display text-base tracking-tight text-[var(--text-primary)]" style={{ fontWeight: 500 }}>
                        Alzhal
                    </span>

                    <div className="flex items-center gap-2">
                        <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md bg-zinc-900 border border-zinc-800 hover:border-zinc-700 transition">
                            <Languages size={13} className="text-zinc-500" />
                            <select
                                value={language}
                                onChange={(e) => setLanguage(e.target.value)}
                                className="bg-transparent outline-none text-zinc-300 text-xs cursor-pointer"
                            >
                                <option value="Tamil">தமிழ்</option>
                                <option value="English">English</option>
                                <option value="Telugu">తెలుగు</option>
                                <option value="Kannada">ಕನ್ನಡ</option>
                                <option value="Malayalam">മലയാളം</option>
                                <option value="Hindi">हिंदी</option>
                                <option value="Bengali">বাংলা</option>
                                <option value="Marathi">मराठी</option>
                                <option value="Gujarati">ગુજરાતી</option>
                                <option value="Punjabi">ਪੰਜਾਬੀ</option>
                                <option value="Odia">ଓଡ଼ିଆ</option>
                                <option value="Assamese">অসমীয়া</option>
                                <option value="Urdu">اردو</option>
                            </select>
                        </div>

                        <button
                            onClick={() => { setShowTutorial(true) }}
                            className="p-1.5 rounded-md text-zinc-600 hover:text-zinc-300 hover:bg-zinc-800 transition"
                            title={'Help'}
                        >
                            <HelpCircle size={15} />
                        </button>
                    </div>
                </div>
            </nav>

            {/* ====== MAIN CONTENT ====== */}
            <div className="max-w-xl mx-auto px-4 sm:px-6 pt-12 sm:pt-16 md:pt-24 pb-20">

                {/* ====== HERO + INPUT ====== */}
                {!analysisData && !voiceResponse && !comparisonData && !isAnalyzing && (
                    <div className="animate-fade-in">

                        {/* Hero */}
                        <div className="text-center mb-10">
                            <h1 className="text-4xl sm:text-5xl font-bold tracking-tight mb-3">
                                {labels.heroTitle}{' '}
                                <span className="text-green-500">{labels.heroHighlight}</span>
                            </h1>
                            <p className="text-sm text-zinc-500 max-w-md mx-auto">
                                {labels.heroSubtitle}
                            </p>
                        </div>

                        {/* Tab Switcher */}
                        <div className="flex gap-1 p-1 bg-zinc-900 border border-zinc-800 rounded-lg mb-6">
                            {[
                                { key: 'image' as const, label: labels.uploadTab, icon: Camera },
                                { key: 'text' as const, label: labels.textTab, icon: Type },
                                { key: 'voice' as const, label: labels.voiceTab, icon: Mic },
                                { key: 'compare' as const, label: labels.compareTab, icon: GitCompareArrows },
                            ].map(tab => (
                                <button
                                    key={tab.key}
                                    onClick={() => setInputMode(tab.key)}
                                    className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-md text-sm font-medium transition-all ${
                                        inputMode === tab.key
                                            ? 'bg-zinc-800 text-white'
                                            : 'text-zinc-500 hover:text-zinc-300'
                                    }`}
                                >
                                    <tab.icon size={14} />
                                    {tab.label}
                                </button>
                            ))}
                        </div>

                        {/* Input Area */}
                        <div className="bg-zinc-900 border border-zinc-800 rounded-lg overflow-hidden">
                            {inputMode === 'image' && (
                                <FileUpload onFileSelect={handleFileSelect} isUploading={isAnalyzing} language={language} />
                            )}

                            {inputMode === 'text' && (
                                <div className="p-4 space-y-3">
                                    <textarea
                                        value={textInput}
                                        onChange={(e) => setTextInput(e.target.value)}
                                        placeholder={labels.textPlaceholder}
                                        className="w-full h-36 p-3 rounded-md bg-zinc-950 border border-zinc-800 focus:border-zinc-600 focus:outline-none text-sm text-white placeholder-zinc-600 resize-none transition"
                                        disabled={isAnalyzing}
                                        maxLength={5000}
                                    />
                                    <div className="flex items-center justify-between text-xs text-zinc-600 px-0.5">
                                        <span>{textInput.length}/5000</span>
                                        <span>{'Separate with commas'}</span>
                                    </div>
                                    <button
                                        onClick={handleTextAnalysis}
                                        disabled={isAnalyzing || !textInput.trim()}
                                        className="w-full py-2.5 rounded-md bg-green-600 hover:bg-green-700 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-medium transition active:scale-[0.98]"
                                    >
                                        {labels.analyzeBtn}
                                    </button>
                                </div>
                            )}

                            {inputMode === 'voice' && (
                                <VoiceRecorder
                                    onRecordComplete={handleVoiceComplete}
                                    isAnalyzing={isAnalyzing}
                                    language={language}
                                />
                            )}

                            {inputMode === 'compare' && (
                                <div className="p-4 space-y-3">
                                    <input
                                        type="text"
                                        value={compareA}
                                        onChange={(e) => setCompareA(e.target.value)}
                                        placeholder={'First product (e.g., Maggi Noodles)'}
                                        className="w-full p-3 rounded-md bg-zinc-950 border border-zinc-800 focus:border-zinc-600 focus:outline-none text-sm text-white placeholder-zinc-600 transition"
                                        disabled={isAnalyzing}
                                        maxLength={200}
                                    />
                                    <div className="text-center text-xs text-zinc-600 font-medium">
                                        {'VS'}
                                    </div>
                                    <input
                                        type="text"
                                        value={compareB}
                                        onChange={(e) => setCompareB(e.target.value)}
                                        placeholder={'Second product (e.g., Yippee Noodles)'}
                                        className="w-full p-3 rounded-md bg-zinc-950 border border-zinc-800 focus:border-zinc-600 focus:outline-none text-sm text-white placeholder-zinc-600 transition"
                                        disabled={isAnalyzing}
                                        maxLength={200}
                                    />
                                    <button
                                        onClick={handleComparison}
                                        disabled={isAnalyzing || !compareA.trim() || !compareB.trim()}
                                        className="w-full py-2.5 rounded-md bg-green-600 hover:bg-green-700 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-medium transition active:scale-[0.98]"
                                    >
                                        {'Compare Products'}
                                    </button>
                                </div>
                            )}
                        </div>

                        {/* Error */}
                        {error && (
                            <div className="mt-4 flex items-start gap-2 text-sm text-red-400 animate-fade-in">
                                <AlertCircle size={16} className="flex-shrink-0 mt-0.5" />
                                <span>{error}</span>
                            </div>
                        )}

                        {/* Stats */}
                        <div className="mt-8">
                            <LiveStats language={language} />
                        </div>

                        {/* Trending */}
                        <div className="mt-6">
                            <TrendingWidget language={language} />
                        </div>
                    </div>
                )}

                {/* ====== PROCESSING STATE ====== */}
                {isAnalyzing && !analysisData && !voiceResponse && !comparisonData && (
                    <ProcessingState language={language} />
                )}

                {/* ====== VOICE RESPONSE ====== */}
                {voiceResponse && (
                    <div className="animate-fade-in">
                        <button
                            onClick={resetAnalysis}
                            className="mb-6 flex items-center gap-1.5 text-sm text-zinc-500 hover:text-zinc-300 transition group"
                        >
                            <ArrowLeft size={14} className="group-hover:-translate-x-0.5 transition-transform" />
                            {labels.scanAnother}
                        </button>

                        <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-5 space-y-4">
                            {voiceResponse.transcription && (
                                <div>
                                    <p className="text-xs text-zinc-500 mb-1">{'You said'}</p>
                                    <p className="text-sm text-zinc-300 italic">&ldquo;{voiceResponse.transcription}&rdquo;</p>
                                </div>
                            )}
                            <div>
                                <p className="text-xs text-zinc-500 mb-1">{'Response'}</p>
                                <p className="text-sm text-zinc-200 leading-relaxed whitespace-pre-wrap">{voiceResponse.response}</p>
                            </div>
                            {voiceResponse.language && voiceResponse.language !== 'English' && (
                                <p className="text-xs text-zinc-600">{'Language'}: {voiceResponse.language}</p>
                            )}
                        </div>
                    </div>
                )}

                {/* ====== COMPARISON RESULT ====== */}
                {comparisonData && (
                    <div className="animate-fade-in">
                        <button
                            onClick={resetAnalysis}
                            className="mb-6 flex items-center gap-1.5 text-sm text-zinc-500 hover:text-zinc-300 transition group"
                        >
                            <ArrowLeft size={14} className="group-hover:-translate-x-0.5 transition-transform" />
                            {labels.scanAnother}
                        </button>

                        <ComparisonView data={comparisonData} language={language} />
                    </div>
                )}

                {/* ====== ANALYSIS RESULT ====== */}
                {analysisData && (
                    <div className="animate-fade-in">
                        <button
                            onClick={resetAnalysis}
                            className="mb-6 flex items-center gap-1.5 text-sm text-zinc-500 hover:text-zinc-300 transition group"
                        >
                            <ArrowLeft size={14} className="group-hover:-translate-x-0.5 transition-transform" />
                            {labels.scanAnother}
                        </button>

                        <AnalysisResult data={analysisData} language={language} />
                    </div>
                )}
            </div>

            {/* ====== FOOTER ====== */}
            <footer className="border-t border-zinc-800/50 py-5 px-4">
                <p className="text-center text-xs text-zinc-600 max-w-lg mx-auto">
                    {labels.disclaimer}
                </p>
            </footer>
        </main>
    )
}
