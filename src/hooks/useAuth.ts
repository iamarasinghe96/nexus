import { useState, useEffect } from 'react'
import {
  GoogleAuthProvider,
  signInWithPopup,
  signOut as firebaseSignOut,
  onAuthStateChanged,
  browserLocalPersistence,
  setPersistence,
  type User,
} from 'firebase/auth'
import { getAuthInstance, isFirebaseConfigured } from '../lib/firebase'

export interface AuthState {
  user: User | null
  loading: boolean
  configured: boolean
}

export function useAuth(): AuthState & { signIn: () => Promise<void>; signOut: () => Promise<void> } {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)
  const configured = isFirebaseConfigured()

  useEffect(() => {
    const auth = getAuthInstance()
    if (!auth) { setLoading(false); return }

    const unsub = onAuthStateChanged(auth, u => {
      setUser(u)
      setLoading(false)
    })
    return unsub
  }, [])

  const signIn = async () => {
    const auth = getAuthInstance()
    if (!auth) return
    try {
      await setPersistence(auth, browserLocalPersistence)
      await signInWithPopup(auth, new GoogleAuthProvider())
    } catch {
      // User cancelled popup — no-op
    }
  }

  const signOut = async () => {
    const auth = getAuthInstance()
    if (!auth) return
    await firebaseSignOut(auth)
  }

  return { user, loading, configured, signIn, signOut }
}
