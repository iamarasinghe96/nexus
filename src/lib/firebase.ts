import { initializeApp, getApps, FirebaseApp } from 'firebase/app'
import { getFirestore, Firestore } from 'firebase/firestore'

// Lazily initialised — returns null if env vars are absent so the app
// runs without Firebase (edit saves will be skipped gracefully).
let app: FirebaseApp | null = null
let db: Firestore | null = null

export function getFirestoreDb(): Firestore | null {
  const apiKey = import.meta.env.VITE_FIREBASE_API_KEY
  const projectId = import.meta.env.VITE_FIREBASE_PROJECT_ID
  const authDomain = import.meta.env.VITE_FIREBASE_AUTH_DOMAIN

  if (!apiKey || !projectId || !authDomain) return null

  if (!app) {
    app = getApps().length
      ? getApps()[0]!
      : initializeApp({ apiKey, authDomain, projectId })
  }

  if (!db) db = getFirestore(app)
  return db
}
