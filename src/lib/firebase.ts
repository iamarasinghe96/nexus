// Firebase v9 modular SDK — same package as gstatic.com/firebasejs/9.x, served via npm
import { initializeApp, getApps, type FirebaseApp } from 'firebase/app'
import { getFirestore, type Firestore } from 'firebase/firestore'
import { getAuth, type Auth } from 'firebase/auth'

let _app: FirebaseApp | null = null
let _db: Firestore | null = null
let _auth: Auth | null = null

function getConfig() {
  return {
    apiKey: import.meta.env.VITE_FIREBASE_API_KEY as string | undefined,
    projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID as string | undefined,
    authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN as string | undefined,
    appId: import.meta.env.VITE_FIREBASE_APP_ID as string | undefined,
    storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET as string | undefined,
    messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID as string | undefined,
  }
}

export function isFirebaseConfigured(): boolean {
  const c = getConfig()
  return !!(c.apiKey && c.projectId && c.authDomain && c.appId)
}

function getApp(): FirebaseApp | null {
  if (!isFirebaseConfigured()) return null
  if (_app) return _app
  const c = getConfig()
  _app = getApps().length ? getApps()[0]! : initializeApp(c as Required<typeof c>)
  return _app
}

export function getDb(): Firestore | null {
  const app = getApp()
  if (!app) return null
  if (!_db) _db = getFirestore(app)
  return _db
}

export function getAuthInstance(): Auth | null {
  const app = getApp()
  if (!app) return null
  if (!_auth) _auth = getAuth(app)
  return _auth
}
