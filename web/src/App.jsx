import { useState, useCallback, useEffect, useRef } from 'react'
import DropZone from './components/DropZone.jsx'
import Overview from './components/Overview.jsx'
import Garage from './components/Garage.jsx'
import Parts from './components/Parts.jsx'
import Skills from './components/Skills.jsx'
import Cars from './components/Cars.jsx'
import DownloadModal from './components/DownloadModal.jsx'
import { parseCars } from './codec.js' // We still might need it if we call it from main, but worker has it too.

const TABS = ['Overview', 'Garage', 'Parts', 'Skills', 'Cars']

export default function App() {
  const workerRef = useRef(null)

  const [decoded, setDecoded] = useState(null)
  const [stats, setStats] = useState(null)
  const [origStats, setOrigStats] = useState(null)
  const [parts, setParts] = useState([])
  const [garage, setGarage] = useState([])
  const [skills, setSkills] = useState([])
  const [cars, setCars] = useState([])
  const [activeTab, setActiveTab] = useState(0)
  const [loading, setLoading] = useState(false)
  const [progress, setProgress] = useState(0)
  const [progressLabel, setProgressLabel] = useState('')
  const [error, setError] = useState(null)
  const [downloading, setDownloading] = useState(false)
  const [dlProgress, setDlProgress] = useState(0)
  const [showDownloadModal, setShowDownloadModal] = useState(false)
  const [filename, setFilename] = useState('profile0.cms21b')

  useEffect(() => {
    workerRef.current = new Worker(
      new URL('./codec.worker.js', import.meta.url),
      { type: 'module' },
    )
    return () => workerRef.current?.terminate()
  }, [])

  const handleFile = useCallback(async (file) => {
    setLoading(true)
    setProgress(0)
    setProgressLabel('Reading file…')
    setError(null)
    setFilename(file.name)

    const buffer = await file.arrayBuffer()

    workerRef.current.onmessage = ({ data: msg }) => {
      if (msg.type === 'progress') {
        setProgress(msg.pct)
        setProgressLabel(msg.label)
      } else if (msg.type === 'done') {
        const data = msg.result
        setDecoded(data)
        setStats({ ...data.stats })
        setOrigStats({ ...data.stats })
        setParts(data.parts.map(p => ({ ...p, _orig: p.condition })))
        setGarage(data.garage.map(g => ({ ...g, _orig: g.state })))
        setSkills(data.skills.map(s => ({
          ...s,
          _origPurchased: s.purchased,
          _origTiers: [...s.tiers]
        })))
        setCars(data.cars.map(c => ({
          ...c,
          parts: c.parts.map(p => ({ ...p, _origCond: p.condition }))
        })))
        setActiveTab(0)
        setLoading(false)
        setProgress(0)
      } else if (msg.type === 'error') {
        setError(msg.message)
        setLoading(false)
        setProgress(0)
      }
    }

    // Transfer the buffer to the worker (zero-copy)
    workerRef.current.postMessage({ type: 'decode', buffer }, [buffer])
  }, [])

  const handleDownload = useCallback(() => {
    if (!decoded) return
    if (localStorage.getItem('skipDownloadModal') === 'true') {
      executeDownload()
    } else {
      setShowDownloadModal(true)
    }
  }, [decoded])

  const executeDownload = useCallback(() => {
    if (!decoded) return
    setShowDownloadModal(false)
    setDownloading(true)
    setDlProgress(0)
    setError(null)

    const partEdits = parts
      .filter(p => p.has_condition && p.condition !== p._orig)
      .map(p => ({ sec_idx: p.sec_idx, part_idx: p.part_idx, condition: p.condition }))

    const garageEdits = garage
      .filter(g => g.state !== g._orig)
      .map((g, idx) => ({ idx, state: g.state }))

    const skillEdits = skills.map(s => ({
      name: s.name,
      purchased: s.purchased,
      tiers: s.tiers,
    }))

    const carPartEdits = []
    cars.forEach(c => {
      c.parts.forEach(p => {
        if (p.condition !== p._origCond) {
          carPartEdits.push({ offset: p.offset, condition: p.condition })
        }
      })
    })

    workerRef.current.onmessage = ({ data: msg }) => {
      if (msg.type === 'progress') {
        setDlProgress(msg.pct)
      } else if (msg.type === 'done') {
        const binary = msg.result
        const blob = new Blob([binary], { type: 'application/octet-stream' })
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = filename
        a.click()
        URL.revokeObjectURL(url)

        setParts(prev => prev.map(p => ({ ...p, _orig: p.condition })))
        setGarage(prev => prev.map(g => ({ ...g, _orig: g.state })))
        setSkills(prev => prev.map(s => ({
          ...s,
          _origPurchased: s.purchased,
          _origTiers: [...s.tiers]
        })))
        setCars(prev => prev.map(c => ({
          ...c,
          parts: c.parts.map(p => ({ ...p, _origCond: p.condition }))
        })))
        setOrigStats({ ...stats })
        setDownloading(false)
        setDlProgress(0)
      } else if (msg.type === 'error') {
        setError(msg.message)
        setDownloading(false)
        setDlProgress(0)
      }
    }

    workerRef.current.postMessage({
      type: 'encode',
      save: decoded.save,
      stats,
      partEdits,
      garageEdits,
      skillEdits,
      carPartEdits,
    })
  }, [decoded, stats, parts, garage, skills, cars, filename])

  const isDirty = decoded && (
    (stats && origStats && (
      stats.money !== origStats.money ||
      stats.level !== origStats.level ||
      stats.xp !== origStats.xp ||
      stats.skill_points !== origStats.skill_points
    )) ||
    parts.some(p => p.has_condition && p.condition !== p._orig) ||
    garage.some(g => g.state !== g._orig) ||
    skills.some(s => s.purchased !== s._origPurchased || s.tiers.some((t, i) => t !== s._origTiers[i])) ||
    cars.some(c => c.parts.some(p => p.condition !== p._origCond))
  )

  if (!decoded) {
    return (
      <DropZone
        onFile={handleFile}
        loading={loading}
        progress={progress}
        progressLabel={progressLabel}
        error={error}
      />
    )
  }

  const hdr = decoded.header

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="topbar-left">
          <span className="topbar-title">CMS21 Save Editor</span>
          <span className="topbar-profile">{hdr.profile_name}</span>
          <span className="topbar-meta">
            {hdr.save_year}-{String(hdr.save_month).padStart(2, '0')}
            {hdr.version ? ` · v${hdr.version}` : ''}
          </span>
          {isDirty && <span className="dirty-badge">● Unsaved changes</span>}
        </div>
        <div className="topbar-right">
          <button
            className="btn btn-ghost"
            onClick={() => {
              setDecoded(null)
              setStats(null)
              setOrigStats(null)
              setParts([])
              setGarage([])
              setError(null)
            }}
          >
            Open another file
          </button>
          <button
            className="btn btn-primary"
            onClick={handleDownload}
            disabled={downloading}
          >
            {downloading
              ? `Saving… ${dlProgress < 100 ? `${dlProgress}%` : ''}`
              : '↓ Download .cms21b'}
          </button>
        </div>
      </header>

      {showDownloadModal && (
        <DownloadModal 
          onConfirm={executeDownload} 
          onCancel={() => setShowDownloadModal(false)} 
        />
      )}

      {error && (
        <div className="global-error">
          <strong>Error:</strong> {error}
          <button className="error-close" onClick={() => setError(null)}>✕</button>
        </div>
      )}

      <nav className="tabs">
        {TABS.map((t, i) => (
          <button
            key={t}
            className={`tab-btn${activeTab === i ? ' active' : ''}`}
            onClick={() => setActiveTab(i)}
          >
            {t}
          </button>
        ))}
      </nav>

      <main className="tab-content">
        {activeTab === 0 && (
          <Overview
            stats={stats}
            origStats={origStats}
            header={hdr}
            onStatsChange={setStats}
          />
        )}
        {activeTab === 1 && (
          <Garage
            garage={garage}
            onGarageChange={setGarage}
          />
        )}
        {activeTab === 2 && (
          <Parts
            parts={parts}
            onPartsChange={setParts}
          />
        )}
        {activeTab === 3 && <Skills skills={skills} onSkillsChange={setSkills} />}
        {activeTab === 4 && <Cars cars={cars} onCarsChange={setCars} />}
      </main>

      <footer className="app-footer">
        <div className="footer-content">
          <span className="footer-made">Made in 🇵🇦 with ❤️ by <a href="https://github.com/rdeeb" target="_blank" rel="noreferrer">rdeeb</a></span>
          <span className="footer-sep">|</span>
          <a href="https://github.com/rdeeb/cms2021-save-editor" target="_blank" rel="noreferrer">GitHub Project</a>
          <span className="footer-sep">|</span>
          <a href="https://github.com/rdeeb/cms2021-save-editor/issues" target="_blank" rel="noreferrer" className="footer-link-error">
            Report a Bug
          </a>
        </div>
      </footer>
    </div>
  )
}
