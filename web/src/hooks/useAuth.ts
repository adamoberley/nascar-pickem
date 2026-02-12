import { useEffect, useState } from "react";
import {
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
  type User,
} from "firebase/auth";
import { auth } from "../lib/firebase";

interface AuthState {
  user: User | null;
  loading: boolean;
}

export function useAuthState(): AuthState {
  const [state, setState] = useState<AuthState>({ user: null, loading: true });

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      setState({ user, loading: false });
    });

    return unsubscribe;
  }, []);

  return state;
}

export async function signInPassword(email: string, password: string): Promise<void> {
  await signInWithEmailAndPassword(auth, email.trim(), password);
}

export async function signUpPassword(email: string, password: string): Promise<void> {
  await createUserWithEmailAndPassword(auth, email.trim(), password);
}

export async function logout(): Promise<void> {
  await signOut(auth);
}
